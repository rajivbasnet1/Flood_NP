// ═══════════════════════════════════════════════════════════════════════════
// CORRIDOR — the elevation grid, the traced channel, and the event timeline.
// Everything downstream is a pure function of chainage and time, which is what
// makes the timeline randomly seekable in both directions.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp, lerp, smooth } from './util.js';
import { CORR, LENGTH, GEO, SCAR, CENTRE_PACKED, DEM_B64 } from './terrain-data.js';

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1 — CORRIDOR ELEVATION GRID
// The one embedded asset, and the reason the model reads as real landform.
// Stored in corridor space — rows are chainage, columns are lateral offset —
// so nothing outside the valley the flood travelled is carried at all. Delta
// predicted from the west and north neighbours, 3 m quantised, deflated,
// base64. Decoded with the platform's own DecompressionStream: no library.
// ════════════════════════════════════════════════════════════════════════════
let HEIGHT=null, MIN_H=0, MAX_H=0;

async function decodeDEM(){
 const bin=Uint8Array.from(atob(DEM_B64),c=>c.charCodeAt(0));
 if(typeof DecompressionStream!=='function')
  throw new Error('This browser lacks DecompressionStream, which the embedded elevation grid needs.');
 const stream=new Blob([bin]).stream().pipeThrough(new DecompressionStream('deflate'));
 const raw=new Int16Array(await new Response(stream).arrayBuffer());
 const {ns,nd,q}=CORR;
 const out=new Int16Array(ns*nd), h=new Float32Array(ns*nd);
 let mn=Infinity,mx=-Infinity;
 for(let i=0;i<ns;i++)for(let j=0;j<nd;j++){
  const k=i*nd+j, L=j>0?out[k-1]:0, U=i>0?out[k-nd]:0;
  out[k]=raw[k]+((j>0&&i>0)?((L+U)>>1):(j>0?L:U));
  const v=out[k]*q; h[k]=v;
  if(v<mn)mn=v; if(v>mx)mx=v;
 }
 HEIGHT=h; MIN_H=mn; MAX_H=mx;
}

// Bilinear ground elevation in corridor coordinates: s metres along the
// channel, d metres left of travel. Beyond the corridor it clamps to the edge,
// which only matters for the cut face and the camera floor.
function groundSD(s,d){
 const {ns,nd,half}=CORR;
 const u=clamp(s/LENGTH,0,1)*(ns-1);
 const v=clamp((d/half*.5+.5),0,1)*(nd-1);
 const i=Math.min(ns-2,Math.floor(u)), j=Math.min(nd-2,Math.floor(v));
 const fu=u-i, fv=v-j, k=i*nd+j;
 const a=HEIGHT[k],b=HEIGHT[k+1],c=HEIGHT[k+nd],e=HEIGHT[k+nd+1];
 return (a+(b-a)*fv)+((c+(e-c)*fv)-(a+(b-a)*fv))*fu;
}
const inCorridor=d=>Math.abs(d)<=CORR.half;

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2 — CORRIDOR
// The centreline was traced through the grid by priority-flood depression
// filling and D8 steepest descent from the scar, then resampled to even
// chainage. Packed here as world-metre triples: x east, z south, bed elevation.
// ════════════════════════════════════════════════════════════════════════════

const CN=384;
const cx=new Float32Array(CN), cz=new Float32Array(CN), cbed=new Float32Array(CN);
const cnx=new Float32Array(CN), cnz=new Float32Array(CN);
const ctx_=new Float32Array(CN), ctz=new Float32Array(CN);
const cwidth=new Float32Array(CN), ccurv=new Float32Array(CN), cslope=new Float32Array(CN);

function unpackCentre(){
 const p=CENTRE_PACKED.split(',');
 for(let i=0;i<CN;i++){ cx[i]=+p[i*3]; cz[i]=+p[i*3+1]; cbed[i]=+p[i*3+2]; }
 for(let i=0;i<CN;i++){
  const a=Math.max(0,i-1), b=Math.min(CN-1,i+1);
  const dx=cx[b]-cx[a], dz=cz[b]-cz[a], l=Math.hypot(dx,dz)||1;
  ctx_[i]=dx/l; ctz[i]=dz/l;
  cnx[i]=-ctz[i]; cnz[i]=ctx_[i];      // left of travel
 }
 // Signed curvature as kappa = dot(dT/ds, N). The stencil spans one chainage
 // step each way; tighter measures the trace's staircase, wider flattens real
 // meanders and the superelevation with them.
 const ds=LENGTH/(CN-1), SPAN=1;
 for(let i=0;i<CN;i++){
  const a=Math.max(0,i-SPAN), b=Math.min(CN-1,i+SPAN);
  ccurv[i]=((ctx_[b]-ctx_[a])*cnx[i]+(ctz[b]-ctz[a])*cnz[i])/Math.max(1,(b-a)*ds);
 }
 {const c=ccurv.slice(); for(let i=1;i<CN-1;i++) ccurv[i]=(c[i-1]+c[i]*2+c[i+1])/4;}
 for(let i=0;i<CN;i++){
  const a=Math.max(0,i-3), b=Math.min(CN-1,i+3);
  cslope[i]=Math.max(.0015,(cbed[a]-cbed[b])/Math.max(1,(b-a)*ds));
 }
 for(let p2=0;p2<2;p2++){const c=cslope.slice();for(let i=1;i<CN-1;i++)cslope[i]=(c[i-1]+c[i]*2+c[i+1])/4;}
}

// stationInto writes into a caller-owned vector and allocates nothing. The
// per-frame loops call this thousands of times; returning a fresh Vector3 each
// time was the largest single source of garbage, and the collections it forced
// were what made playback stutter rather than run evenly.
function stationInto(out,s,d=0,y=null){
 const u=clamp(s/LENGTH,0,1)*(CN-1), i=Math.min(CN-2,Math.floor(u)), f=u-i;
 const x=lerp(cx[i],cx[i+1],f)+lerp(cnx[i],cnx[i+1],f)*d;
 const z=lerp(cz[i],cz[i+1],f)+lerp(cnz[i],cnz[i+1],f)*d;
 return out.set(x,y===null?groundSD(s,d):y,z);
}
const _st=new THREE.Vector3();
// Convenience form for setup code and callers that keep the result.
function station(s,d=0,y=null){ return stationInto(_st,s,d,y).clone(); }
function sample(arr,s){const u=clamp(s/LENGTH,0,1)*(CN-1),i=Math.min(CN-2,Math.floor(u));return lerp(arr[i],arr[i+1],u-i);}
const bed=s=>sample(cbed,s);
const valleyWidth=s=>sample(cwidth,s);
const curvature=s=>sample(ccurv,s);
const slope=s=>sample(cslope,s);
const lonLatAt=(s,d=0)=>{
 const p=station(s,d,0);
 return [GEO.lon0+(p.x+GEO.ox)/GEO.klon, GEO.lat0-(p.z+GEO.oz)/GEO.klat];
};

// ── world XZ -> (chainage, lateral) ─────────────────────────────────────────
// The terrain mesh is built in world space so it never folds on a tight bend,
// but its heights come from the corridor grid. That needs a nearest-point
// lookup, bucketed so it stays cheap over a few hundred thousand vertices.
const BCELL=2500;
let BX=0,BZ=0,BMINX=0,BMINZ=0,buckets=null;
function buildBuckets(){
 let mnx=Infinity,mxx=-Infinity,mnz=Infinity,mxz=-Infinity;
 for(let i=0;i<CN;i++){mnx=Math.min(mnx,cx[i]);mxx=Math.max(mxx,cx[i]);mnz=Math.min(mnz,cz[i]);mxz=Math.max(mxz,cz[i]);}
 BMINX=mnx-CORR.half*1.4; BMINZ=mnz-CORR.half*1.4;
 BX=Math.ceil((mxx-mnx+CORR.half*2.8)/BCELL); BZ=Math.ceil((mxz-mnz+CORR.half*2.8)/BCELL);
 buckets=Array.from({length:BX*BZ},()=>[]);
 for(let i=0;i<CN;i++){
  const bi=clamp(Math.floor((cx[i]-BMINX)/BCELL),0,BX-1), bj=clamp(Math.floor((cz[i]-BMINZ)/BCELL),0,BZ-1);
  for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){
   const a=bi+di,b=bj+dj; if(a<0||b<0||a>=BX||b>=BZ)continue;
   buckets[b*BX+a].push(i);
  }
 }
}
// Returns {s, d} for a world position. d is signed, left of travel positive.
function toCorridor(x,z,out){
 const bi=clamp(Math.floor((x-BMINX)/BCELL),0,BX-1), bj=clamp(Math.floor((z-BMINZ)/BCELL),0,BZ-1);
 let list=buckets[bj*BX+bi], best=-1, bd=Infinity;
 if(!list.length) list=null;
 if(list){
  for(const n of list){
   const dx=cx[n]-x, dz=cz[n]-z, q=dx*dx+dz*dz;
   if(q<bd){bd=q;best=n;}
  }
 }
 if(best<0){ for(let n=0;n<CN;n++){const dx=cx[n]-x,dz=cz[n]-z,q=dx*dx+dz*dz;if(q<bd){bd=q;best=n;}} }
 const n=best, vx=x-cx[n], vz=z-cz[n];
 const along=vx*ctx_[n]+vz*ctz[n];
 // sRaw is deliberately NOT clamped. Every point upstream of the channel head
 // has its nearest centreline sample at index 0, and every point past the end
 // has it at the last index; clamping would map those entire half-planes onto
 // the first and last cross-sections and extrude them as flat slabs off both
 // ends of the block. Callers cull on sRaw and sample heights with s.
 out.sRaw=n/(CN-1)*LENGTH+along;
 out.s=clamp(out.sRaw,0,LENGTH);
 out.d=vx*cnx[n]+vz*cnz[n];
 return out;
}
const _sd={s:0,d:0,sRaw:0};
function ground(x,z){ toCorridor(x,z,_sd); return groundSD(_sd.s,_sd.d); }
// Inside the block means inside the band AND between the channel ends.
const inBox=(x,z)=>{ toCorridor(x,z,_sd); return Math.abs(_sd.d)<=CORR.half && _sd.sRaw>=0 && _sd.sRaw<=LENGTH; };

// Valley width measured from the grid: how far the ground stays within 30 m of
// the bed on each side. A measurement, not a stylistic choice, and it is what
// makes the gorge and the braided lower reach behave differently.
function measureWidths(){
 for(let i=0;i<CN;i++){
  const s=i/(CN-1)*LENGTH, b=cbed[i]; let w=0;
  for(const side of [-1,1]){
   let d=0;
   for(;d<1800;d+=30) if(groundSD(s,side*d)>b+30) break;
   w+=d;
  }
  cwidth[i]=Math.max(60,w/2);
 }
 for(let p=0;p<3;p++){const c=cwidth.slice();for(let i=1;i<CN-1;i++)cwidth[i]=(c[i-1]+c[i]*2+c[i+1])/4;}
}
const ribbonHalf=s=>clamp(valleyWidth(s)*2.6+180,260,1500);

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3 — TIMELINE
// Absolute physical seconds from the collapse. Everything downstream is a pure
// function of t, so the timeline is random-access in both directions: scrubbing
// backwards restores depth, debris, deposition, damage and trim line because
// none of them integrate history.
// ════════════════════════════════════════════════════════════════════════════
const S_PORT=21780;        // Rasuwagadhi / Gyirong Port confluence, from the trace
const T_PORT=420;          // REPORTED ~7 minutes
const T_IMPACT=20;         // MODELLED entrainment delay
const C0=S_PORT/(T_PORT-T_IMPACT);   // 54.5 m/s, consistent with the reported ~193 km/h
const C1=8.5, LTAP=3500;
const T_BLOCK=120, T_BREACH=480, T_WIDEN=300;

function arrival(s){
 s=clamp(s,0,LENGTH);
 if(s<=S_PORT) return T_IMPACT+s/C0;
 const u=s-S_PORT;
 return T_PORT+u/C1+(1/C0-1/C1)*LTAP*(1-Math.exp(-u/LTAP));
}
function celerity(s){
 s=clamp(s,0,LENGTH);
 if(s<=S_PORT) return C0;
 return 1/(1/C1+(1/C0-1/C1)*Math.exp(-(s-S_PORT)/LTAP));
}
function frontAt(t){
 if(t<=T_IMPACT) return 0;
 if(t<=T_PORT) return (t-T_IMPACT)*C0;
 let s=S_PORT+(t-T_PORT)*C1;
 for(let i=0;i<6;i++){
  const e=arrival(s)-t; if(Math.abs(e)<.05) break;
  s=clamp(s-e*celerity(s),0,LENGTH+1);
 }
 return clamp(s,0,LENGTH);
}
function peak(s){
 s=clamp(s,0,LENGTH);
 return s<6000?lerp(20,66,s/6000):lerp(66,10,Math.pow((s-6000)/(LENGTH-6000),.62));
}
function stageAt(s,t){
 const rise=lerp(6,900,Math.pow(s/LENGTH,2)), decay=lerp(400,2600,s/LENGTH);
 const a1=t-arrival(s);
 const p1=smooth(0,rise,a1)*Math.exp(-Math.max(0,a1-rise)/decay);
 const a2=a1-T_BREACH;
 const p2=smooth(0,rise*1.5,a2)*Math.exp(-Math.max(0,a2-rise*1.5)/(decay*1.6));
 const sh=Math.max(p1,p2*.78)+Math.min(p1,p2*.78)*.35;
 return peak(s)*clamp(sh,0,1);
}
// GLSL twins — identical algebra, so the shaders and the HUD never disagree.
const timelineGLSL=`
 const float S_PORT=${S_PORT.toFixed(1)}, T_PORT=${T_PORT.toFixed(1)}, T_IMPACT=${T_IMPACT.toFixed(1)};
 const float C0=${C0.toFixed(6)}, C1=${C1.toFixed(4)}, LTAP=${LTAP.toFixed(1)}, LEN=${LENGTH.toFixed(1)};
 float arrival(float s){s=clamp(s,0.,LEN);
  if(s<=S_PORT) return T_IMPACT+s/C0;
  float u=s-S_PORT;
  return T_PORT+u/C1+(1./C0-1./C1)*LTAP*(1.-exp(-u/LTAP));}
 float celerity(float s){s=clamp(s,0.,LEN);
  if(s<=S_PORT) return C0;
  return 1./(1./C1+(1./C0-1./C1)*exp(-(s-S_PORT)/LTAP));}
 float peakStage(float s){s=clamp(s,0.,LEN);
  return s<6000.?mix(20.,66.,s/6000.):mix(66.,10.,pow((s-6000.)/(LEN-6000.),.62));}
 float stageAt(float s,float t){
  float rise=mix(6.,900.,pow(s/LEN,2.)), decay=mix(400.,2600.,s/LEN);
  float a1=t-arrival(s);
  float p1=smoothstep(0.,rise,a1)*exp(-max(0.,a1-rise)/decay);
  float a2=a1-${T_BREACH.toFixed(1)};
  float p2=smoothstep(0.,rise*1.5,a2)*exp(-max(0.,a2-rise*1.5)/(decay*1.6));
  float sh=max(p1,p2*.78)+min(p1,p2*.78)*.35;
  return peakStage(s)*clamp(sh,0.,1.);}
`;
function formatTime(t){
 const v=Math.floor(Math.abs(t)), sign=t<0?'−':'+';
 return 'T'+sign+String(Math.floor(v/3600)).padStart(2,'0')+':'+
  String(Math.floor(v/60)%60).padStart(2,'0')+':'+String(v%60).padStart(2,'0');
}

let BEATS=[];
function buildBeats(){
 BEATS=[
  {t:-30,label:'Pre-event',note:'Monsoon river, valley intact',sourced:false},
  {t:0,label:'Collapse',note:'Rock and hanging ice detach on the north flank',sourced:true},
  {t:T_IMPACT,label:'Impact',note:'Fall of ~1,200 m onto the glacier below; powder cloud',sourced:true},
  {t:T_BLOCK,label:'Blockage',note:'Debris crosses and obstructs the Lhende Khola',sourced:false},
  {t:300,label:'Impoundment',note:'A short-lived lake fills behind the barrier',sourced:false},
  {t:T_PORT,label:'Border',note:'Front reaches Gyirong Port / Rasuwagadhi, ~7 min',sourced:true},
  {t:T_BREACH,label:'Breach',note:'Overtopping notch incises and widens; second pulse',sourced:false},
  {t:Math.round(arrival(24500)),label:'Timure',note:'Confined bedrock reach',sourced:false},
  {t:Math.round(arrival(37100)),label:'Syafrubesi',note:'Bhote Koshi / Trishuli gorge',sourced:false},
  {t:Math.round(arrival(68940)),label:'Betrawati',note:'Valley widens; the front spreads and slows',sourced:false},
  {t:Math.round(arrival(81800)),label:'Devighat',note:'Braided gravel-bed reach',sourced:false},
  {t:Math.round(arrival(LENGTH))+900,label:'Recession',note:'Deposition, trim line, changed valley',sourced:false},
 ];
}

export {
  CORR, LENGTH, GEO, SCAR,
  decodeDEM, groundSD, HEIGHT, MIN_H, MAX_H,
  CN, cx, cz, cbed, cnx, cnz, ctx_, ctz,
  unpackCentre, station, stationInto, bed, valleyWidth, curvature, slope, lonLatAt,
  buildBuckets, toCorridor, ground, inBox, measureWidths, ribbonHalf,
  S_PORT, T_PORT, T_IMPACT, C0, C1, LTAP, T_BLOCK, T_BREACH, T_WIDEN,
  arrival, celerity, frontAt, peak, stageAt, timelineGLSL, formatTime, BEATS, buildBeats
};
