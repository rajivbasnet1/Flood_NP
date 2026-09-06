// ═══════════════════════════════════════════════════════════════════════════
// CAMERA — a hologram-table orbit inside the stage box. Camera state and
// playback state are independent: orbiting never touches the timeline, and
// scrubbing never moves the camera.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { $, clamp, lerp, DEG } from './util.js';
import { CORR, LENGTH, MAX_H, station, groundSD, toCorridor, bed, frontAt, S_PORT } from './corridor.js';
import { stage, camera, uniforms, BASE_Y } from './scene.js';
import { DAM_S } from './flow.js';
import { S } from './state.js';

// ════════════════════════════════════════════════════════════════════════════
// SECTION 17 — CAMERA
// A hologram-table orbit inside the stage box. Azimuth unrestricted, elevation
// from 2° above the base to nadir, logarithmic zoom toward the cursor, pan
// clamped to the corridor so the block cannot be lost.
//
// Camera state and playback state are independent. Orbiting never touches the
// timeline; scrubbing never moves the camera. The only coupling is opt-in:
// "follow front" moves the pivot and leaves angle and distance alone.
// ════════════════════════════════════════════════════════════════════════════
const CAM={
 target:new THREE.Vector3(0,1600,0),
 azimuth:DEG(214), elevation:DEG(46), distance:52000,
 gTarget:new THREE.Vector3(0,1600,0), gAz:DEG(214), gEl:DEG(46), gDist:52000,
 minDist:140, maxDist:150000,
 followFront:false, tour:false, tourIndex:0, tourAt:0,
};
const MIN_EL=DEG(2), MAX_EL=DEG(89.6);
const _eye=new THREE.Vector3(), _cs={s:0,d:0,sRaw:0};

function eyeFor(el){
 const ce=Math.cos(el), se=Math.sin(el);
 return _eye.set(
  CAM.target.x+CAM.distance*ce*Math.sin(CAM.azimuth),
  CAM.target.y+CAM.distance*se,
  CAM.target.z+CAM.distance*ce*Math.cos(CAM.azimuth));
}
function groundAtWorld(x,z){
 toCorridor(x,z,_cs);
 if(_cs.sRaw<0||_cs.sRaw>LENGTH) return BASE_Y;
 if(Math.abs(_cs.d)>CORR.half) return groundSD(_cs.s,Math.sign(_cs.d)*CORR.half);
 return groundSD(_cs.s,_cs.d);
}
// Terrain clearance. Lifting the eye vertically would break the orbit and leave
// the camera looking through a ridge, so raise the elevation angle until both
// the eye and the sight line clear the ground. In a gorge this is what stops a
// preset ending up inside the mountainside.
function clearElevation(el){
 const vy=uniforms.vertical.value;
 const margin=Math.max(45,CAM.distance*0.02);
 const blocked=e=>{
  const p=eyeFor(e);
  if(p.y<groundAtWorld(p.x,p.z)*vy+margin) return true;
  for(let i=1;i<10;i++){
   const f=i/10;
   const x=lerp(p.x,CAM.target.x,f), y=lerp(p.y,CAM.target.y,f), z=lerp(p.z,CAM.target.z,f);
   if(y<groundAtWorld(x,z)*vy+margin*0.55) return true;
  }
  return false;
 };
 if(!blocked(el)) return el;
 for(let i=1;i<=22;i++){
  const e=Math.min(MAX_EL,el+DEG(i*3.5));
  if(!blocked(e)) return e;
  if(e>=MAX_EL) break;
 }
 return MAX_EL;
}
function applyCamera(){
 const p=eyeFor(clearElevation(CAM.elevation));
 camera.position.copy(p);
 const floor=groundAtWorld(p.x,p.z)*uniforms.vertical.value+25;
 if(camera.position.y<floor) camera.position.y=floor;
 camera.lookAt(CAM.target);
 camera.near=clamp(CAM.distance*0.0018,3,120);
 camera.far=Math.max(60000,CAM.distance*7+LENGTH);
 camera.updateProjectionMatrix();
}
function clampCameraGoals(){
 CAM.gEl=clamp(CAM.gEl,MIN_EL,MAX_EL);
 CAM.gDist=clamp(CAM.gDist,CAM.minDist,CAM.maxDist);
 // Keep the pivot within the corridor plus a little slack.
 toCorridor(CAM.gTarget.x,CAM.gTarget.z,_cs);
 if(Math.abs(_cs.d)>CORR.half*1.25){
  const p=station(_cs.s,Math.sign(_cs.d)*CORR.half*1.25,0);
  CAM.gTarget.x=p.x; CAM.gTarget.z=p.z;
 }
 CAM.gTarget.y=clamp(CAM.gTarget.y,BASE_Y,MAX_H+2500);
}
function stepCamera(dt){
 if(CAM.followFront){
  const s=clamp(frontAt(S.time),0,LENGTH);
  const p=station(s,0,0);
  CAM.gTarget.set(p.x,Math.max(bed(s),p.y)+80,p.z);   // angle and distance stay the user's
 }
 clampCameraGoals();
 const k=1-Math.exp(-dt*7.5);
 let d=CAM.gAz-CAM.azimuth;
 while(d>Math.PI)d-=Math.PI*2; while(d<-Math.PI)d+=Math.PI*2;
 CAM.azimuth+=d*k;
 CAM.elevation+=(CAM.gEl-CAM.elevation)*k;
 CAM.distance*=Math.pow(CAM.gDist/CAM.distance,k);   // logarithmic: zoom feels even
 CAM.target.lerp(CAM.gTarget,k);
 applyCamera();
}
function snapCamera(){
 CAM.azimuth=CAM.gAz; CAM.elevation=CAM.gEl;
 CAM.distance=CAM.gDist; CAM.target.copy(CAM.gTarget);
 applyCamera();
}

// ── Presets ─────────────────────────────────────────────────────────────────
function poseAt(s,{dist,el,height=0}){
 const p=station(s,0,0), p2=station(Math.min(LENGTH,s+900),0,0);
 return {target:new THREE.Vector3(p.x,Math.max(bed(s),p.y)+height,p.z),
  az:Math.atan2(p2.x-p.x,p2.z-p.z)+Math.PI, el:DEG(el), dist};
}
let PRESETS=[];
function buildPresets(){
 PRESETS=[
  {key:'1',name:'Whole corridor',note:'93 km in one frame',
   pose:()=>({target:new THREE.Vector3(0,1200,0),az:DEG(214),el:DEG(46),dist:52000})},
  {key:'2',name:'Failure scar',note:'the source',
   pose:()=>poseAt(1400,{dist:9500,el:34,height:900})},
  {key:'3',name:'Debris dam',note:'timing is a hypothesis',
   pose:()=>poseAt(DAM_S,{dist:5600,el:30,height:420})},
  {key:'4',name:'Border · Rasuwagadhi',note:'Trishuli–Lhende confluence',
   pose:()=>poseAt(S_PORT,{dist:6200,el:27,height:420})},
  {key:'5',name:'Valley floor · Bidur',note:'human scale',
   pose:()=>poseAt(84500,{dist:2400,el:13,height:120})},
 ];
 const list=$('presetList');
 PRESETS.forEach((p,i)=>{
  const b=document.createElement('button');
  b.innerHTML=`<b>${p.key}</b> ${p.name}<br><span style="color:var(--dim)">${p.note}</span>`;
  b.onclick=()=>{cancelTour();gotoPreset(i);};
  list.appendChild(b);
 });
}
function gotoPreset(i){
 const p=PRESETS[i].pose();
 CAM.gTarget.copy(p.target); CAM.gAz=p.az; CAM.gEl=p.el; CAM.gDist=p.dist;
 clampCameraGoals();
}
function frameRoute(){
 CAM.gTarget.set(0,1200,0); CAM.gAz=DEG(214); CAM.gEl=DEG(46); CAM.gDist=52000;
}
function updateTour(dt){
 if(!CAM.tour) return;
 CAM.tourAt+=dt;
 if(CAM.tourAt>9){ CAM.tourAt=0; CAM.tourIndex=(CAM.tourIndex+1)%PRESETS.length; gotoPreset(CAM.tourIndex); }
 CAM.gAz+=dt*0.012;   // a slow, clinical drift; never a whip pan
}
function cancelTour(){
 if(!CAM.tour) return;
 CAM.tour=false; $('tourBtn').setAttribute('aria-pressed','false');
}

// ── Input, in stage-local coordinates ───────────────────────────────────────
const canvas=$('scene');
let drag=null;
const ndc=new THREE.Vector2(), ray=new THREE.Raycaster();
function stagePos(e){
 const r=stage.getBoundingClientRect();
 return {x:e.clientX-r.left, y:e.clientY-r.top, w:r.width, h:r.height};
}
// Where is the cursor pointing on the model? Zoom converges on what the user is
// actually looking at rather than on the middle of the box.
function pickGround(px,py,w,h){
 ndc.set(px/w*2-1,-(py/h*2-1));
 ray.setFromCamera(ndc,camera);
 const o=ray.ray.origin, d=ray.ray.direction;
 const vy=uniforms.vertical.value;
 const far=Math.min(CAM.distance*4+LENGTH,camera.far);
 let prev=o.y-groundAtWorld(o.x,o.z)*vy;
 const steps=90;
 for(let i=1;i<=steps;i++){
  const t=far*Math.pow(i/steps,1.7);
  const p=o.clone().addScaledVector(d,t);
  const cur=p.y-groundAtWorld(p.x,p.z)*vy;
  if(cur<0&&prev>=0){
   let lo=far*Math.pow((i-1)/steps,1.7), hi=t;
   for(let k=0;k<12;k++){
    const mid=(lo+hi)/2, q=o.clone().addScaledVector(d,mid);
    if(q.y-groundAtWorld(q.x,q.z)*vy<0) hi=mid; else lo=mid;
   }
   return o.clone().addScaledVector(d,(lo+hi)/2);
  }
  prev=cur;
 }
 return null;
}
canvas.addEventListener('pointerdown',e=>{
 canvas.setPointerCapture(e.pointerId);
 const p=stagePos(e);
 drag={id:e.pointerId,x:p.x,y:p.y,button:e.button,shift:e.shiftKey};
 cancelTour();
});
canvas.addEventListener('pointermove',e=>{
 if(!drag||drag.id!==e.pointerId) return;
 const p=stagePos(e);
 const dx=p.x-drag.x, dy=p.y-drag.y;
 drag.x=p.x; drag.y=p.y;
 if(drag.button===2||drag.shift){
  const scale=CAM.distance*0.0016;
  const s=Math.sin(CAM.azimuth), c=Math.cos(CAM.azimuth);
  CAM.gTarget.x-=(dx*c-dy*s)*scale;
  CAM.gTarget.z+=(dx*s+dy*c)*scale;
 }else{
  CAM.gAz-=dx*0.0052;
  CAM.gEl=clamp(CAM.gEl+dy*0.0040,MIN_EL,MAX_EL);
 }
 clampCameraGoals();
});
const endDrag=e=>{ if(drag&&drag.id===e.pointerId) drag=null; };
canvas.addEventListener('pointerup',endDrag);
canvas.addEventListener('pointercancel',endDrag);
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('wheel',e=>{
 // The page still scrolls past the model unless the pointer is over it and the
 // model is the thing being zoomed, so only swallow the event here.
 e.preventDefault(); cancelTour();
 const p=stagePos(e);
 const factor=Math.exp(clamp(e.deltaY,-260,260)*0.0016);
 const next=clamp(CAM.gDist*factor,CAM.minDist,CAM.maxDist);
 const hit=factor<1?pickGround(p.x,p.y,p.w,p.h):null;
 if(hit) CAM.gTarget.lerp(hit,clamp(1-next/CAM.gDist,0,.6));
 CAM.gDist=next;
 clampCameraGoals();
},{passive:false});

const touches=new Map();
canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')touches.set(e.pointerId,e);});
canvas.addEventListener('pointermove',e=>{
 if(e.pointerType!=='touch'||!touches.has(e.pointerId)) return;
 touches.set(e.pointerId,e);
 if(touches.size===2){
  const [a,b]=[...touches.values()];
  const d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
  if(canvas._pinch){
   CAM.gDist=clamp(CAM.gDist*(canvas._pinch/d),CAM.minDist,CAM.maxDist);
   clampCameraGoals();
  }
  canvas._pinch=d; drag=null;
 }
});
const dropTouch=e=>{touches.delete(e.pointerId); if(touches.size<2)canvas._pinch=0;};
canvas.addEventListener('pointerup',dropTouch);
canvas.addEventListener('pointercancel',dropTouch);

export {
  CAM, MIN_EL, MAX_EL, groundAtWorld, applyCamera, clampCameraGoals, stepCamera,
  snapCamera, PRESETS, buildPresets, gotoPreset, frameRoute, updateTour, cancelTour, pickGround
};
