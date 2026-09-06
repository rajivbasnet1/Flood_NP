// ═══════════════════════════════════════════════════════════════════════════
// THE PAGE AROUND THE MODEL — reported toll, the flat corridor map, and the
// wireframe hero. All of it is built before the 3D model loads, so the page
// reads even if the CDN is unreachable or WebGL is unavailable.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { $, clamp } from './util.js';
import { CORR, LENGTH, CN, cx, cz, station, groundSD, valleyWidth } from './corridor.js';
import { TOLL } from './data.js';

// ════════════════════════════════════════════════════════════════════════════
// SECTION 25 — THE PAGE AROUND THE MODEL
// Reported toll, the flat corridor map, and the donation QR. All of this is
// built before the 3D model loads, so the page reads even if the CDN is
// unreachable or WebGL is unavailable.
// ════════════════════════════════════════════════════════════════════════════

// Sites that lay in the flow path. These mark WHERE THE FLOOD WENT. They are
// not per-place death counts and are not scaled to casualties: no
// village-by-village breakdown has been published, and inventing one would be
// worse than showing nothing.
const IMPACT=[
 {s:0,     name:'Failure scar',            kind:'scar', note:'North flank of Langtang Lirung, ~5,000 m'},
 {s:5400,  name:'Debris dam',              kind:'site', note:'Lhende Khola blocked, then breached'},
 {s:21780, name:'Gyirong Port / Rasuwagadhi', kind:'town', note:'Border crossing at the confluence'},
 {s:24500, name:'Timure',                  kind:'town', note:'Confined bedrock reach'},
 {s:27400, name:'Rasuwagadhi hydropower',  kind:'infra',note:'Schematic site'},
 {s:37100, name:'Syafrubesi',              kind:'town', note:'Bhote Koshi / Trishuli gorge'},
 {s:52000, name:'Mailung',                 kind:'town', note:'Confined gorge'},
 {s:68940, name:'Betrawati',               kind:'town', note:'Valley widens'},
 {s:76200, name:'Trishuli Bazaar',         kind:'town', note:'27.9227° N, 85.1462° E'},
 {s:81800, name:'Devighat',                kind:'infra',note:'27.8882° N, 85.1340° E'},
 {s:84500, name:'Bidur',                   kind:'town', note:'Town centre sits back from the channel'},
];

function buildSite(){
 // ── reported toll ──
 const grid=$('tollgrid');
 for(const t of TOLL){
  const d=document.createElement('div');
  d.className='toll';
  d.innerHTML=`<div class="n${t.red?' red':''}">${t.n}</div>`
   +`<div class="k">${t.k}</div><div class="src">${t.src}</div>`;
  grid.appendChild(d);
 }
 $('tollNote').innerHTML='All figures are <b>reported</b> figures with the date they were attributed to, '
  +'and were still being revised when this page was built — the missing count in particular. '
  +'They are shown once, here, and nowhere inside the reconstruction. '
  +'Sources are listed in full under the model.';

}

// ── the flat corridor map ───────────────────────────────────────────────────
// Drawn from the same traced centreline as the 3D model, so the two cannot
// disagree about where the river goes.
function buildFlatMap(){
 const svg=$('flatmap');
 const W=760,H=470,PAD=42;
 let mnx=Infinity,mxx=-Infinity,mnz=Infinity,mxz=-Infinity;
 for(let i=0;i<CN;i++){mnx=Math.min(mnx,cx[i]);mxx=Math.max(mxx,cx[i]);mnz=Math.min(mnz,cz[i]);mxz=Math.max(mxz,cz[i]);}
 const sc=Math.min((W-PAD*2)/(mxx-mnx),(H-PAD*2)/(mxz-mnz));
 const px=x=>PAD+(x-mnx)*sc+((W-PAD*2)-(mxx-mnx)*sc)/2;
 const py=z=>PAD+(z-mnz)*sc+((H-PAD*2)-(mxz-mnz)*sc)/2;

 const parts=[];
 // Corridor band, to show the extent the model covers.
 const bandL=[],bandR=[];
 for(let i=0;i<CN;i+=2){
  const s=i/(CN-1)*LENGTH;
  const a=station(s,CORR.half,0), b=station(s,-CORR.half,0);
  bandL.push(`${px(a.x).toFixed(1)},${py(a.z).toFixed(1)}`);
  bandR.push(`${px(b.x).toFixed(1)},${py(b.z).toFixed(1)}`);
 }
 parts.push(`<polygon points="${bandL.concat(bandR.reverse()).join(' ')}" fill="#ffffff07" stroke="#ffffff12" stroke-width="1"/>`);

 // The channel.
 let d='';
 for(let i=0;i<CN;i++) d+=(i?'L':'M')+px(cx[i]).toFixed(1)+' '+py(cz[i]).toFixed(1);
 parts.push(`<path d="${d}" fill="none" stroke="#c88f4e" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity=".95"/>`);
 parts.push(`<path d="${d}" fill="none" stroke="#c88f4e" stroke-width="7" stroke-linecap="round" opacity=".10"/>`);

 // Kilometre ticks every 10 km.
 for(let km=10;km<Math.floor(LENGTH/1000);km+=10){
  const s=km*1000;
  const a=station(s,0,0), n=station(s,900,0);
  const ux=(px(n.x)-px(a.x)), uy=(py(n.z)-py(a.z));
  const l=Math.hypot(ux,uy)||1;
  parts.push(`<line x1="${(px(a.x)-ux/l*4).toFixed(1)}" y1="${(py(a.z)-uy/l*4).toFixed(1)}" x2="${(px(a.x)+ux/l*4).toFixed(1)}" y2="${(py(a.z)+uy/l*4).toFixed(1)}" stroke="#ffffff33" stroke-width="1.2"/>`);
  parts.push(`<text x="${(px(a.x)+ux/l*13).toFixed(1)}" y="${(py(a.z)+uy/l*13+3).toFixed(1)}" fill="#5e5e5e" font-size="8.5" font-family="ui-monospace,monospace" text-anchor="middle">${km}</text>`);
 }

 // Impact sites. Labels alternate away from a neighbour that is too close,
 // which matters at the top of the corridor where the scar, the debris dam and
 // the border crossing sit within a few kilometres of each other.
 const placed=[];
 for(const p of IMPACT){
  const q=station(p.s,0,0);
  const X=px(q.x); let Y=py(q.z);
  const isScar=p.kind==='scar';
  const flip=X>W*0.55;
  let ty=Y+3.4;
  for(const q2 of placed) if(Math.abs(q2.x-X)<150&&Math.abs(q2.y-ty)<13) ty=q2.y+13;
  placed.push({x:X,y:ty});
  if(isScar){
   parts.push(`<circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="5" fill="none" stroke="#ffffff" stroke-width="1.6"/>`);
   parts.push(`<circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="1.8" fill="#ffffff"/>`);
  }else{
   parts.push(`<circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="8" fill="#d4574a" opacity=".16"/>`);
   parts.push(`<circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="3.6" fill="#d4574a"/>`);
  }
  parts.push(`<text x="${(X+(flip?-10:10)).toFixed(1)}" y="${ty.toFixed(1)}" fill="#c9c9c9" font-size="10.5"
   font-family="ui-monospace,monospace" text-anchor="${flip?'end':'start'}">${p.name}</text>`);
 }

 // Direction of travel.
 const midA=station(LENGTH*.46,0,0), midB=station(LENGTH*.52,0,0);
 const ax=px(midA.x),ay=py(midA.z),bx=px(midB.x),by=py(midB.z);
 const ang=Math.atan2(by-ay,bx-ax)*180/Math.PI;
 parts.push(`<g transform="translate(${bx.toFixed(1)},${by.toFixed(1)}) rotate(${ang.toFixed(1)})">
  <path d="M0,0 L-9,-4 L-9,4 Z" fill="#c88f4e"/></g>`);
 parts.push(`<text x="${PAD}" y="${H-14}" fill="#5e5e5e" font-size="10" font-family="ui-monospace,monospace">
  93.1 km of traced channel · water ran north-east to south-west, from the scar to Devighat</text>`);

 svg.innerHTML=parts.join('');
}

// ── wireframe hero ──────────────────────────────────────────────────────────
// The same corridor as the model below, drawn as line art on black. It is our
// own terrain rather than stock artwork, it costs a 2D canvas rather than a
// second WebGL context, and it stops entirely once scrolled past.
function buildHero(){
 const cv=$('heroCanvas'); if(!cv) return;
 const ctx=cv.getContext('2d');
 let W=0,H=0,spin=0,live=true,raf=0,scale=1,yScale=1;

 // A coarse lattice over the corridor: cheap enough to redraw as plain lines.
 const NS=140, ND=9, rows=[];
 for(let i=0;i<NS;i++){
  const s=i/(NS-1)*LENGTH, row=[];
  for(let j=0;j<ND;j++){
   const d=(j/(ND-1)*2-1)*CORR.half;
   const p=station(s,d,0);
   row.push({x:p.x,z:p.z,y:groundSD(s,d)});
  }
  rows.push(row);
 }
 let lo=Infinity,hi=-Infinity;
 for(const r of rows) for(const p of r){ if(p.y<lo)lo=p.y; if(p.y>hi)hi=p.y; }

 function size(){
  const r=cv.getBoundingClientRect();
  const dpr=Math.min(devicePixelRatio||1,2);
  W=Math.max(2,Math.round(r.width*dpr));
  H=Math.max(2,Math.round(r.height*dpr));
  if(cv.width!==W||cv.height!==H){ cv.width=W; cv.height=H; }
 }
 // Axonometric, deliberately: no perspective, so it reads as a diagram.
 function project(p,cos,sin,out){
  const x=p.x*cos-p.z*sin, z=p.x*sin+p.z*cos;
  out[0]=W*0.5+x*scale;
  out[1]=H*0.52+z*scale*0.46-((p.y-lo)/(hi-lo))*yScale;
 }
 const a=[0,0];
 function draw(){
  size();
  scale=Math.min(W,H)/54000; yScale=Math.min(W,H)*0.30;
  ctx.clearRect(0,0,W,H);
  const cos=Math.cos(spin), sin=Math.sin(spin);
  ctx.lineWidth=Math.max(1,W/1500);
  // Cross-sections, fading toward both ends of the reach.
  for(let i=0;i<NS;i++){
   const t=i/(NS-1);
   ctx.beginPath();
   for(let j=0;j<ND;j++){ project(rows[i][j],cos,sin,a); j?ctx.lineTo(a[0],a[1]):ctx.moveTo(a[0],a[1]); }
   ctx.strokeStyle='rgba(255,255,255,'+(0.04+0.22*Math.sin(Math.PI*t)).toFixed(3)+')';
   ctx.stroke();
  }
  // Long rails, brightest along the valley floor.
  for(let j=0;j<ND;j++){
   ctx.beginPath();
   for(let i=0;i<NS;i++){ project(rows[i][j],cos,sin,a); i?ctx.lineTo(a[0],a[1]):ctx.moveTo(a[0],a[1]); }
   const edge=Math.abs(j/(ND-1)*2-1);
   ctx.strokeStyle='rgba(255,255,255,'+(0.32-0.20*edge).toFixed(3)+')';
   ctx.stroke();
  }
  // The channel itself: the one warm note anywhere on the page.
  ctx.beginPath();
  const mid=(ND-1)>>1;
  for(let i=0;i<NS;i++){ project(rows[i][mid],cos,sin,a); i?ctx.lineTo(a[0],a[1]):ctx.moveTo(a[0],a[1]); }
  ctx.strokeStyle='rgba(200,143,78,0.9)';
  ctx.lineWidth=Math.max(1.4,W/950);
  ctx.stroke();
 }
 function tick(){ if(!live){ raf=0; return; } spin+=0.0015; draw(); raf=requestAnimationFrame(tick); }

 if(typeof IntersectionObserver==='function'){
  new IntersectionObserver(e=>{
   live=e[0].isIntersecting;
   if(live&&!raf) raf=requestAnimationFrame(tick);
  },{rootMargin:'80px'}).observe(cv);
 }
 addEventListener('resize',draw);
 draw();
 raf=requestAnimationFrame(tick);
}

export { IMPACT, buildSite, buildFlatMap, buildHero };
