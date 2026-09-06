// ═══════════════════════════════════════════════════════════════════════════
// WATER, DEBRIS AND SPRAY — the flow surface clipped wet/dry against the grid,
// instanced rafted material whose positions are a pure function of time, and
// one pooled soft-particle sprite system.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp, lerp, smooth, random } from './util.js';
import {
  CORR, LENGTH, station, stationInto, groundSD, bed, valleyWidth, ribbonHalf,
  arrival, peak, stageAt, frontAt, timelineGLSL
} from './corridor.js';
import { world, scene, camera, uniforms, glslNoise } from './scene.js';
import { flowA, iceMat, rockMat, dummy, EPS, hideInstance } from './flow.js';
import { S as STATE } from './state.js';

// ════════════════════════════════════════════════════════════════════════════
// SECTION 11 — WATER SURFACE
// A ribbon mesh laid on the real channel. Each vertex carries its own ground
// elevation, so the surface is clipped wet/dry against the grid and the flood
// edge follows the actual terrain. Depth drives colour and opacity: near-black
// where the flow is deepest and most charged, grey-brown through the body,
// pale tan where it thins over gravel. Never a uniform blue.
// ════════════════════════════════════════════════════════════════════════════
const WNS=1152, WNY=36;
let water=null, waterMat=null;
function buildWater(){
 const pos=[],uvs=[],grd=[],idx=[];
 for(let i=0;i<=WNS;i++){
  const s=i/WNS*LENGTH, half=ribbonHalf(s);
  for(let j=0;j<=WNY;j++){
   const side=j/WNY*2-1;
   // Cluster vertices toward the channel, where the surface detail lives.
   const d=Math.sign(side)*Math.pow(Math.abs(side),1.45)*half;
   const p=station(s,d,0);
   const g=groundSD(s,d);
   pos.push(p.x,g,p.z); uvs.push(i/WNS,j/WNY); grd.push(g);
  }
 }
 for(let i=0;i<WNS;i++)for(let j=0;j<WNY;j++){
  const k=i*(WNY+1)+j; idx.push(k,k+WNY+1,k+1,k+1,k+WNY+1,k+WNY+2);
 }
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
 g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
 g.setAttribute('groundY',new THREE.Float32BufferAttribute(grd,1));
 g.setIndex(idx);
 g.computeBoundingSphere();

 // A raw ShaderMaterial does not get the environment-map defines that three
 // normally injects, so derive them from the PMREM texture the same way the
 // renderer does. This is what lets the water take a real filtered reflection
 // of the sky model rather than a faked constant.
 const envH=scene.environment?.image?.height||256;
 const maxMip=Math.log2(envH)-2;
 const cubeUV={
  ENVMAP_TYPE_CUBE_UV:'',
  CUBEUV_TEXEL_WIDTH:(1/(3*Math.max(Math.pow(2,maxMip),112))).toPrecision(10),
  CUBEUV_TEXEL_HEIGHT:(1/envH).toPrecision(10),
  CUBEUV_MAX_MIP:maxMip.toFixed(1),
 };
 waterMat=new THREE.ShaderMaterial({
  defines:cubeUV,
  transparent:true, depthWrite:true, side:THREE.FrontSide,
  uniforms:{field:{value:flowA.texture},uTime:uniforms.time,vertical:uniforms.vertical,
   envMap:{value:scene.environment},fogColor:{value:new THREE.Color(0x0b1218)},
   fogDensity:{value:0.0000105}},
  vertexShader:`precision highp float;
   attribute float groundY;
   varying vec2 vUv; varying vec3 vWorld,vView; varying vec4 vFlow; varying float vGround;
   uniform sampler2D field; uniform float uTime,vertical;
   ${timelineGLSL}
   void main(){
    vUv=uv; vFlow=texture2D(field,uv); vGround=groundY;
    float s=uv.x*LEN, age=uTime-arrival(s);
    vec3 p=position;
    p.y=(groundY+vFlow.r)*vertical;
    // A steep leading bore with roll-up at the nose.
    float bore=exp(-pow((age-6.)/7.5,2.));
    p.y+=bore*min(vFlow.r,18.)*.28*(.55+.45*sin(uv.y*26.+uTime*2.1));
    // Surface displacement from the advected disturbance, scaled by depth.
    p.y+=vFlow.a*min(vFlow.r,25.)*.055*vertical;
    vWorld=(modelMatrix*vec4(p,1.)).xyz;
    vec4 mv=modelViewMatrix*vec4(p,1.);
    vView=mv.xyz; gl_Position=projectionMatrix*mv;
   }`,
  fragmentShader:`precision highp float;
   varying vec2 vUv; varying vec3 vWorld,vView; varying vec4 vFlow; varying float vGround;
   uniform float uTime; uniform sampler2D envMap; uniform vec3 fogColor; uniform float fogDensity;
   #include <common>
   #include <cube_uv_reflection_fragment>
   ${glslNoise}
   ${timelineGLSL}
   void main(){
    if(vFlow.r<0.10) discard;                       // wet/dry edge
    vec3 N=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
    if(N.y<0.) N=-N;
    float streak=n3(vec3(vWorld.x*.017,vWorld.z*.017-uTime*.22,uTime*.085));
    float chop=mix(.06,.32,smoothstep(2.,26.,vFlow.r));
    N=normalize(N+vec3(sin(vWorld.z*.085-uTime*2.),0.,cos(vWorld.x*.085+uTime))*chop
       +vec3(streak-.5)*.16);
    vec3 V=normalize(cameraPosition-vWorld);
    float fres=.032+.58*pow(1.-max(0.,dot(N,V)),5.);

    // Sediment ramp. Depth and concentration, never a fixed water colour.
    vec3 deep=vec3(.130,.106,.076), mud=vec3(.355,.292,.198), thin=vec3(.530,.462,.330);
    vec3 col=mix(thin,mud,smoothstep(.8,11.,vFlow.r));
    col=mix(col,deep,smoothstep(.34,.92,vFlow.g)*smoothstep(14.,52.,vFlow.r));
    col=mix(col,deep,clamp(vFlow.g*1.45,0.,1.)*smoothstep(5.,28.,vFlow.r));
    col*=.88+streak*.34;

    vec3 refl=textureCubeUV(envMap,reflect(-V,N),.30).rgb;
    col=mix(col,refl*1.02,fres*.45);

    // Churn: broken white water where the surface is fast and deep.
    float churn=smoothstep(.62,.86,streak)*smoothstep(7.,32.,vFlow.r)*smoothstep(4.,14.,vFlow.b);
    col=mix(col,vec3(.70,.68,.60),churn*.42);
    // A brighter, more aerated nose on the advancing bore.
    float age=uTime-arrival(vUv.x*LEN);
    // The advancing nose is the thing the eye should find first.
    float nose=exp(-pow((age-5.)/7.,2.));
    col=mix(col,vec3(.78,.72,.60),nose*.50);
    col+=vec3(.07,.055,.03)*nose;

    float depthFade=smoothstep(.10,1.1,vFlow.r);
    float d=length(vView);
    float fog=1.-exp(-fogDensity*d*d*0.00004-d*0.0000085);
    col=mix(col,fogColor,clamp(fog,0.,.42));
    gl_FragColor=vec4(col,clamp(.55+depthFade*.45,0.,1.));
    #include <colorspace_fragment>
   }`});
 water=new THREE.Mesh(g,waterMat);
 water.frustumCulled=false; water.renderOrder=2;
 world.add(water);
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 12 — DEBRIS
// Instanced rafted material: ice blocks, boulders, timber. Positions are a pure
// function of t, so scrubbing restores them. Density falls downstream, pieces
// jam at the modelled constrictions and deposit where the flow slows.
// ════════════════════════════════════════════════════════════════════════════
const JAMS=[21780,27400,37100,52000,68940];
const _dp=new THREE.Vector3();
let debrisMeshes=[], debrisData=[];
function buildDebris(){
 const timber=new THREE.CylinderGeometry(1,.75,7,5); timber.rotateZ(Math.PI/2);
 const specs=[
  {geo:new THREE.IcosahedronGeometry(1,0),mat:rockMat,n:200,scale:[5,17]},
  {geo:new THREE.BoxGeometry(1,.65,1),mat:iceMat,n:150,scale:[7,26]},
  {geo:timber,mat:new THREE.MeshStandardMaterial({color:0x4a3f31,roughness:.95}),n:110,scale:[2.2,5.5]},
 ];
 debrisMeshes=specs.map(sp=>{
  const m=new THREE.InstancedMesh(sp.geo,sp.mat,sp.n);
  m.frustumCulled=false; m.renderOrder=3; world.add(m); return m;
 });
 debrisData=specs.map((sp,k)=>Array.from({length:sp.n},()=>({
  offset:Math.pow(random(),1.6), side:random()*2-1, size:lerp(sp.scale[0],sp.scale[1],random()),
  spin:random()*2-1, phase:random()*6.283, jam:random(), sink:random(),
 })));
}
function updateDebris(t){
 const front=frontAt(t);
 debrisMeshes.forEach((mesh,k)=>{
  const arr=debrisData[k];
  for(let i=0;i<mesh.count;i++){
   const p=arr[i];
   // Each piece is entrained at its own chainage and then rides the front.
   const born=p.offset*LENGTH*.55;
   let s=front-p.offset*4200-born*.02;
   let stuck=false;
   // Jamming at constrictions: a fraction of pieces stop at the first jam site
   // they reach and stay there.
   for(const j of JAMS){
    if(p.jam<.30&&front>j&&s>j-600){ s=j-p.jam*1800; stuck=true; break; }
   }
   // Deposition once the local flow has passed and slowed.
   const depositAt=front-lerp(2500,16000,p.sink);
   if(!stuck&&s<depositAt){ s=depositAt; stuck=true; }
   if(s<0||s>LENGTH||front<=0){ hideInstance(); dummy.updateMatrix(); mesh.setMatrixAt(i,dummy.matrix); continue; }

   // Density falls downstream: pieces fade out rather than pop.
   const density=1-smooth(28000,86000,s)*(k===1?1:.6);
   const half=ribbonHalf(s), depth=stageAt(s,t);
   let side=p.side*(stuck?.85:.55+.35*Math.sin(t*.05+p.phase));
   const d=side*Math.min(half*.75,valleyWidth(s)*1.15+40);
   const gy=groundSD(s,d);
   const surf=Math.max(gy, bed(s)+depth);
   stationInto(_dp,s,d,stuck?gy+p.size*.35:surf-p.size*.30);
   dummy.position.copy(_dp);
   dummy.rotation.set(t*p.spin*(stuck?0:.32)+p.phase, t*p.spin*.22+p.phase, Math.sin(t*.2+p.phase)*(stuck?.1:.45));
   const vis=(depth>1.2||stuck)?1:0;
   dummy.scale.setScalar(Math.max(EPS,p.size*density*vis));
   dummy.updateMatrix();
   mesh.setMatrixAt(i,dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate=true;
 });
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 13 — SPRAY, MIST AND DUST
// One pooled instanced sprite system, camera-facing, soft-particle depth faded
// against the scene depth texture. Procedural noise, no texture file.
// ════════════════════════════════════════════════════════════════════════════
let sprites=null, spriteGeo=null, spriteMat=null, spriteData=[], spriteUniforms=null;
const MAX_SPRITES=900;
let depthTarget=null;
function buildSpray(){
 depthTarget=new THREE.WebGLRenderTarget(innerWidth,innerHeight,
  {minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true});
 depthTarget.depthTexture=new THREE.DepthTexture(innerWidth,innerHeight);
 depthTarget.depthTexture.type=THREE.UnsignedShortType;

 spriteUniforms={
  sceneDepth:{value:depthTarget.depthTexture},
  resolution:{value:new THREE.Vector2(innerWidth,innerHeight)},
  near:{value:camera.near}, far:{value:camera.far}, uTime:uniforms.time,
 };
 spriteMat=new THREE.ShaderMaterial({
  transparent:true, depthWrite:false, depthTest:true, blending:THREE.NormalBlending,
  uniforms:spriteUniforms,
  vertexShader:`precision highp float;
   attribute vec3 iPos; attribute float iSize,iKind,iOpacity;
   varying vec2 vUv; varying float vKind,vOpacity; varying vec4 vScreen;
   void main(){
    vUv=uv; vKind=iKind; vOpacity=iOpacity;
    vec4 mv=modelViewMatrix*vec4(iPos,1.);
    mv.xy+=position.xy*iSize;                       // camera-facing billboard
    vScreen=projectionMatrix*mv;
    gl_Position=vScreen;
   }`,
  fragmentShader:`precision highp float;
   varying vec2 vUv; varying float vKind,vOpacity; varying vec4 vScreen;
   uniform sampler2D sceneDepth; uniform vec2 resolution; uniform float near,far,uTime;
   ${glslNoise}
   float linear(float z){return near*far/(far-z*(far-near));}
   void main(){
    vec2 q=vUv*2.-1.;
    float n=n3(vec3(vUv*4.4,vKind*11.+uTime*.011));
    float radial=1.-smoothstep(.12,1.,length(q)+n*.22);
    if(radial<=0.001) discard;
    // Soft particle: fade where the sprite meets solid geometry.
    vec2 uvS=(vScreen.xy/vScreen.w*.5+.5);
    float sceneZ=linear(texture2D(sceneDepth,uvS).x);
    float fragZ=linear(gl_FragCoord.z);
    float soft=clamp((sceneZ-fragZ)/40.,0.,1.);
    // kind 0 = grey water spray, 1 = brown dust, 2 = cold ice powder
    vec3 spray=vec3(.60,.605,.575), dust=vec3(.40,.352,.285), powder=vec3(.74,.79,.82);
    vec3 c=vKind<.5?spray:(vKind<1.5?dust:powder);
    c*=.72+.42*n;
    gl_FragColor=vec4(c,radial*soft*vOpacity);
   }`});
 spriteGeo=new THREE.InstancedBufferGeometry();
 const plane=new THREE.PlaneGeometry(1,1);
 spriteGeo.index=plane.index;
 spriteGeo.attributes.position=plane.attributes.position;
 spriteGeo.attributes.uv=plane.attributes.uv;
 spriteGeo.setAttribute('iPos',new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPRITES*3),3));
 spriteGeo.setAttribute('iSize',new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPRITES),1));
 spriteGeo.setAttribute('iKind',new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPRITES),1));
 spriteGeo.setAttribute('iOpacity',new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPRITES),1));
 spriteGeo.boundingSphere=new THREE.Sphere(new THREE.Vector3(),200000);
 sprites=new THREE.Mesh(spriteGeo,spriteMat);
 sprites.frustumCulled=false; sprites.renderOrder=6;
 world.add(sprites);
 spriteData=Array.from({length:MAX_SPRITES},()=>({a:random(),b:random(),c:random(),phase:random()*6.283}));
}
function updateSpray(t){
 if(!sprites) return;
 const count=Math.min(MAX_SPRITES,STATE.spriteBudget);
 spriteGeo.instanceCount=count;
 const P=spriteGeo.attributes.iPos.array, S=spriteGeo.attributes.iSize.array;
 const K=spriteGeo.attributes.iKind.array, O=spriteGeo.attributes.iOpacity.array;
 const front=frontAt(t);
 for(let i=0;i<count;i++){
  const p=spriteData[i];
  let x=0,y=0,z=0,size=0,kind=0,op=0;
  if(i<count*.22&&t>-1&&t<150){
   // Powder cloud from the collapse, outrunning the debris.
   const age=clamp(t/26,0,1);
   const reach=lerp(0,5200,Math.pow(age,.7));
   const s=p.a*reach, spread=lerp(140,900,age);
   const lat=(p.b-.5)*spread;
   stationInto(_dp,600+s,lat,0);
   x=_dp.x; z=_dp.z;
   y=Math.max(groundSD(600+s,lat),bed(600+s))+lerp(20,720,p.c*age);
   size=lerp(160,700,p.c)*(.4+age);
   kind=p.b<.45?2:1;
   op=.30*(1-smooth(60,150,t))*(1-p.c*.5);
  } else if(front>0){
   // Spray at the front and mist over the body behind it.
   const behind=Math.pow(p.a,2.2)*lerp(700,14000,p.b);
   const s=clamp(front-behind,0,LENGTH);
   const depth=stageAt(s,t);
   if(depth>2.5){
    const half=Math.min(ribbonHalf(s),valleyWidth(s)*1.4+120);
    const d=(p.b*2-1)*half*.85;
    stationInto(_dp,s,d,0);
    x=_dp.x; z=_dp.z;
    const surf=Math.max(groundSD(s,d),bed(s)+depth);
    const nose=1-clamp(behind/900,0,1);
    y=surf+lerp(4,90,p.c)*(0.35+nose)+Math.sin(t*.7+p.phase)*6;
    size=lerp(45,260,p.c)*(.5+nose*1.2)*clamp(depth/26,.3,1.5);
    kind=nose>.5?0:(p.c<.22?1:0);
    op=clamp(depth/30,0,1)*(.10+nose*.34)*(1-smooth(LENGTH*.75,LENGTH,s)*.5);
   }
  }
  P[i*3]=x; P[i*3+1]=y; P[i*3+2]=z;
  S[i]=size; K[i]=kind; O[i]=op;
 }
 spriteGeo.attributes.iPos.needsUpdate=true;
 spriteGeo.attributes.iSize.needsUpdate=true;
 spriteGeo.attributes.iKind.needsUpdate=true;
 spriteGeo.attributes.iOpacity.needsUpdate=true;
}

export {
  water, waterMat, buildWater, buildDebris, updateDebris,
  sprites, spriteGeo, spriteUniforms, depthTarget, buildSpray, updateSpray, MAX_SPRITES
};
