// ═══════════════════════════════════════════════════════════════════════════
// OVERLAYS — neutral massing for the built environment, vegetation, the flood
// band that carries the wave at any zoom, the peak-extent layer, deposition.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp, lerp, smooth, random } from './util.js';
import {
  CORR, LENGTH, station, stationInto, groundSD, bed, valleyWidth, ribbonHalf,
  arrival, peak, stageAt, timelineGLSL
} from './corridor.js';
import { world, uniforms } from './scene.js';
import { dummy, EPS, hideInstance, safeScale } from './flow.js';

// ════════════════════════════════════════════════════════════════════════════
// SECTION 14 — PLACES
// Chainages are where each place falls on the traced channel. Coordinates that
// come from a gazetteer are marked; the rest are channel positions.
// ════════════════════════════════════════════════════════════════════════════
const PLACES=[
 {s:0,     name:'Langtang Lirung · north flank', sub:'Failure scar · 28.2853° N, 85.5252° E', kind:'site'},
 {s:5400,  name:'Lhende Khola · temporary blockage', sub:'Debris dam and impoundment · timing modelled', kind:'site'},
 {s:21780, name:'Gyirong Port / Rasuwagadhi', sub:'Trishuli–Lhende confluence · border crossing', kind:'town'},
 {s:24500, name:'Timure', sub:'Confined bedrock reach', kind:'town'},
 {s:27400, name:'Rasuwagadhi hydropower', sub:'Schematic massing at an approximate site', kind:'infra'},
 {s:37100, name:'Syafrubesi', sub:'Bhote Koshi / Trishuli gorge', kind:'town'},
 {s:52000, name:'Mailung reach', sub:'Confined gorge', kind:'town'},
 {s:68940, name:'Betrawati', sub:'Valley widens; braided gravel bed begins', kind:'town'},
 {s:76200, name:'Trishuli Bazaar', sub:'27.9227° N, 85.1462° E (gazetteer)', kind:'town'},
 {s:81800, name:'Devighat', sub:'27.8882° N, 85.1340° E (gazetteer)', kind:'infra'},
 {s:84500, name:'Bidur', sub:'Town centre sits back from the channel', kind:'town'},
 {s:93080, name:'Model boundary', sub:'The block ends here — no terrain beyond', kind:'edge'},
];
const INFRA=[
 {s:21780,name:'Border crossing & customs',type:'bridge'},
 {s:27400,name:'Rasuwagadhi hydropower',type:'power'},
 {s:37100,name:'Road bridge',type:'bridge'},
 {s:52000,name:'Suspension bridge',type:'bridge'},
 {s:76200,name:'Trishuli intake',type:'power'},
 {s:81800,name:'Devighat powerhouse',type:'power'},
];

// ════════════════════════════════════════════════════════════════════════════
// SECTION 15 — BUILT ENVIRONMENT AND VEGETATION
// Neutral, diagrammatic massing. These exist to show what was in the flow path
// and how deep the modelled flow reached — not to stage destruction. Exposed
// structures fade to a removed state with a caption. Nothing collapses on
// screen, and there are no people, vehicles or occupants anywhere in the model.
// ════════════════════════════════════════════════════════════════════════════
let buildings=null, buildData=[], buildFade=null, trees=null, treeData=[], infraGroup=null, roadLine=null;
function buildBuilt(){
 const mat=new THREE.MeshStandardMaterial({color:0xaeb7b4,roughness:1});
 mat.customProgramCacheKey=()=>'buildings-v1';
 buildings=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),mat,190);
 buildings.frustumCulled=false; world.add(buildings);
 buildFade=new THREE.InstancedBufferAttribute(new Float32Array(190).fill(1),1);
 buildings.geometry.setAttribute('instanceFade',buildFade);
 mat.transparent=true;
 mat.onBeforeCompile=sh=>{
  sh.vertexShader='attribute float instanceFade; varying float vFade;\n'
   +sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n vFade=instanceFade;');
  sh.fragmentShader='varying float vFade;\n'
   +sh.fragmentShader.replace('#include <color_fragment>',
    '#include <color_fragment>\n diffuseColor.a*=vFade;\n diffuseColor.rgb=mix(vec3(.30,.31,.30),diffuseColor.rgb,vFade);');
 };
 const towns=PLACES.filter(p=>p.kind==='town');
 for(let i=0;i<buildings.count;i++){
  const site=towns[i%towns.length];
  const s=clamp(site.s+(random()-.5)*1600,200,LENGTH-200);
  const side=(i%2?1:-1);
  const d=side*(valleyWidth(s)*1.05+random()*260+30);
  const p=station(s,d,0);
  const h=groundSD(s,d);
  buildData.push({s,d,x:p.x,z:p.z,h,w:9+random()*15,ht:5+random()*11,rot:random()*3.14});
 }
 // Accent colour on the few structures that read as public infrastructure.
 infraGroup=new THREE.Group(); world.add(infraGroup);
 const imat=new THREE.MeshStandardMaterial({color:0x9ec7dd,roughness:.85});
 const gmat=new THREE.MeshStandardMaterial({color:0x8d9793,roughness:.95});
 for(const it of INFRA){
  const g=new THREE.Group();
  const p=station(it.s), p2=station(it.s+40), w=valleyWidth(it.s);
  g.position.copy(p); g.rotation.y=Math.atan2(p2.x-p.x,p2.z-p.z);
  if(it.type==='bridge'){
   const deck=new THREE.Mesh(new THREE.BoxGeometry(Math.min(w*2.4,420),2.6,7),imat);
   deck.position.y=bed(it.s)-p.y+Math.max(14,peak(it.s)*.22);
   g.add(deck);
   for(const side of [-1,1]){
    const t=new THREE.Mesh(new THREE.BoxGeometry(7,46,8),gmat);
    t.position.set(side*Math.min(w*1.15,190),bed(it.s)-p.y+30,0); g.add(t);
   }
  }else{
   const house=new THREE.Mesh(new THREE.BoxGeometry(62,20,28),imat);
   house.position.set(Math.min(w*1.5,220),bed(it.s)-p.y+12,0); g.add(house);
   const intake=new THREE.Mesh(new THREE.BoxGeometry(22,26,16),gmat);
   intake.position.set(-Math.min(w*1.2,150),bed(it.s)-p.y+13,60); g.add(intake);
  }
  infraGroup.add(g);
 }
 // The highway, as a thin line of massing on one bank. Not a map overlay.
 const rp=[];
 for(let s=20000;s<=LENGTH-1500;s+=200){
  const d=valleyWidth(s)*1.9+90;
  const p=station(s,d,0); rp.push(new THREE.Vector3(p.x,groundSD(s,d)+3,p.z));
 }
 roadLine=new THREE.Mesh(
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rp),rp.length,6,4,false),
  new THREE.MeshStandardMaterial({color:0x6b6f6d,roughness:1}));
 infraGroup.add(roadLine);

 // Vegetation: instanced cones on the forested valley walls, stripped below the
 // trim line once the wave has passed.
 trees=new THREE.InstancedMesh(new THREE.ConeGeometry(1,1,5),
  new THREE.MeshStandardMaterial({color:0x24452f,roughness:.98}),3400);
 trees.frustumCulled=false; world.add(trees);
 for(let i=0;i<trees.count;i++){
  const s=lerp(24000,LENGTH,Math.pow(random(),.85));
  const d=(random()<.5?-1:1)*(valleyWidth(s)*1.25+Math.pow(random(),1.6)*2400);
  const p=station(s,d,0), h=groundSD(s,d);
  if(h>3400||Math.abs(d)>CORR.half*.92){ treeData.push(null); continue; }
  treeData.push({s,x:p.x,z:p.z,h,r:9+random()*13,ht:12+random()*20});
 }
}
// Structures and vegetation only change while the front is passing them, and
// then only over a couple of minutes of event time. Rebuilding 190 buildings
// and 3,400 trees on every single frame was pure waste; this rebuilds them
// when the event clock has actually moved enough to change anything.
let builtStamp=NaN;
function updateBuilt(t,force){
 if(!buildings) return;
 if(!force && Math.abs(t-builtStamp)<4) return;
 builtStamp=t;
 for(let i=0;i<buildData.length;i++){
  const p=buildData[i];
  const exposed=p.h<bed(p.s)+peak(p.s);
  const fade=exposed?1-smooth(arrival(p.s)+40,arrival(p.s)+200,t):1;
  buildFade.array[i]=Math.max(exposed?0:1,fade);
  dummy.position.set(p.x,p.h+p.ht*.5,p.z);
  dummy.rotation.set(0,p.rot,0);
  safeScale(p.w,p.ht,p.w*.8);
  dummy.updateMatrix(); buildings.setMatrixAt(i,dummy.matrix);
 }
 buildings.instanceMatrix.needsUpdate=true; buildFade.needsUpdate=true;
 for(let i=0;i<treeData.length;i++){
  const p=treeData[i];
  if(!p){ hideInstance(); dummy.updateMatrix(); trees.setMatrixAt(i,dummy.matrix); continue; }
  const below=p.h<bed(p.s)+peak(p.s);
  const strip=below?smooth(arrival(p.s)+20,arrival(p.s)+180,t):0;
  dummy.position.set(p.x,p.h+p.ht*.5,p.z);
  dummy.rotation.set(0,0,0);
  // A stripped tree shrinks away entirely rather than flattening, which
  // would leave a degenerate matrix.
  const k=Math.max(EPS,1-strip);
  dummy.scale.set(p.r*k,p.ht*k,p.r*k);
  dummy.updateMatrix(); trees.setMatrixAt(i,dummy.matrix);
 }
 trees.instanceMatrix.needsUpdate=true;
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 16 — ROUTE RIBBON, KILOMETRE MARKS AND PEAK INUNDATION
// With these on and the timeline at T+0 the whole answer to "where did the
// water go" is already readable in a single frame.
// ════════════════════════════════════════════════════════════════════════════
let ribbon=null, ribbonMat=null, peakMesh=null, peakMat=null;
function buildOverlays(){
 // The flood band. At a whole-corridor view the water surface itself is a
 // couple of pixels wide in the gorge — physically correct and visually
 // useless. This band is the layer that actually carries the flood: it is as
 // wide as the flooded valley floor, it glows where the flow is deep and
 // active, and it leaves a record of where the water has been.
 const pos=[],uvs=[],idx=[];
 const RN=1024, RM=6;
 for(let i=0;i<=RN;i++){
  const s=i/RN*LENGTH;
  const half=clamp(valleyWidth(s)*1.5+140,260,900);
  for(let j=0;j<=RM;j++){
   const side=j/RM*2-1;
   const d=side*half;
   const p=station(s,d,0);
   // Ride above the local ground so it is never buried by the terrain, but
   // stay low enough to read as lying in the valley.
   pos.push(p.x,groundSD(s,d)+70,p.z);
   uvs.push(s/LENGTH,j/RM);
  }
 }
 for(let i=0;i<RN;i++)for(let j=0;j<RM;j++){
  const k=i*(RM+1)+j; idx.push(k,k+RM+1,k+1,k+1,k+RM+1,k+RM+2);
 }
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
 g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
 g.setIndex(idx); g.computeBoundingSphere();
 ribbonMat=new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,side:THREE.DoubleSide,
  blending:THREE.AdditiveBlending,
  uniforms:{uTime:uniforms.time,vertical:uniforms.vertical},
  vertexShader:`varying vec2 vUv; uniform float vertical;
   void main(){vUv=uv;vec3 p=position;p.y*=vertical;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
  fragmentShader:`precision highp float; varying vec2 vUv; uniform float uTime;
   ${timelineGLSL}
   void main(){
    float s=vUv.x*LEN;
    float ar=arrival(s);
    float depth=stageAt(s,uTime);
    float across=abs(vUv.y*2.-1.);
    // Concentrated on the channel, falling off toward the valley sides.
    float core=1.-smoothstep(.0,1.,across);
    core=core*core;

    // Ahead of the front: a quiet dashed line showing the path to come.
    float ahead=1.-step(ar,uTime);
    vec3 c=vec3(.18,.23,.27)*(0.35+0.65*step(.5,fract(s/1400.)))*ahead*core;

    // Behind it: a warm record of where the water reached, fading slowly.
    float passed=step(ar,uTime);
    float age=uTime-ar;
    float record=passed*(0.30+0.70*exp(-max(0.,age-600.)/5200.));
    c+=vec3(.40,.27,.13)*record*core;

    // Where the flow is actually running now, scaled by modelled depth.
    float live=clamp(depth/26.,0.,1.);
    c+=vec3(.72,.52,.26)*live*core*1.15;

    // The advancing nose: the brightest thing in the frame, so the eye tracks
    // the front across the corridor without being told where to look.
    float nose=exp(-pow((uTime-ar)/11.,2.));
    c+=vec3(1.05,.90,.66)*nose*(0.50+0.50*core);

    float a=clamp(max(max(ahead*.30,record*.52),max(live*.72,nose*.80))*(0.40+0.60*core),0.,1.);
    gl_FragColor=vec4(c,a);
   }`});
 ribbon=new THREE.Mesh(g,ribbonMat);
 ribbon.frustumCulled=false; ribbon.renderOrder=5; world.add(ribbon);

 // Peak inundation extent: the maximum modelled footprint, anywhere, at once.
 const ppos=[],puv=[],pidx=[];
 const PN=512, PM=26;
 for(let i=0;i<=PN;i++){
  const s=i/PN*LENGTH, half=ribbonHalf(s), pk=peak(s), b=bed(s);
  for(let j=0;j<=PM;j++){
   const side=j/PM*2-1;
   const d=Math.sign(side)*Math.pow(Math.abs(side),1.4)*half;
   const p=station(s,d,0);
   const gy=groundSD(s,d);
   // The extent surface sits at peak stage, clipped to where ground is below it.
   ppos.push(p.x,Math.max(gy+1.5,b+pk),p.z);
   puv.push(s/LENGTH,clamp((b+pk-gy)/Math.max(2,pk),0,1));
  }
 }
 for(let i=0;i<PN;i++)for(let j=0;j<PM;j++){
  const k=i*(PM+1)+j; pidx.push(k,k+PM+1,k+1,k+1,k+PM+1,k+PM+2);
 }
 const pg=new THREE.BufferGeometry();
 pg.setAttribute('position',new THREE.Float32BufferAttribute(ppos,3));
 pg.setAttribute('uv',new THREE.Float32BufferAttribute(puv,2));
 pg.setIndex(pidx); pg.computeBoundingSphere();
 peakMat=new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
  uniforms:{uTime:uniforms.time,vertical:uniforms.vertical},
  vertexShader:`varying vec2 vUv; uniform float vertical;
   void main(){vUv=uv;vec3 p=position;p.y*=vertical;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
  fragmentShader:`precision highp float; varying vec2 vUv; uniform float uTime;
   ${timelineGLSL}
   void main(){
    if(vUv.y<=0.004) discard;                       // only where ground is under peak stage
    float s=vUv.x*LEN;
    float band=smoothstep(0.,.10,vUv.y)*(1.-smoothstep(.55,1.,vUv.y));
    float edgeGlow=exp(-pow(vUv.y/.09,2.));
    vec3 c=vec3(.30,.46,.52)*.55+vec3(.42,.33,.20)*edgeGlow;
    gl_FragColor=vec4(c,(band*.10+edgeGlow*.22));
   }`});
 peakMesh=new THREE.Mesh(pg,peakMat);
 peakMesh.frustumCulled=false; peakMesh.renderOrder=1; world.add(peakMesh);
}

// ── Deposition: fresh sediment fans and ponded abandoned channels ────────────
const deposits=[];
function buildDeposits(){
 const mat0=new THREE.MeshStandardMaterial({color:0x6f6d63,roughness:.99,transparent:true,opacity:0});
 for(const s0 of [23000,39000,57000,71000,83000]){
  const w=valleyWidth(s0), side=s0<50000?-1:1;
  const pos=[],idx=[];
  for(let i=0;i<=24;i++)for(let j=0;j<=16;j++){
   const s=s0+(i/24*2-1)*Math.min(1400,w*4), lat=j/16;
   const d=side*(w*.6+lat*Math.min(w*3.2,900)*Math.sqrt(Math.max(0,1-Math.pow(i/24*2-1,2))));
   const p=station(s,d,0);
   pos.push(p.x,groundSD(s,d)+2.2*(1-lat),p.z);
  }
  for(let i=0;i<24;i++)for(let j=0;j<16;j++){
   const k=i*17+j; idx.push(k,k+17,k+1,k+1,k+17,k+18);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
  const m=mat0.clone();
  const mesh=new THREE.Mesh(g,m); mesh.renderOrder=1; world.add(mesh);
  // Standing water left in an abandoned channel beside the fan.
  const pp=station(s0,side*w*1.7,0);
  const pool=new THREE.Mesh(new THREE.CircleGeometry(Math.min(w*1.1,260),24),
   new THREE.MeshStandardMaterial({color:0x4d564f,roughness:.18,metalness:.04,transparent:true,opacity:0}));
  pool.rotation.x=-Math.PI/2;
  pool.position.set(pp.x,groundSD(s0,side*w*1.7)+1.2,pp.z);
  pool.renderOrder=2; world.add(pool);
  deposits.push({s:s0,mat:m,pool:pool.material,poolMesh:pool,mesh});
 }
}
function updateDeposits(t){
 for(const d of deposits){
  const a=arrival(d.s);
  d.mat.opacity=.88*smooth(a+500,a+2400,t);
  d.pool.opacity=.72*smooth(a+900,a+3600,t);
 }
}

export {
  PLACES, INFRA, buildings, trees, infraGroup, buildBuilt, updateBuilt,
  ribbon, peakMesh, buildOverlays, deposits, buildDeposits, updateDeposits
};
