// ═══════════════════════════════════════════════════════════════════════════
// MAIN — post chain, sizing, UI wiring, the frame loop, and boot order.
//
// Everything the loop touches is a pure function of time, so the timeline is
// random-access in both directions. The loop also does no work at all while the
// model is scrolled off screen: on a page you scroll through, that is the
// single biggest thing separating smooth from laggy.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { $, clamp, setBar } from './util.js';
import { S, END, QUALITY } from './state.js';
import { SOURCES, MODELLED } from './data.js';
import {
  CORR, LENGTH, decodeDEM, unpackCentre, buildBuckets, measureWidths, buildBeats,
  groundSD, bed, arrival, peak, celerity, frontAt, stageAt, valleyWidth, curvature,
  slope, station, BEATS
} from './corridor.js';
import { stage, scene, world, renderer, camera, uniforms, buildEnvironment } from './scene.js';
import { buildTerrain, buildBasePlate, updateTerrainLOD, terrainChunks, setLodBudget, setTriBudget } from './terrain.js';
import {
  buildSolver, allocateFlow, solveFlow, readFlowRow, buildCollapse, updateCollapse,
  buildDam, updateDam, flowA
} from './flow.js';
import {
  buildWater, waterMat, buildDebris, updateDebris, buildSpray, updateSpray,
  sprites, depthTarget, spriteUniforms
} from './water.js';
import {
  buildBuilt, updateBuilt, buildOverlays, buildDeposits, updateDeposits,
  ribbon, peakMesh, buildings, infraGroup
} from './overlays.js';
import {
  CAM, stepCamera, snapCamera, clampCameraGoals, buildPresets, gotoPreset,
  frameRoute, updateTour, cancelTour
} from './controls.js';
import {
  seek, setPlayingUI, stepBeat, updateHUD, syncTransport, buildTicks, buildLabels,
  updateLabels, setShowLabels, setShowKm, setUpdateHook, buildPanels, drawInspector,
  toggleAudio, updateAudio
} from './hud.js';
import { buildSite, buildFlatMap, buildHero } from './site.js';
import { plateGroup } from './terrain.js';

// ─────────────────────────────────────────────────────── post
// Linear HDR → restrained bloom on bright spray only → vignette and fine grain
// → ACES output transform. No lens flare, no chromatic aberration, no simulated
// handheld: anything that mimics real footage is out of scope by design.
let composer = null, bloom = null, finish = null;
function buildPost() {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(960, 540), 0.22, 0.62, 0.94);
  composer.addPass(bloom);
  finish = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, vig: { value: .34 } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `precision highp float; varying vec2 vUv;
     uniform sampler2D tDiffuse; uniform float uTime,vig;
     void main(){
      vec3 c=texture2D(tDiffuse,vUv).rgb;
      vec2 q=vUv-.5;
      c*=1.-dot(q,q)*vig;
      float g=fract(sin(dot(vUv*vec2(1913.7,977.3)+uTime,vec2(12.9898,78.233)))*43758.5453);
      c+=(g-.5)*0.0065;
      gl_FragColor=vec4(c,1.);
     }`
  });
  composer.addPass(finish);
  composer.addPass(new OutputPass());
}

// Device pixel ratio is capped per tier. This runs in a box on a scrolling
// page; the difference between 1.25x and 2x is invisible and the cost is
// quadratic.
function resize() {
  if (!depthTarget) return;
  const w = Math.max(2, stage.clientWidth), h = Math.max(2, stage.clientHeight);
  const dpr = Math.min(devicePixelRatio || 1, (QUALITY[S.quality] || QUALITY.balanced).dpr);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  composer?.setSize(w, h);
  composer?.setPixelRatio?.(dpr);
  bloom?.setSize(Math.max(2, w * 0.5), Math.max(2, h * 0.5));
  const dw = Math.max(2, Math.floor(w * dpr * .5)), dh = Math.max(2, Math.floor(h * dpr * .5));
  depthTarget.setSize(dw, dh);
  spriteUniforms.resolution.value.set(dw, dh);
}
addEventListener('resize', resize);
if (typeof ResizeObserver === 'function') new ResizeObserver(() => resize()).observe(stage);

function applyQuality() {
  const q = QUALITY[S.quality] || QUALITY.balanced;
  setLodBudget(q.lod); setTriBudget(q.tri); S.spriteBudget = q.sprites;
  allocateFlow(); resize();
}

// ─────────────────────────────────────────────────────── UI
function wireUI() {
  $('play').onclick = () => setPlayingUI(!S.playing);
  $('reset').onclick = () => { setPlayingUI(false); seek(-30); };
  $('stepFwd').onclick = () => { setPlayingUI(false); seek(S.time + 1); };
  $('stepBack').onclick = () => { setPlayingUI(false); seek(S.time - 1); };
  $('beatFwd').onclick = () => stepBeat(1);
  $('beatBack').onclick = () => stepBeat(-1);
  $('scrub').addEventListener('input', e => { setPlayingUI(false); seek(Number(e.target.value)); });
  $('speed').onchange = e => { S.rate = Number(e.target.value); };
  $('loopBtn').onclick = e => { S.looping = !S.looping; e.currentTarget.setAttribute('aria-pressed', String(S.looping)); };
  $('holdBtn').onclick = e => { S.holdEnd = !S.holdEnd; e.currentTarget.setAttribute('aria-pressed', String(S.holdEnd)); };
  $('followBtn').onclick = e => { CAM.followFront = !CAM.followFront; e.currentTarget.setAttribute('aria-pressed', String(CAM.followFront)); cancelTour(); };
  $('frameBtn').onclick = () => { cancelTour(); frameRoute(); };
  $('tourBtn').onclick = e => {
    CAM.tour = !CAM.tour; e.currentTarget.setAttribute('aria-pressed', String(CAM.tour));
    if (CAM.tour) { CAM.tourAt = 0; gotoPreset(CAM.tourIndex); }
  };

  const toggle = (id, fn, init) => {
    let on = init; $(id).setAttribute('aria-pressed', String(on)); fn(on);
    $(id).onclick = () => { on = !on; $(id).setAttribute('aria-pressed', String(on)); fn(on); };
  };
  toggle('tRibbon', v => ribbon.visible = v, true);
  toggle('tPeak', v => peakMesh.visible = v, true);
  toggle('tLabels', v => setShowLabels(v), true);
  toggle('tKm', v => setShowKm(v), true);
  toggle('tContours', v => uniforms.contours.value = v ? 1 : 0, false);   // off by default
  toggle('tBuilt', v => { buildings.visible = v; infraGroup.visible = v; }, true);
  toggle('tPlate', v => plateGroup.visible = v, false);
  toggle('tSpray', v => { S.spraysOn = v; sprites.visible = v; }, true);

  $('exag').onchange = e => {
    uniforms.vertical.value = e.target.checked ? 1.5 : 1;
    $('exagNote').hidden = !e.target.checked;
    $('voidNote').hidden = e.target.checked;
  };
  $('quality').onchange = e => { S.quality = e.target.value; applyQuality(); };
  $('audioChk').onchange = e => toggleAudio(e.target.checked).catch(() => { e.target.checked = false; });

  addEventListener('keydown', e => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (!S.onScreen) return;              // keys only drive the model while it is visible
    const k = e.key;
    if (e.code === 'Space') { e.preventDefault(); setPlayingUI(!S.playing); return; }
    if (k === 'ArrowRight') { e.preventDefault(); e.shiftKey ? stepBeat(1) : (setPlayingUI(false), seek(S.time + 1)); return; }
    if (k === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? stepBeat(-1) : (setPlayingUI(false), seek(S.time - 1)); return; }
    if (k === '[' || k === ']') {
      const opts = [0.25, 0.5, 1, 5, 20, 60];
      let i = opts.indexOf(S.rate); if (i < 0) i = 4;
      S.rate = opts[clamp(i + (k === ']' ? 1 : -1), 0, opts.length - 1)];
      $('speed').value = String(S.rate); return;
    }
    if (k === 'f' || k === 'F') { cancelTour(); frameRoute(); return; }
    if (k === 'l' || k === 'L') { CAM.followFront = !CAM.followFront; $('followBtn').setAttribute('aria-pressed', String(CAM.followFront)); cancelTour(); return; }
    if (k === 't' || k === 'T') { $('tourBtn').click(); return; }
    if (k >= '1' && k <= '6') { cancelTour(); gotoPreset(Number(k) - 1); return; }
  });
}

// ─────────────────────────────────────────────────────── frame
function update(t, dt, force) {
  uniforms.time.value = t;
  uniforms.front.value = frontAt(t);
  updateCollapse(t); updateDam(t); updateDebris(t);
  if (S.spraysOn) updateSpray(t);
  updateBuilt(t, force); updateDeposits(t); updateHUD(t); updateAudio(t);
}
setUpdateHook((t, dt) => update(t, dt, true));

let lastNow = performance.now(), fpsAccum = 0, fpsFrames = 0, firstFrame = true, frame = 0;
renderer.info.autoReset = false;

if (typeof IntersectionObserver === 'function') {
  new IntersectionObserver(es => {
    S.onScreen = es[0].isIntersecting;
    if (S.onScreen) lastNow = performance.now();
  }, { rootMargin: '140px' }).observe(stage);
}

function render() {
  requestAnimationFrame(render);
  const now = performance.now();
  const rawDt = (now - lastNow) / 1000, dt = Math.min(rawDt, .08);
  lastNow = now;
  // Off screen or tab hidden: hold the clock and skip the frame entirely. One
  // frame is always drawn at boot so the model is ready before it scrolls in.
  if (!S.forceFrame && (!S.onScreen || document.hidden)) return;
  S.forceFrame = false;

  if (S.playing) {
    S.time += dt * S.rate;
    if (S.time >= END) {
      if (S.looping && !S.holdEnd) { S.time = -30; S.resetFlow = true; }
      else { S.time = END; setPlayingUI(false); }
    }
    syncTransport();
  }
  updateTour(dt);
  stepCamera(dt);
  updateTerrainLOD();
  update(S.time, dt, false);
  solveFlow(dt);
  // The solver ping-pongs its targets, so the water surface is pointed at the
  // newest one here rather than from inside the solver (water imports flow).
  waterMat.uniforms.field.value = flowA.texture;
  // Label projection and its occlusion raymarch are the most expensive CPU work
  // per frame and are imperceptible at half rate.
  if ((frame & 1) === 0) updateLabels();
  finish.uniforms.uTime.value = now * .001;

  renderer.info.reset();
  if (S.spraysOn) {
    sprites.visible = false;
    renderer.setRenderTarget(depthTarget);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    sprites.visible = true;
  }
  composer.render();

  frame++;
  fpsAccum += rawDt; fpsFrames++;
  if (fpsAccum > 1) {
    S.fps = Math.round(fpsFrames / fpsAccum); fpsAccum = 0; fpsFrames = 0;
    $('runtime').textContent = S.fps + ' FPS · ' + renderer.info.render.triangles.toLocaleString()
      + ' triangles · ' + renderer.info.render.calls + ' draw calls · ' + S.quality;
    drawInspector();
  }
  if (firstFrame) {
    firstFrame = false;
    $('loading').classList.add('hidden');
    window.__reconstruction.ready = true;
  }
}

// ─────────────────────────────────────────────────────── inspection surface
window.__reconstruction = {
  ready: false, seek, setPlaying: setPlayingUI,
  get time() { return S.time; },
  snapshot() {
    const s = frontAt(S.time);
    return {
      time: S.time, front: s, bed: bed(s), peak: peak(s), celerity: celerity(s),
      arrival: arrival(s), stage: stageAt(s, S.time), fps: S.fps, onScreen: S.onScreen,
      camera: { az: CAM.azimuth, el: CAM.elevation, dist: CAM.distance, target: CAM.target.toArray() },
      triangles: renderer.info.render.triangles, calls: renderer.info.render.calls
    };
  },
  setCamera(az, el, dist, target) {
    CAM.gAz = az; CAM.gEl = el; CAM.gDist = dist;
    if (target) CAM.gTarget.fromArray(target);
    clampCameraGoals(); snapCamera();
  },
  gotoPreset, frameRoute, readFlowRow,
  groundSD, bed, arrival, peak, celerity, frontAt, stageAt, valleyWidth, curvature, slope, station,
  corridor: { ...CORR }, length: LENGTH, beats: () => BEATS,
  sources: SOURCES, modelled: MODELLED,
  tightestBends(n = 4, minGap = 6000) {
    const cand = [];
    for (let s = 2000; s < LENGTH - 2000; s += 250) cand.push({ s, k: Math.abs(curvature(s)) });
    cand.sort((a, b) => b.k - a.k);
    const out = [];
    for (const c of cand) {
      if (out.every(o => Math.abs(o.s - c.s) >= minGap)) out.push(c);
      if (out.length >= n) break;
    }
    return out.map(o => ({ s: o.s, radius: Math.round(1 / o.k), width: Math.round(valleyWidth(o.s)) }));
  },
  debug: {
    get scene() { return scene; }, get camera() { return camera; },
    get world() { return world; }, get chunks() { return terrainChunks; },
    get renderer() { return renderer; }
  },
};

renderer.debug.onShaderError = (gl, program, vs, fs) => {
  console.error('SHADER ERROR', gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs), gl.getProgramInfoLog(program));
};

// ─────────────────────────────────────────────────────── boot
(async function boot() {
  try {
    buildSite();                                     // the page reads before the model loads
    $('loadText').textContent = 'Decoding the embedded elevation grid…'; setBar(.10);
    await decodeDEM();
    await new Promise(r => setTimeout(r, 0));
    $('loadText').textContent = 'Tracing the corridor…'; setBar(.26);
    unpackCentre(); buildBuckets(); measureWidths(); buildBeats();
    buildFlatMap(); buildHero();
    await new Promise(r => setTimeout(r, 0));
    $('loadText').textContent = 'Cutting the relief block…'; setBar(.46);
    buildEnvironment(); buildTerrain(); buildBasePlate();
    await new Promise(r => setTimeout(r, 0));
    $('loadText').textContent = 'Compiling the flow solver…'; setBar(.68);
    buildSolver(); buildWater(); buildCollapse(); buildDam(); buildDebris(); buildSpray();
    await new Promise(r => setTimeout(r, 0));
    $('loadText').textContent = 'Placing overlays…'; setBar(.86);
    buildBuilt(); buildOverlays(); buildDeposits();
    buildPresets(); buildLabels(); buildTicks(); buildPanels();
    buildPost(); wireUI();
    waterMat.uniforms.envMap.value = scene.environment;
    S.quality = $('quality').value || 'balanced'; applyQuality();
    setBar(.97);
    frameRoute(); snapCamera(); resize();
    update(-30, 0, true);
    setPlayingUI(false);
    requestAnimationFrame(render);
  } catch (err) {
    console.error(err);
    $('loadText').innerHTML = 'The reconstruction could not start.<br><span class="mono" style="color:#d4574a">'
      + String(err && err.message || err) + '</span>';
    $('bar').hidden = true;
  }
})();
