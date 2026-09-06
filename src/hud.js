// ═══════════════════════════════════════════════════════════════════════════
// HUD — transport, readouts, scene labels, the sources tables and the audio.
// Sourced values read white; modelled values read grey. A viewer should never
// have to guess which numbers were measured and which were assumed.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { $, clamp, lerp, DEG, smooth } from './util.js';
import {
  CORR, LENGTH, station, stationInto, groundSD, bed, valleyWidth, curvature,
  arrival, celerity, peak, stageAt, frontAt, formatTime, BEATS,
  T_IMPACT, T_PORT, T_BLOCK, T_BREACH, T_WIDEN
} from './corridor.js';
import { SOURCES, MODELLED } from './data.js';
import { stage, camera, uniforms } from './scene.js';
import { readFlowRow } from './flow.js';
import { PLACES } from './overlays.js';
import { CAM, groundAtWorld } from './controls.js';
import { S, END } from './state.js';

// main.js owns the frame update; hud only needs to trigger one on a seek.
let frameHook = () => {};
const setUpdateHook = fn => { frameHook = fn; };
const setShowLabels = v => { showLabels = v; };
const setShowKm = v => { showKm = v; };

// ════════════════════════════════════════════════════════════════════════════
// SECTION 18 — PLAYBACK STATE
// ════════════════════════════════════════════════════════════════════════════

function seek(t){
 S.time=clamp(t,-30,END);
 S.resetFlow=true;                 // the advected surface is cosmetic; rebuild it
 frameHook(S.time,0);
 syncTransport();
}
function setPlayingUI(v){
 S.playing=v;
 $('play').textContent=S.playing?'❚❚':'▶';
 $('play').setAttribute('aria-label',S.playing?'Pause':'Play');
}
function stepBeat(dir){
 const ts=BEATS.map(b=>b.t);
 let target=dir>0?ts.find(x=>x>S.time+0.5):[...ts].reverse().find(x=>x<S.time-0.5);
 if(target===undefined) target=dir>0?END:-30;
 setPlayingUI(false); seek(target);
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 19 — HUD
// Sourced values are mint; modelled values are amber. A viewer should never
// have to guess which numbers were measured and which were assumed.
// ════════════════════════════════════════════════════════════════════════════
function currentPlace(s){
 let cur=PLACES[0];
 for(const p of PLACES) if(s>=p.s-900) cur=p;
 return cur;
}
function phaseOf(t){
 if(t<0) return 'Pre-event · monsoon stage';
 if(t<T_IMPACT) return 'Detachment and fall';
 if(t<T_BLOCK) return 'Impact, frictional melt, entrainment';
 if(t<T_BREACH) return 'Channel blocked · lake filling (timing modelled)';
 if(t<T_BREACH+T_WIDEN) return 'Breach · second pulse released';
 if(t<arrival(LENGTH)) return 'Downstream translation and attenuation';
 return 'Recession · deposition and trim line';
}
function updateHUD(t){
 const s=frontAt(t), place=currentPlace(s);
 $('place').textContent=place.name;
 $('subplace').textContent=place.sub;
 $('hTime').textContent=formatTime(t);
 $('hDist').textContent=(s/1000).toFixed(1)+' km';
 $('hElev').textContent=Math.round(bed(s)).toLocaleString()+' m';
 $('hDepth').textContent=(t<=0?'— m':Math.round(peak(s))+' m');
 $('hSpeed').textContent=(t<=T_IMPACT||s>=LENGTH?'— m/s':celerity(s).toFixed(1)+' m/s');
 // The 7-minute arrival is the one sourced timing; flag it as such.
 const sourcedNow=Math.abs(t-T_PORT)<45;
 $('hSpeed').className='v mono '+(sourcedNow?'sourced':'modelled');
 $('hRate').textContent=(S.playing?S.rate:0)+'×';
 $('phaseNote').textContent=phaseOf(t);
 $('clock').textContent=formatTime(t);
 $('speedNote').textContent='real time × '+S.rate+(S.playing?'':' · paused');
 const pct=(t+30)/(END+30)*100;
 $('scrub').style.setProperty('--pct',pct.toFixed(2)+'%');
 // Scale bar, sized from the current view.
 const mpp=2*CAM.distance*Math.tan(DEG(camera.fov)/2)/stage.clientHeight;
 const targetPx=88, rawM=mpp*targetPx;
 const pow=Math.pow(10,Math.floor(Math.log10(rawM)));
 const nice=[1,2,5,10].map(n=>n*pow).reduce((a,b)=>Math.abs(b-rawM)<Math.abs(a-rawM)?b:a);
 $('scaleText').textContent=nice>=1000?(nice/1000)+' km':nice+' m';
 $('scaleLine').style.width=(nice/mpp).toFixed(0)+'px';
}
function syncTransport(){
 $('scrub').value=String(Math.round(S.time));
 $('scrub').style.setProperty('--pct',((S.time+30)/(END+30)*100).toFixed(2)+'%');
}
function buildTicks(){
 const wrap=$('ticks'); wrap.innerHTML='';
 for(const b of BEATS){
  const pct=(b.t+30)/(END+30)*100;
  const i=document.createElement('i');
  i.style.left=pct+'%'; if(b.sourced) i.className='sourced';
  i.title=b.label+' — '+b.note; wrap.appendChild(i);
 }
 // The early beats are seconds apart on a four-hour timeline, so most of them
 // would stack into an unreadable smear. Every beat keeps its tick and its
 // tooltip; only labels that clear their neighbour by 5% of the bar are drawn.
 const short={'Gyirong Port / Rasuwagadhi':'Border','Impoundment':'Lake','Recession':'Recession'};
 let lastPct=-99;
 for(const b of BEATS){
  const pct=(b.t+30)/(END+30)*100;
  if(pct-lastPct<5) continue;
  lastPct=pct;
  const el=document.createElement('b');
  el.style.left=pct+'%';
  el.textContent=short[b.label]||(b.label.length>13?b.label.slice(0,12)+'…':b.label);
  el.title=b.label;
  wrap.appendChild(el);
 }
}

// ── Billboarded, decluttered scene labels ───────────────────────────────────
const labelLayer=$('labels');
let labelEls=[], kmEls=[];
function buildLabels(){
 for(const p of PLACES){
  const el=document.createElement('div');
  el.className='lab'+(p.kind==='infra'?' infra':'');
  el.textContent=p.name;
  labelLayer.appendChild(el);
  labelEls.push({el,place:p});
 }
 for(let km=0;km<=Math.floor(LENGTH/1000);km+=5){
  const el=document.createElement('div');
  el.className='lab km'; el.textContent=km+' km';
  labelLayer.appendChild(el);
  kmEls.push({el,s:km*1000});
 }
}
const _proj=new THREE.Vector3(), _lp=new THREE.Vector3();
function projectPoint(p){
 _proj.copy(p).project(camera);
 if(_proj.z>1) return null;
 return {x:(_proj.x*.5+.5)*stage.clientWidth,y:(-_proj.y*.5+.5)*stage.clientHeight,z:_proj.z};
}
let showLabels=true, showKm=true;
// Is a ridge between the camera and this point? Without this, labels for
// places on the far side of the valley float over the near hillside as if the
// mountain were transparent.
function occluded(point){
 const vy=uniforms.vertical.value;
 const c=camera.position;
 for(let i=2;i<=13;i++){
  const f=i/15;
  const x=lerp(c.x,point.x,f), y=lerp(c.y,point.y,f), z=lerp(c.z,point.z,f);
  if(y<groundAtWorld(x,z)*vy-8) return true;
 }
 return false;
}
function updateLabels(){
 const placed=[];
 const consider=(entry,point,minGap)=>{
  const sp=projectPoint(point);
  if(!sp||sp.x<-60||sp.y<-30||sp.x>stage.clientWidth+60||sp.y>stage.clientHeight+30){entry.el.style.opacity='0';return;}
  const d=camera.position.distanceTo(point);
  let op=clamp(1-(d-4000)/120000,0,1)*clamp((160000-d)/40000,0,1);
  if(op>0.04&&occluded(point)) op=0;
  // Declutter: drop anything that would overlap something already placed. The
  // gap scales with the label's own width so long names do not collide.
  const half=(entry.el.offsetWidth||60)/2;
  if(op>0.04) for(const q of placed){
   if(Math.abs(q.x-sp.x)<(half+q.half+10)&&Math.abs(q.y-sp.y)<16){op=0;break;}
  }
  if(op>0.04){
   placed.push({x:sp.x,y:sp.y,half});
   entry.el.style.transform=`translate(-50%,-50%) translate(${sp.x.toFixed(1)}px,${sp.y.toFixed(1)}px)`;
  }
  entry.el.style.opacity=op.toFixed(3);
 };
 if(showLabels) for(const e of labelEls){
  stationInto(_lp,e.place.s,0,0);
  _lp.y=(Math.max(bed(e.place.s),_lp.y)+140)*uniforms.vertical.value;
  consider(e,_lp,0);
 } else labelEls.forEach(e=>e.el.style.opacity='0');
 if(showKm) for(const e of kmEls){
  stationInto(_lp,e.s,0,0);
  _lp.y=(Math.max(bed(e.s),_lp.y)+40)*uniforms.vertical.value;
  consider(e,_lp,0);
 } else kmEls.forEach(e=>e.el.style.opacity='0');
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 20 — SOURCES AND INSPECTOR PANELS
// ════════════════════════════════════════════════════════════════════════════
function buildPanels(){
 
 
 const t=document.createElement('table');
 t.innerHTML='<thead><tr><th>Figure</th><th>Source</th></tr></thead>';
 const tb=document.createElement('tbody');
 for(const s of SOURCES){
  const tr=document.createElement('tr');
  const a=s.url?`<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`:s.name;
  tr.innerHTML=`<td><span class="tag rep">${s.status}</span><br>${s.figure}</td><td class="s">${a}<br>${s.date}</td>`;
  tb.appendChild(tr);
 }
 t.appendChild(tb); $('sourceTable').appendChild(t);

 const m=document.createElement('table');
 m.innerHTML='<thead><tr><th>Element</th><th>What was assumed</th></tr></thead>';
 const mb=document.createElement('tbody');
 for(const [k,v] of MODELLED){
  const tr=document.createElement('tr');
  tr.innerHTML=`<td class="s" style="width:34%"><span class="tag mod">MODELLED</span><br>${k}</td><td>${v}</td>`;
  mb.appendChild(tr);
 }
 m.appendChild(mb); $('modelTable').appendChild(m);

 $('limits').innerHTML='This is an explanatory reconstruction, not a calibrated hazard model. It cannot establish '
  +'site-specific inundation, and it must not be used for assessment, planning or attribution. It shows no people, '
  +'no bodies and no moment of harm, and it displays no casualty figure. No institution endorses it. '
  +'Terrain comes from a public-domain elevation grid; everything else is generated procedurally at runtime.';
}
function drawChart(canvasId,series,xMax,label){
 const cv=$(canvasId); if(!cv) return;
 const ctx=cv.getContext('2d'), w=cv.width, h=cv.height;
 ctx.clearRect(0,0,w,h);
 ctx.strokeStyle='#ffffff12'; ctx.lineWidth=1;
 for(let i=0;i<=4;i++){const y=8+i*(h-28)/4;ctx.beginPath();ctx.moveTo(30,y);ctx.lineTo(w-6,y);ctx.stroke();}
 ctx.font='11px ui-monospace,monospace'; ctx.fillStyle='#6c7d85';
 ctx.fillText(label,32,h-6);
 for(const sr of series){
  ctx.strokeStyle=sr.color; ctx.lineWidth=1.7; ctx.beginPath();
  for(let i=0;i<=180;i++){
   const x=i/180*xMax, v=sr.fn(x);
   const px=30+(i/180)*(w-36), py=8+(1-clamp(v/sr.max,0,1))*(h-28);
   i?ctx.lineTo(px,py):ctx.moveTo(px,py);
  }
  ctx.stroke();
  ctx.fillStyle=sr.color; ctx.fillText(sr.name,32,16+series.indexOf(sr)*13);
 }
}
function drawInspector(){
 drawChart('curves',[
  {color:'#e8bc80',fn:peak,max:70,name:'peak stage (m), max 70'},
  {color:'#9fdcc4',fn:celerity,max:60,name:'celerity (m/s), max 60'},
 ],LENGTH,'chainage 0 → 93.1 km');
 drawChart('widths',[{color:'#9ec7dd',fn:valleyWidth,max:1800,name:'half-width at bed+30 m, max 1800'}],LENGTH,'chainage 0 → 93.1 km');
 drawChart('profile',[{color:'#e6ecef',fn:bed,max:4400,name:'bed elevation (m), max 4400'}],LENGTH,'chainage 0 → 93.1 km');
 // Cross-section readback: is the water genuinely higher on the outside of the
 // bend? Read straight off the GPU field rather than trusting the eye.
 const rows=[];
 for(const s0 of [13000,30000,45000,60000]){
  const probe=readFlowRow(s0);
  if(!probe){rows.push((s0/1000).toFixed(0)+' km · readback unavailable');continue;}
  const row=probe.depths, n=row.length;
  // Straddle the centre symmetrically; with an even row count there is no
  // centre row, so step outward from the two innermost.
  const lo0=Math.floor((n-1)/2), hi0=lo0+1;
  let k=-1;
  for(let o=0;lo0-o>=0&&hi0+o<n;o++){
   if(row[lo0-o]>.2&&row[hi0+o]>.2) k=o; else break;
  }
  if(k<0){rows.push((s0/1000).toFixed(0)+' km · dry at this frame');continue;}
  const negSide=row[lo0-k], posSide=row[hi0+k];
  // Which bank is the geometric outside of the bend, from centreline positions
  // alone — no sign convention involved.
  const s=probe.s;
  const a=station(s-700,0,0), b=station(s,0,0), c2=station(s+700,0,0);
  const toCx=(a.x+c2.x)/2-b.x, toCz=(a.z+c2.z)/2-b.z;
  const lat=station(s,1,0);
  const posIsOuter=((lat.x-b.x)*toCx+(lat.z-b.z)*toCz)<0;
  const outer=posIsOuter?posSide:negSide, inner=posIsOuter?negSide:posSide;
  rows.push((s/1000).toFixed(1).padStart(5)+' km · outer−inner '
   +(outer-inner).toFixed(2).padStart(6)+' m · 1/R '+curvature(s).toExponential(1));
 }
 $('diag').innerHTML='Superelevation at the present frame, read back from the GPU field '
  +'(positive means the surface stands higher on the outside of the bend):<br>'+rows.join('<br>');
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 21 — AUDIO
// Off by default. One synthesised low rumble tied to front proximity, started
// only on an explicit user action. No files, no speech, no scoring.
// ════════════════════════════════════════════════════════════════════════════
let actx=null, aGain=null, audioOn=false;
async function toggleAudio(on){
 if(on&&!actx){
  actx=new (window.AudioContext||window.webkitAudioContext)();
  const len=actx.sampleRate*6, buf=actx.createBuffer(1,len,actx.sampleRate), ch=buf.getChannelData(0);
  let last=0;
  for(let i=0;i<len;i++){ const wnoise=Math.random()*2-1; last=last*.972+wnoise*.028; ch[i]=last*3.2; }
  const src=actx.createBufferSource(); src.buffer=buf; src.loop=true;
  const lp=actx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=110; lp.Q.value=.6;
  aGain=actx.createGain(); aGain.gain.value=0;
  src.connect(lp); lp.connect(aGain); aGain.connect(actx.destination); src.start();
 }
 if(actx&&actx.state==='suspended') await actx.resume();
 audioOn=on;
 if(aGain&&!on) aGain.gain.setTargetAtTime(0,actx.currentTime,.2);
}
function updateAudio(t){
 if(!audioOn||!aGain) return;
 const s=frontAt(t);
 const d=camera.position.distanceTo(station(s,0,0));
 const near=clamp(1-d/26000,0,1);
 const active=(t>0&&t<arrival(LENGTH)+2400)?1:0;
 aGain.gain.setTargetAtTime(near*near*.16*active,actx.currentTime,.35);
}

export {
  seek, setPlayingUI, stepBeat, currentPlace, phaseOf, updateHUD, syncTransport,
  buildTicks, buildLabels, updateLabels, setShowLabels, setShowKm, setUpdateHook,
  buildPanels, drawInspector, toggleAudio, updateAudio
};
