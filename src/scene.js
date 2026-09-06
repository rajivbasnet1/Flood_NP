// ═══════════════════════════════════════════════════════════════════════════
// SCENE — renderer, the dark void the block hangs in, and the sky probe. The
// sky is rendered once offscreen and used only as an environment probe; it is
// never drawn behind the model.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { $, DEG } from './util.js';
import { CORR, LENGTH } from './corridor.js';

// ════════════════════════════════════════════════════════════════════════════
// SECTION 4 — RENDERER, VOID AND SCENE ROOT
// ════════════════════════════════════════════════════════════════════════════
const stage=$('stage');
const scene=new THREE.Scene(), world=new THREE.Group(); scene.add(world);
const renderer=new THREE.WebGLRenderer({canvas:$('scene'),antialias:false,powerPreference:'high-performance'});
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.30;
renderer.shadowMap.enabled=false;   // Overcast: diffuse and low contrast anyway.

const camera=new THREE.PerspectiveCamera(46,16/9,3,260000);

// The block floats in a dark neutral void — not a sky dome. A screen-space
// gradient behind everything is what stops the piece reading as an infinite
// world, and therefore as footage.
{
 const c=document.createElement('canvas'); c.width=4; c.height=256;
 const ctx=c.getContext('2d');
 const g=ctx.createLinearGradient(0,0,0,256);
 g.addColorStop(0,'#0a1017'); g.addColorStop(.55,'#070b10'); g.addColorStop(1,'#04060a');
 ctx.fillStyle=g; ctx.fillRect(0,0,4,256);
 const tex=new THREE.CanvasTexture(c); tex.colorSpace=THREE.SRGBColorSpace;
 scene.background=tex;
}
scene.fog=new THREE.FogExp2(0x0a1016,0.0000115);

const BASE_Y=-900;
const uniforms={
 time:{value:-30}, front:{value:0}, vertical:{value:1},
 heightMap:{value:null},
 corrSize:{value:new THREE.Vector2(LENGTH,CORR.half)},
 texel:{value:new THREE.Vector2(1/CORR.nd,1/CORR.ns)},
 spacing:{value:new THREE.Vector2(2*CORR.half/(CORR.nd-1),LENGTH/(CORR.ns-1))},
 contours:{value:0},
};

// ════════════════════════════════════════════════════════════════════════════
// SECTION 5 — ENVIRONMENT
// A real analytic sky model, rendered once offscreen, PMREM filtered, used only
// as an environment probe. It is never drawn behind the model.
// ════════════════════════════════════════════════════════════════════════════
let sunDir=new THREE.Vector3();
function buildEnvironment(){
 const sky=new Sky(); sky.scale.setScalar(60000);
 const u=sky.material.uniforms;
 u.turbidity.value=18; u.rayleigh.value=2.6;
 u.mieCoefficient.value=0.02; u.mieDirectionalG.value=0.79;
 sunDir.setFromSphericalCoords(1,DEG(90-46),DEG(128));   // mid-morning, late August
 u.sunPosition.value.copy(sunDir);
 // Monsoon overcast: heavily attenuated, low contrast, but NOT uniform. A flat
 // probe lights every slope identically and the relief stops reading at all.
 sky.material.fragmentShader=sky.material.fragmentShader.replace(
  'gl_FragColor = vec4( retColor, 1.0 );',
  `vec3 dir=normalize(vWorldPosition-cameraPosition);
   float upness=clamp(dir.y*.5+.5,0.,1.);
   vec3 deck=mix(vec3(0.055,0.064,0.076),vec3(0.30,0.335,0.375),pow(upness,0.9));
   float glow=pow(max(0.,dot(dir,normalize(vSunDirection))),7.)*0.30;
   gl_FragColor = vec4(mix(retColor*0.16, deck, 0.80)+glow, 1.0);`);
 const envScene=new THREE.Scene(); envScene.add(sky);
 const pmrem=new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader();
 scene.environment=pmrem.fromScene(envScene,0.045).texture;
 scene.environmentIntensity=0.72;
 pmrem.dispose();

 scene.add(new THREE.HemisphereLight(0x9db6c8,0x3d443e,0.46));
 const sun=new THREE.DirectionalLight(0xdde5e8,2.05);
 sun.position.copy(sunDir).multiplyScalar(90000); scene.add(sun);
 // A cool fill keeps the cut faces and shaded walls readable from any orbit.
 const fill=new THREE.DirectionalLight(0x7f97a8,0.46);
 fill.position.set(-sunDir.x,0.28,-sunDir.z).multiplyScalar(90000); scene.add(fill);
}

const glslNoise=`
float hash3(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float n3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm3(vec3 p){return n3(p)*.55+n3(p*2.07)*.26+n3(p*4.13)*.13+n3(p*8.31)*.06;}
`;

export { stage, scene, world, renderer, camera, BASE_Y, uniforms, buildEnvironment, glslNoise, sunDir };
