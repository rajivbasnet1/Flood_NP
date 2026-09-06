// ═══════════════════════════════════════════════════════════════════════════
// TERRAIN — the corridor block. A world-space mesh whose heights come from the
// corridor grid, clipped to the band in the fragment shader, and closed with a
// cut face that follows the same boundary plus a base slab.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp, DEG } from './util.js';
import { CORR, LENGTH, CN, cx, cz, HEIGHT, groundSD, station, toCorridor, timelineGLSL } from './corridor.js';
import { stage, scene, world, camera, uniforms, BASE_Y, glslNoise } from './scene.js';

let lodBudget = 3.4, triBudget = 240000;
const setLodBudget = v => { lodBudget = v; };
const setTriBudget = v => { triBudget = v; };

// ════════════════════════════════════════════════════════════════════════════
// SECTION 6 — TERRAIN
// The model is a corridor, not a rectangle: only ground within 4.2 km of the
// channel exists at all. The mesh is built in WORLD space — a corridor-space
// mesh folds through itself on any bend tighter than its own half-width, and
// this valley has bends of 550 m — but every vertex carries its own (chainage,
// lateral) so heights come straight from the corridor grid, with no lookup
// texture in between and no blurring of the gorge floor.
//
// Vertices beyond the corridor drop to the base plane, so the cut face is part
// of the same mesh and always meets the top surface exactly.
// ════════════════════════════════════════════════════════════════════════════
const CELL=78;                     // world grid spacing, metres
const CHUNK=48;                    // cells per chunk edge
const LEVELS=[4,2,1];              // vertex stride: coarse first
const terrainChunks=[];
let terrainMaterial=null;

function heightTexture(){
 // Corridor grid as a texture: x = lateral, y = chainage.
 const t=new THREE.DataTexture(HEIGHT,CORR.nd,CORR.ns,THREE.RedFormat,THREE.FloatType);
 t.minFilter=t.magFilter=THREE.LinearFilter;
 t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;
 t.needsUpdate=true; return t;
}

function buildTerrainMaterial(){
 const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.9,metalness:.02});
 // Three keys compiled programs on material parameters, not on the body of
 // onBeforeCompile. Without a distinct key another MeshStandardMaterial with
 // matching parameters can be handed this program — which displaces its
 // vertices by the elevation grid. Every patched material needs its own key.
 m.customProgramCacheKey=()=>'corridor-terrain-v2';
 m.onBeforeCompile=sh=>{
  Object.assign(sh.uniforms,{
   heightMap:uniforms.heightMap, uTime:uniforms.time, vertical:uniforms.vertical,
   corrSize:uniforms.corrSize, texel:uniforms.texel, spacing:uniforms.spacing,
   uContours:uniforms.contours,
  });
  sh.vertexShader=`
   attribute vec2 sd;                 // chainage, lateral offset (metres)
   attribute float edgeFlag;          // 1 = beyond the corridor: drops to base
   uniform sampler2D heightMap; uniform vec2 corrSize; uniform float vertical;
   varying vec3 vWorld; varying vec2 vSD; varying float vEdge;
  `+sh.vertexShader.replace('#include <begin_vertex>',`
   vec3 transformed=position;
   vSD=sd; vEdge=edgeFlag;
   vec2 tuv=vec2(clamp(sd.y/corrSize.y*.5+.5,.001,.999), clamp(sd.x/corrSize.x,.001,.999));
   float h=texture2D(heightMap,tuv).r;
   transformed.y=mix(h*vertical, ${BASE_Y}.0, edgeFlag);
   vWorld=vec3(position.x,h,position.z);
  `);
  sh.fragmentShader=`
   uniform sampler2D heightMap; uniform float uTime,vertical,uContours;
   uniform vec2 corrSize,texel,spacing;
   varying vec3 vWorld; varying vec2 vSD; varying float vEdge;
   ${glslNoise}
   ${timelineGLSL}
  `+sh.fragmentShader
   // Normals come from the corridor grid at a fixed step, not from the
   // tessellation, so shading is identical at every level of detail. This must
   // happen before <color_fragment>, which uses it.
   .replace('#include <map_fragment>',`#include <map_fragment>
   if(vEdge<.5 && (abs(vSD.y)>corrSize.y || vSD.x<0.0 || vSD.x>corrSize.x)) discard;
   vec2 tuv=vec2(clamp(vSD.y/corrSize.y*.5+.5,.002,.998), clamp(vSD.x/corrSize.x,.002,.998));
   float hL=texture2D(heightMap,tuv-vec2(texel.x,0.)).r, hR=texture2D(heightMap,tuv+vec2(texel.x,0.)).r;
   float hD=texture2D(heightMap,tuv-vec2(0.,texel.y)).r, hU=texture2D(heightMap,tuv+vec2(0.,texel.y)).r;
   vec3 gridN=normalize(vec3((hL-hR)*vertical, 2.*spacing.x, (hD-hU)*vertical*spacing.x/spacing.y));
   `)
   .replace('#include <normal_fragment_begin>',`
   float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
   vec3 normal = gridN;
   vec3 nonPerturbedNormal = normal;
   `)
   .replace('#include <normal_fragment_maps>',`
   // Sub-grid rock relief. A normal perturbation only, never displacement, so
   // no silhouette changes between levels of detail.
   float slopeN=clamp(1.-gridN.y,0.,1.);
   vec3 dpA=vWorld*.0135, dpB=vWorld*.085;
   float bnA=fbm3(dpA), bnB=fbm3(dpB);
   vec3 gA=vec3(fbm3(dpA+vec3(.16,0,0)),fbm3(dpA+vec3(0,.16,0)),fbm3(dpA+vec3(0,0,.16)))-bnA;
   vec3 gB=vec3(fbm3(dpB+vec3(.18,0,0)),fbm3(dpB+vec3(0,.18,0)),fbm3(dpB+vec3(0,0,.18)))-bnB;
   normal=normalize(gridN-(gA*3.1+gB*1.25)*(0.35+2.9*slopeN));
   `)
   .replace('#include <color_fragment>',`#include <color_fragment>
   float s=vSD.x, chDist=abs(vSD.y);
   // Bed elevation at this chainage, read off the channel line of the grid.
   float bedElev=texture2D(heightMap,vec2(0.5,clamp(s/corrSize.x,.002,.998))).r;
   float slope=clamp(1.-gridN.y,0.,1.);
   float elev=vWorld.y;

   vec3 tp=vWorld*.024;
   float rock=fbm3(tp);
   float strata=sin(vWorld.y*.021+fbm3(vWorld*.0026)*9.)*0.45;
   float fine=n3(vWorld*.13)*.6+n3(vWorld*.041)*.4;
   float aspect=clamp(dot(normalize(vec3(gridN.x,0.,gridN.z)+1e-5),vec3(.62,0.,-.78))*.5+.5,0.,1.);

   vec3 granite=mix(vec3(.072,.082,.090),vec3(.190,.202,.210),rock)*(.86+.07*strata+.20*fine);
   vec3 gneiss=mix(vec3(.096,.092,.086),vec3(.208,.202,.190),fine)*(.88+.08*strata);
   vec3 bedrock=mix(granite,gneiss,smoothstep(2200.,4200.,elev));
   vec3 scree=mix(vec3(.118,.117,.109),bedrock,.50);
   vec3 moraine=mix(vec3(.086,.083,.076),vec3(.150,.146,.135),rock);
   vec3 firn=mix(vec3(.40,.55,.62),vec3(.80,.85,.86),rock*.7+.3);
   vec3 alpine=mix(vec3(.082,.104,.066),vec3(.140,.152,.098),n3(vWorld*.011))*(.80+.4*fine);
   vec3 forest=mix(vec3(.030,.062,.038),vec3(.082,.128,.062),n3(vWorld*.0075))*(.70+.5*fine);
   vec3 terrace=mix(vec3(.115,.140,.086),vec3(.180,.192,.124),n3(vWorld*.02))*(.85+.3*fine);
   vec3 gravel=mix(vec3(.088,.087,.080),vec3(.165,.162,.148),rock)*(.82+.30*fine);

   // Elevation, slope and aspect drive everything. No photograph anywhere.
   vec3 color=forest;
   color=mix(color,terrace,smoothstep(.55,.16,slope)*(1.-smoothstep(1400.,2000.,elev)));
   color=mix(color,alpine,smoothstep(2900.,3500.,elev));
   color=mix(color,bedrock,smoothstep(.34,.70,slope));
   color=mix(color,moraine,smoothstep(3700.,4300.,elev)*(1.-smoothstep(.58,.84,slope)));
   color=mix(color,scree,smoothstep(4200.,4800.,elev)*(1.-smoothstep(.55,.80,slope)));
   color=mix(color,firn,smoothstep(4900.,5450.,elev)*(1.-smoothstep(.66,.86,slope))*(.45+.55*aspect));
   float barWidth=max(120.,60.+s*.0035);
   color=mix(color,gravel,(1.-smoothstep(.9,2.3,chDist/barWidth))*(1.-smoothstep(.16,.38,slope)));

   float wet=smoothstep(.35,.75,slope)*(1.-smoothstep(4600.,5100.,elev));
   color*=mix(1.,.80,wet);

   // ── the flood's record on the ground ──
   float ar=arrival(s), pk=peakStage(s);
   float inChannel=1.-smoothstep(.0,1.0,chDist/max(150.,260.+s*.0075));
   float reached=step(elev,bedElev+pk)*inChannel;
   float passed=smoothstep(ar+90.,ar+620.,uTime)*reached;
   color=mix(color,vec3(.168,.158,.136)*(.80+rock*.34),passed*.90);
   float toTrim=(bedElev+pk)-elev;
   color=mix(color,vec3(.295,.276,.232),exp(-pow(toTrim/6.,2.))*passed*.66);

   // Toward the cut edge the block desaturates to a neutral base tone, so the
   // eye stays on the route and the boundary reads as the edge of a model.
   float away=smoothstep(2500.,4200.,chDist);
   vec3 neutral=vec3(dot(color,vec3(.299,.587,.114)));
   color=mix(color,mix(neutral,vec3(.185,.196,.204),.55),away*.72);

   float band=abs(fract(elev/100.)-.5)*2.;
   float cw=fwidth(elev/100.)*2.2+.02;
   color=mix(color,color*1.9+vec3(.02,.05,.05),uContours*(1.-smoothstep(0.,cw,1.-band))*.35);

   // The cut face: banded strata, like a sawn geological block.
   if(vEdge>.5){
    float yb=n3(vec3(elev*.0045,0.,0.))*.65+n3(vec3(elev*.016,1.,0.))*.35;
    color=mix(vec3(.058,.062,.068),vec3(.125,.127,.128),smoothstep(0.,4000.,elev))*(.86+.20*yb);
   }
   diffuseColor.rgb*=color;
   `)
   .replace('#include <roughnessmap_fragment>',`
   float roughnessFactor=roughness;
   roughnessFactor*=mix(1.,.62,smoothstep(.35,.75,clamp(1.-gridN.y,0.,1.)));
   roughnessFactor=clamp(roughnessFactor,.28,1.);
   `);
 };
 return m;
}

// One chunk of the world grid, keeping only cells whose corridor distance is
// inside the band plus one ring — that ring becomes the cut face.
function buildChunk(originX,originZ,stride){
 const n=CHUNK/stride, step=CELL*stride, cols=n+1;
 const pos=[],sd=[],edge=[],idx=[],outside_=[];
 const tmp={s:0,d:0,sRaw:0};
 let any=false;
 for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){
  const x=originX+i*step, z=originZ+j*step;
  toCorridor(x,z,tmp);
  const outside=Math.abs(tmp.d)>CORR.half||tmp.sRaw<0||tmp.sRaw>LENGTH;
  // Vertices keep their grid position and carry their true lateral offset.
  // The boundary is cut in the fragment shader instead, which makes the edge
  // pixel-accurate rather than quantised to the cell size — a snapped or
  // stepped edge reads as a comb against the smooth rim.
  pos.push(x,0,z); sd.push(tmp.sRaw,tmp.d);
  if(!outside) any=true;
  edge.push(0); outside_.push(outside?1:0);
 }
 if(!any) return null;
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){
  const k=j*cols+i;
  // A quad whose four corners are all beyond the corridor is ground that does
  // not exist in this model.
  if(outside_[k]+outside_[k+1]+outside_[k+cols]+outside_[k+cols+1]===4) continue;
  idx.push(k,k+cols,k+1,k+1,k+cols,k+cols+1);
 }
 if(!idx.length) return null;
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
 g.setAttribute('sd',new THREE.Float32BufferAttribute(sd,2));
 g.setAttribute('edgeFlag',new THREE.Float32BufferAttribute(edge,1));
 g.setIndex(idx);
 return g;
}

function buildTerrain(){
 uniforms.heightMap.value=heightTexture();
 terrainMaterial=buildTerrainMaterial();
 let mnx=Infinity,mxx=-Infinity,mnz=Infinity,mxz=-Infinity;
 for(let i=0;i<CN;i++){mnx=Math.min(mnx,cx[i]);mxx=Math.max(mxx,cx[i]);mnz=Math.min(mnz,cz[i]);mxz=Math.max(mxz,cz[i]);}
 const span=CELL*CHUNK, pad=CORR.half+span;
 const x0=Math.floor((mnx-pad)/span)*span, z0=Math.floor((mnz-pad)/span)*span;
 const nx=Math.ceil((mxx+pad-x0)/span), nz=Math.ceil((mxz+pad-z0)/span);
 const tmp={s:0,d:0,sRaw:0};
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
  const ox=x0+i*span, oz=z0+j*span;
  let touches=false;
  for(let b=0;b<=4&&!touches;b++)for(let a=0;a<=4;a++){
   toCorridor(ox+a/4*span,oz+b/4*span,tmp);
   if(Math.abs(tmp.d)<=CORR.half+CELL*2&&tmp.sRaw>=-CELL*2&&tmp.sRaw<=LENGTH+CELL*2){touches=true;break;}
  }
  if(!touches) continue;
  const meshes=[];
  for(const stride of LEVELS){
   const g=buildChunk(ox,oz,stride);
   if(!g){ meshes.length=0; break; }
   const mesh=new THREE.Mesh(g,terrainMaterial);
   mesh.frustumCulled=false; mesh.visible=false;
   world.add(mesh); meshes.push(mesh);
  }
  if(!meshes.length) continue;
  let lo=Infinity,hi=-Infinity;
  for(let b=0;b<=4;b++)for(let a=0;a<=4;a++){
   toCorridor(ox+a/4*span,oz+b/4*span,tmp);
   const h=groundSD(tmp.s,clamp(tmp.d,-CORR.half,CORR.half));
   if(h<lo)lo=h; if(h>hi)hi=h;
  }
  terrainChunks.push({meshes,level:0,
   centre:new THREE.Vector3(ox+span/2,(lo+hi)/2,oz+span/2),
   radius:Math.hypot(span,span,hi-lo)/2});
 }
}

// Level by screen-space error, then frustum culling, then a hard triangle
// budget — which is what keeps a low-angle view, where many chunks are close,
// inside the frame budget.
const _frustum=new THREE.Frustum(), _pm=new THREE.Matrix4(), _sphere=new THREE.Sphere();
function updateTerrainLOD(){
 const ppm=(stage.clientHeight*.5)/Math.tan(DEG(camera.fov)/2);
 // The camera moved this frame; three only refreshes these during render, and
 // a stale frustum culls chunks that are on screen and punches holes.
 camera.updateMatrixWorld(true);
 camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
 _pm.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
 _frustum.setFromProjectionMatrix(_pm);
 const vy=uniforms.vertical.value;
 const visible=[];
 for(const c of terrainChunks){
  _sphere.center.set(c.centre.x,c.centre.y*vy,c.centre.z);
  _sphere.radius=c.radius*Math.max(1,vy);
  if(!_frustum.intersectsSphere(_sphere)){ for(const m of c.meshes) m.visible=false; continue; }
  const d=Math.max(300,camera.position.distanceTo(_sphere.center)-_sphere.radius);
  let want=c.meshes.length-1;
  for(let l=0;l<c.meshes.length;l++){
   if(CELL*LEVELS[l]*ppm/d<=lodBudget){ want=l; break; }
  }
  c.want=want; c.dist=d; visible.push(c);
 }
 const tris=c=>c.meshes[c.want].geometry.index.count/3;
 let total=visible.reduce((a,c)=>a+tris(c),0);
 if(total>triBudget){
  const order=[...visible].sort((a,b)=>b.dist-a.dist);
  let pass=0;
  while(total>triBudget&&pass<LEVELS.length){
   for(const c of order){
    if(total<=triBudget) break;
    if(c.want<c.meshes.length-1){ const before=tris(c); c.want++; total-=before-tris(c); }
   }
   pass++;
  }
 }
 for(const c of visible){
  c.level=c.want;
  for(let l=0;l<c.meshes.length;l++) c.meshes[l].visible=(l===c.level);
 }
}

// The cut face. Because every terrain vertex beyond the corridor was snapped
// onto the boundary, this rim meets the top surface exactly along a smooth
// curve — which is what makes the block read as sliced rather than eroded.
// The terrain is clipped on NEAREST distance to the channel, which is always
// single-valued. Offsetting the centreline by a fixed 4.2 km is not: on the
// inside of a bend tighter than that, the offset curve folds through itself and
// the rim renders as a comb of overlapping walls. So find, for each station,
// the largest offset that is genuinely that far from the channel — which is
// exactly the boundary the terrain is cut on.
const _rimProbe={s:0,d:0,sRaw:0};
function boundaryOffset(s,side){
 let lo=0, hi=CORR.half;
 const ok=t=>{
  if(t<=1) return true;
  const p=station(s,side*t,0);
  toCorridor(p.x,p.z,_rimProbe);
  return Math.abs(_rimProbe.d)>=t-Math.max(12,t*0.04)
      && _rimProbe.sRaw>=-50 && _rimProbe.sRaw<=LENGTH+50;
 };
 if(ok(hi)) return hi;
 for(let i=0;i<9;i++){ const mid=(lo+hi)/2; if(ok(mid)) lo=mid; else hi=mid; }
 return lo;
}
function buildRim(){
 const NSg=512;
 const pos=[],sd=[],edge=[],idx=[];
 // Precompute and smooth, so the cut edge is a clean curve rather than a
 // sequence of independent binary-search answers.
 const off=[[],[]];
 [1,-1].forEach((side,k)=>{
  for(let i=0;i<=NSg;i++) off[k][i]=boundaryOffset(i/NSg*LENGTH,side);
  for(let p=0;p<4;p++){
   const c=off[k].slice();
   for(let i=1;i<NSg;i++) off[k][i]=(c[i-1]+c[i]*2+c[i+1])/4;
  }
 });
 let v=0;
 [1,-1].forEach((side,k)=>{
  const start=v;
  for(let i=0;i<=NSg;i++){
   const s=i/NSg*LENGTH, d=side*off[k][i];
   const p=station(s,d,0);
   pos.push(p.x,0,p.z); sd.push(s,d); edge.push(0);   // top: follows terrain
   pos.push(p.x,0,p.z); sd.push(s,d); edge.push(1);   // bottom: drops to base
   v+=2;
  }
  for(let i=0;i<NSg;i++){
   const b=start+i*2;
   if(side>0) idx.push(b,b+1,b+2, b+2,b+1,b+3);
   else       idx.push(b,b+2,b+1, b+1,b+2,b+3);
  }
 });
 // Cap both ends of the corridor so the block is closed.
 for(const s of [0,LENGTH]){
  const start=v;
  const endI=s===0?0:NSg;
  for(let j=0;j<=16;j++){
   const f=j/16*2-1;
   const d=f*(f>=0?off[0][endI]:off[1][endI]);
   const p=station(s,d,0);
   pos.push(p.x,0,p.z); sd.push(s,d); edge.push(0);
   pos.push(p.x,0,p.z); sd.push(s,d); edge.push(1);
   v+=2;
  }
  for(let j=0;j<16;j++){
   const k=start+j*2;
   if(s===0) idx.push(k,k+2,k+1, k+1,k+2,k+3);
   else      idx.push(k,k+1,k+2, k+2,k+1,k+3);
  }
 }
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
 g.setAttribute('sd',new THREE.Float32BufferAttribute(sd,2));
 g.setAttribute('edgeFlag',new THREE.Float32BufferAttribute(edge,1));
 g.setIndex(idx); g.computeBoundingSphere();
 const mesh=new THREE.Mesh(g,terrainMaterial);
 mesh.frustumCulled=false;
 return mesh;
}

// The base: a slab under the corridor, so the block reads as a cut object with
// thickness rather than a floating shell.
let plateGroup=null;
function buildBasePlate(){
 plateGroup=new THREE.Group();
 plateGroup.add(buildRim());
 const pos=[],idx=[];
 const NSg=256, NDg=2;
 for(let i=0;i<=NSg;i++){
  const s=i/NSg*LENGTH;
  for(let j=0;j<=NDg;j++){
   const p=station(s,(j/NDg*2-1)*CORR.half,BASE_Y);
   pos.push(p.x,BASE_Y,p.z);
  }
 }
 for(let i=0;i<NSg;i++)for(let j=0;j<NDg;j++){
  const k=i*(NDg+1)+j; idx.push(k,k+1,k+NDg+1,k+NDg+1,k+1,k+NDg+2);
 }
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
 g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
 const mat=new THREE.MeshStandardMaterial({color:0x11161b,roughness:1,side:THREE.DoubleSide});
 mat.customProgramCacheKey=()=>'baseplate-v2';
 plateGroup.add(new THREE.Mesh(g,mat));
 world.add(plateGroup);
}

export {
  CELL, CHUNK, LEVELS, terrainChunks, terrainMaterial, heightTexture,
  buildTerrain, updateTerrainLOD, buildBasePlate, plateGroup, buildRim, boundaryOffset,
  setLodBudget, setTriBudget
};
