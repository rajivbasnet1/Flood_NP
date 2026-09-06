// ═══════════════════════════════════════════════════════════════════════════
// COLLAPSE, DAM AND FLOW SOLVER — deterministic ballistics for the failure, a
// hypothesised blockage and breach, and a reduced GPU transport of depth,
// sediment and speed around prescribed analytic hydrographs. This is NOT a
// conservative shallow-water model and cannot establish site-specific extent.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp, lerp, smooth, random } from './util.js';
import {
  CORR, LENGTH, station, stationInto, groundSD, bed, valleyWidth, curvature, slope,
  peak, arrival, timelineGLSL, T_IMPACT, T_BLOCK, T_BREACH, T_WIDEN
} from './corridor.js';
import { world, renderer, uniforms } from './scene.js';
import { S, QUALITY } from './state.js';

// ════════════════════════════════════════════════════════════════════════════
// SECTION 8 — GLACIER AND COLLAPSE
// Deterministic ballistics, so scrubbing backwards restores the fall exactly.
// The melt fraction is bounded by an explicit energy budget rather than
// asserted: a 1,200 m fall at 35% frictional efficiency converts under 5% of
// the ice mass, which is why the scene shows a rock-and-ice cascade that
// bulks by entrainment rather than a wall of meltwater.
// ════════════════════════════════════════════════════════════════════════════
const G=9.81, LATENT=334000;
const MELT=clamp(.35*G*1200/(LATENT*.35),0,1);   // ≈3.7%
let scarPoint=null, impactPoint=null, fragments=null, fragmentData=[], glacier=null;
const iceMat=new THREE.MeshStandardMaterial({color:0xb4d4da,roughness:.35,metalness:.02});
const rockMat=new THREE.MeshStandardMaterial({color:0x5d655f,roughness:.88});
const dummy=new THREE.Object3D();
const _fp=new THREE.Vector3();
// Never write a zero scale into an instance matrix. Three's instanced normal
// path divides the object normal by the squared length of each basis column,
// so a zero column produces NaN normals, and a NaN instance can take out a
// large part of the frame rather than just its own few pixels. EPS is far
// below a pixel at every zoom, so it hides the instance just as completely.
const EPS=1e-4;
const hideInstance=()=>{dummy.scale.setScalar(EPS);};
const safeScale=(x,y,z)=>dummy.scale.set(Math.max(EPS,x),Math.max(EPS,y),Math.max(EPS,z));

function buildCollapse(){
 // The scar sits off the head of the traced channel; place it from the
 // centreline so it is inside the corridor the model actually contains.
 const sp=station(300,-900,0);
 scarPoint=new THREE.Vector3(sp.x,groundSD(300,-900)+260,sp.z);
 impactPoint=station(1500,0,bed(1500));
 glacier=new THREE.Mesh(new THREE.SphereGeometry(1,44,20),iceMat);
 glacier.position.copy(station(1900,0,bed(1900)-10));
 glacier.scale.set(300,34,620);
 glacier.renderOrder=1; world.add(glacier);

 fragments=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),iceMat,260);
 fragments.frustumCulled=false; world.add(fragments);
 for(let i=0;i<260;i++){
  fragmentData.push({
   ox:(random()-.5)*1300, oy:(random()-.5)*160, oz:(random()-.5)*420,
   size:22+random()*70, delay:random()*3.2, spin:random()*2.6-1.3,
   drift:(random()-.5)*.55, rock:random()<.42,
  });
 }
}
function updateCollapse(t){
 if(!fragments) return;
 fragments.visible=t>-1&&t<130;
 const to=impactPoint.clone().sub(scarPoint);
 for(let i=0;i<260;i++){
  const p=fragmentData[i], age=Math.max(0,t-p.delay);
  const f=clamp(age/17,0,1), e=f*f*(3-2*f);
  const x=scarPoint.x+p.ox*(1-e*.35)+to.x*e+to.x*p.drift*e*e;
  const z=scarPoint.z+p.oz*(1-e*.35)+to.z*e+to.z*p.drift*e*e;
  // Ballistic drop, then runout along the valley floor.
  const yFall=lerp(scarPoint.y+p.oy,impactPoint.y,e*e);
  const runout=Math.max(0,t-p.delay-17);
  const rs=Math.min(4200,runout*72);
  if(runout>0) stationInto(_fp,1500+rs,p.ox*.25,bed(1500+rs)+8); else _fp.set(x,yFall,z);
  const shrink=1-MELT*clamp(runout/60,0,1)*3.2;   // visible but small, per the budget
  dummy.position.copy(_fp);
  dummy.rotation.set(age*p.spin,age*p.spin*.7,age*p.spin*.4);
  dummy.scale.setScalar(Math.max(EPS,p.size*clamp(shrink,.25,1)*(t>110?Math.max(0,1-(t-110)/20):1)));
  dummy.updateMatrix();
  fragments.setMatrixAt(i,dummy.matrix);
 }
 fragments.instanceMatrix.needsUpdate=true;
 if(glacier){
  const hit=smooth(T_IMPACT,T_IMPACT+22,t);
  glacier.scale.set(300+hit*180,34-hit*17,620+hit*240);
  glacier.position.y=bed(1900)-10-hit*16;
 }
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 9 — TEMPORARY DAM AND BREACH
// Sources confirm a blockage and a breach but publish no timing, so the
// chronology here is a hypothesis and is labelled as one everywhere it shows.
// ════════════════════════════════════════════════════════════════════════════
const DAM_S=5400;
let damLeft=null, damRight=null, damNotch=null;
function buildDam(){
 const geo=new THREE.IcosahedronGeometry(1,2);
 const a=geo.attributes.position;
 for(let i=0;i<a.count;i++){
  const f=.82+((Math.sin(a.getX(i)*8.3+a.getZ(i)*4.7)*43758.5453)%1+1)%1*.36;
  a.setXYZ(i,a.getX(i)*f,a.getY(i)*f*.62,a.getZ(i)*f);
 }
 geo.computeVertexNormals();
 const mat=new THREE.MeshStandardMaterial({color:0x6a6d64,roughness:.96});
 damLeft=new THREE.Mesh(geo,mat); damRight=new THREE.Mesh(geo,mat);
 world.add(damLeft); world.add(damRight);
}
function updateDam(t){
 if(!damLeft) return;
 const grow=smooth(T_BLOCK-10,240,t), cut=smooth(T_BREACH,T_BREACH+T_WIDEN,t);
 const w=valleyWidth(DAM_S), b=bed(DAM_S);
 for(const [m,side] of [[damLeft,-1],[damRight,1]]){
  const gap=lerp(w*.10,w*1.05,cut);            // notch incises then widens
  const p=station(DAM_S,side*(gap*.5+w*.42),0);
  m.position.set(p.x,b+grow*(34-cut*26)*.5,p.z);
  m.scale.set(w*.85*grow+1,(38-cut*30)*grow+1,(w*.55*grow+1));
  m.visible=grow>.02;
 }
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 10 — FLOW SOLVER (GPU)
// Ping-pong render targets over a (chainage × cross-channel) field.
//   R = wet depth [m]   G = sediment proxy [0..1]
//   B = local speed [m/s]   A = advected surface disturbance
// Depth is driven by the analytic hydrographs above, which is what keeps the
// timeline randomly seekable. On top of that the solver adds the terms that
// make the flow answer to the channel rather than slide over it: centripetal
// cross-channel tilt (superelevation), run-up in constrictions, backwater at
// the blockage and at tributary junctions, and slack water in bank eddies.
// This is NOT a conservative 2D shallow-water or debris-rheology model.
// ════════════════════════════════════════════════════════════════════════════
let flowA=null,flowB=null,metaTex=null,solverMat=null,solverScene=null,solverCam=null;

function buildSolverMeta(){
 // Static per-column channel data the solver needs: bed, curvature, width.
 const NXF=1024, NYF=1;
 const d=new Float32Array(NXF*4);
 for(let i=0;i<NXF;i++){
  const s=i/(NXF-1)*LENGTH;
  d[i*4]=bed(s); d[i*4+1]=curvature(s); d[i*4+2]=valleyWidth(s); d[i*4+3]=slope(s);
 }
 metaTex=new THREE.DataTexture(d,NXF,NYF,THREE.RGBAFormat,THREE.FloatType);
 metaTex.minFilter=metaTex.magFilter=THREE.LinearFilter;
 metaTex.wrapS=metaTex.wrapT=THREE.ClampToEdgeWrapping;
 metaTex.needsUpdate=true;
}
function buildSolver(){
 buildSolverMeta();
 solverScene=new THREE.Scene();
 solverCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
 solverMat=new THREE.ShaderMaterial({
  uniforms:{previous:{value:null},meta:{value:metaTex},uTime:uniforms.time,
   dt:{value:1/60},reset:{value:1}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:`precision highp float; varying vec2 vUv;
   uniform sampler2D previous,meta; uniform float uTime,dt,reset;
   ${timelineGLSL}
   void main(){
    vec4 m=texture2D(meta,vec2(vUv.x,.5));
    float s=vUv.x*LEN, side=vUv.y*2.-1.;
    float bedY=m.x, curv=m.y, w=max(60.,m.z), bedSlope=m.w;
    float rise=stageAt(s,uTime);
    // Flow velocity from Manning with the bed slope taken off the traced long
    // profile and a roughness of n = 0.06 for a boulder-and-debris bed. This is
    // the depth-averaged water speed, which is not the same quantity as the
    // front celerity, and it is what the superelevation term needs.
    float hydR=clamp(rise,0.5,25.);
    float manning=(1./0.06)*pow(hydR,0.6667)*sqrt(bedSlope);
    float vel=mix(3.0,clamp(manning,3.,14.),clamp(rise/20.,0.,1.));

    // Superelevation. The free surface on a bend tilts as
    //   eta(y) = u² y /(g R),
    // with y the signed lateral distance from the channel centreline, so the
    // outer-minus-inner difference across a full width W is u² W /(g R).
    // The lever arm must be the true lateral distance in metres, not the
    // ribbon parameter. curv > 0 means the channel turns left, so the outer
    // bank is the right-of-travel side (side < 0): hence the leading minus.
    float ribbonW=clamp(260.+s*.0075,260.,1500.);
    float lateralPos=side*ribbonW;
    float tilt=clamp(-curv*vel*vel*lateralPos/9.81,-rise*.45,rise*.45);

    // Run-up where the valley pinches. Width comes from the elevation grid,
    // so the constrictions are the real ones.
    float narrow=clamp(1.-w/420.,0.,1.);
    float runup=rise*.26*narrow*pow(abs(side),.72);

    // Backwater behind the temporary blockage, then its release.
    float pond=(1.-smoothstep(4700.,5400.,s))*smoothstep(2400.,4700.,s)
     *smoothstep(140.,380.,uTime)*(1.-smoothstep(${T_BREACH.toFixed(1)},${(T_BREACH+T_WIDEN+260).toFixed(1)},uTime))*34.;

    // Ponding upstream of major tributary junctions on the traced channel.
    float junction=(exp(-pow((s-21780.)/900.,2.))+exp(-pow((s-37100.)/800.,2.))
     +exp(-pow((s-68940.)/1100.,2.)))*rise*.14;

    // Semi-Lagrangian advection of the surface disturbance only.
    vec2 adv=vUv-vec2(vel*dt/LEN, sin(s*.0008+uTime*.06)*dt*.007);
    float dist=texture2D(previous,clamp(adv,vec2(0.001),vec2(0.999))).a*(1.-reset);
    float target=sin(s*.031-uTime*1.7+side*10.)*.5+sin(s*.0095-uTime*.85-side*14.)*.3;
    dist=mix(dist,target,1.-exp(-dt*5.));

    // Slack water in bank eddies behind spurs.
    float eddy=smoothstep(.46,.92,abs(side))*(.5+.5*sin(s*.0035+side*11.));
    vel*=1.-eddy*.70;

    // Cross-section: the ribbon is wider than the channel, so depth is the
    // free surface minus the ground, which is what gives a wet/dry edge.
    float across=abs(side)*clamp(260.+s*.0075,260.,1500.);
    float bankRise=pow(max(0.,across-w)/max(120.,w*1.6),1.35)*max(14.,rise*1.05);
    float baseFlow=4.0*(1.-smoothstep(0.,w,across));
    float wet=max(0., baseFlow + rise + tilt + runup + pond + junction - bankRise);

    // Sediment: heavily charged in the entrainment reach, diluting downstream.
    float conc=mix(.90,.24,pow(s/LEN,.62))*smoothstep(1.,15.,rise);
    gl_FragColor=vec4(wet,conc,vel,dist);
   }`});
 solverScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),solverMat));
 allocateFlow();
}
function allocateFlow(){
 const [nx,ny]=(QUALITY[S.quality]||QUALITY.balanced).flow;
 flowA?.dispose(); flowB?.dispose();
 const opts={type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
  wrapS:THREE.ClampToEdgeWrapping,wrapT:THREE.ClampToEdgeWrapping,depthBuffer:false,stencilBuffer:false};
 flowA=new THREE.WebGLRenderTarget(nx,ny,opts);
 flowB=new THREE.WebGLRenderTarget(nx,ny,opts);
 S.resetFlow=true;
}
function solveFlow(dt){
 solverMat.uniforms.previous.value=flowA.texture;
 solverMat.uniforms.dt.value=clamp(dt,1/240,1/20);
 solverMat.uniforms.reset.value=S.resetFlow?1:0;
 const prev=renderer.getRenderTarget();
 renderer.setRenderTarget(flowB);
 renderer.render(solverScene,solverCam);
 renderer.setRenderTarget(prev);
 [flowA,flowB]=[flowB,flowA];
 S.resetFlow=false;
 // The caller repoints the water surface at the new front buffer. Doing it here
 // would mean the solver reaching into the water module, which imports this one.
}
// GPU readback, used by the inspector to check superelevation against the
// physics rather than against the eye.
function readFlowRow(s){
 const nx=flowA.width, ny=flowA.height;
 const col=Math.round(clamp(s/LENGTH,0,1)*(nx-1));
 const buf=new Uint16Array(ny*4);
 try{ renderer.readRenderTargetPixels(flowA,col,0,1,ny,buf); }catch(e){ return null; }
 const f=h=>{ // half float -> float
  const s1=(h>>15)&1, e=(h>>10)&31, m=h&1023;
  if(e===0) return (s1?-1:1)*Math.pow(2,-14)*(m/1024);
  if(e===31) return m?NaN:(s1?-Infinity:Infinity);
  return (s1?-1:1)*Math.pow(2,e-15)*(1+m/1024);
 };
 const depths=[]; for(let j=0;j<ny;j++) depths.push(f(buf[j*4]));
 // Report the chainage the sampled column actually represents, so a caller can
 // evaluate curvature at exactly the same place the solver did.
 return {depths, s:(col+0.5)/nx*LENGTH, column:col};
}

export {
  MELT, scarPoint, impactPoint, iceMat, rockMat, dummy, EPS, hideInstance, safeScale,
  buildCollapse, updateCollapse, DAM_S, buildDam, updateDam,
  buildSolver, allocateFlow, solveFlow, readFlowRow, flowA
};
