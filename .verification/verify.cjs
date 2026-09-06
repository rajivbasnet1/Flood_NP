// Verification harness. Run from the project root:  node .verification/verify.cjs
const fs=require('fs'), path=require('path');
const {spawn}=require('child_process');
const {chromium}=require('C:/Users/rajiv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const ROOT=path.resolve(__dirname,'..'), OUT=__dirname;
// Every module is syntax-checked, then the Vite dev server serves and drives it.
for(const f of fs.readdirSync(path.join(ROOT,'src')).filter(f=>f.endsWith('.js')))
 require('child_process').execFileSync(process.execPath,['--check',path.join(ROOT,'src',f)]);
console.log('all modules parse');
const viteBin=path.join(ROOT,'node_modules','.bin',process.platform==='win32'?'vite.cmd':'vite');
const server=spawn(viteBin,['--port','8123','--strictPort'],{cwd:ROOT,stdio:'ignore',shell:true});
process.on('exit',()=>server.kill());

(async()=>{
 const browser=await chromium.launch({
  executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
  headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
 const errors=[],network=[];
 page.on('pageerror',e=>{errors.push('pageerror: '+e.message);console.log('PAGE ERROR',e.message);});
 page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('CONSOLE ERROR',m.text().slice(0,300));}});
 page.on('request',r=>network.push(r.url()));

 const t0=Date.now();
 await new Promise(r=>setTimeout(r,1500));
 await page.goto('http://localhost:8123/');
 await page.waitForFunction(()=>window.__reconstruction?.ready,{timeout:90000});
 const loadMs=Date.now()-t0;

 // The page must read before/without the 3D model.
 const pageParts=await page.evaluate(()=>({
  tollCards:document.querySelectorAll('#tollgrid .toll').length,
  mapNodes:document.getElementById('flatmap').childElementCount,
  supportLink:document.querySelector('.urlchip')?.getAttribute('href')||'',
  heroCanvas:!!document.getElementById('heroCanvas'),
  sourceRows:document.querySelectorAll('#sourceTable tbody tr').length,
  modelRows:document.querySelectorAll('#modelTable tbody tr').length,
  badges:document.querySelectorAll('.tag-nf').length,
  sections:[...document.querySelectorAll('section')].map(s=>s.id),
 }));

 await page.evaluate(()=>document.getElementById('model').scrollIntoView());
 await page.waitForTimeout(1200);
 await page.evaluate(()=>window.__reconstruction.setPlaying(false));

 const numeric=await page.evaluate(()=>{
  const m=window.__reconstruction;
  return [0,3000,21780,37100,60000,81800,93080].map(s=>({
   s,bed:Math.round(m.bed(s)),width:Math.round(m.valleyWidth(s)),
   peak:+m.peak(s).toFixed(1),celerity:+m.celerity(s).toFixed(2),
   arrival:+m.arrival(s).toFixed(1),inverse:+m.frontAt(m.arrival(s)).toFixed(1)}));
 });

 const beatCheck=await page.evaluate(async()=>{
  const m=window.__reconstruction, out=[];
  for(const b of m.beats()){
   m.seek(b.t); await new Promise(r=>requestAnimationFrame(r));
   const a=m.snapshot();
   m.seek(-30); await new Promise(r=>requestAnimationFrame(r));
   m.seek(b.t); await new Promise(r=>requestAnimationFrame(r));
   const c=m.snapshot();
   out.push({label:b.label,frontMatch:Math.abs(a.front-c.front)<1e-6,stageMatch:Math.abs(a.stage-c.stage)<1e-6});
  }
  return out;
 });

 // Superelevation at the sharpest bends, with the outer bank determined from
 // centreline geometry alone — no sign convention involved.
 const sections=await page.evaluate(async()=>{
  const m=window.__reconstruction, out=[];
  for(const bend of m.tightestBends(4)){
   m.seek(m.arrival(bend.s)+90);
   await new Promise(r=>requestAnimationFrame(r));
   await new Promise(r=>requestAnimationFrame(r));
   const probe=m.readFlowRow(bend.s);
   if(!probe){out.push({s:bend.s,error:'readback unavailable'});continue;}
   const row=probe.depths, n=row.length;
   const lo0=Math.floor((n-1)/2), hi0=lo0+1;
   let kMax=0;
   for(let o=0;lo0-o>=0&&hi0+o<n;o++){ if(row[lo0-o]>0.2&&row[hi0+o]>0.2) kMax=o; else break; }
   const k=Math.max(0,Math.round(kMax*0.8));
   const neg=row[lo0-k], pos=row[hi0+k], s=probe.s;
   const a=m.station(s-700,0,0), b=m.station(s,0,0), c=m.station(s+700,0,0);
   const toCx=(a.x+c.x)/2-b.x, toCz=(a.z+c.z)/2-b.z;
   const lat=m.station(s,1,0);
   const posIsOuter=((lat.x-b.x)*toCx+(lat.z-b.z)*toCz)<0;
   out.push({s:Math.round(s),bendRadius:bend.radius,
    outerMinusInner:+((posIsOuter?pos:neg)-(posIsOuter?neg:pos)).toFixed(2),
    maxDepth:+Math.max(...row).toFixed(2)});
  }
  return out;
 });

 // Orbit through every angle and the full zoom range.
 const orbit=[];
 for(const [name,az,el,dist] of [
  ['nadir',200,89,60000],['low-north',0,3,4000],['low-south',180,2.5,3000],
  ['low-east',90,5,6000],['low-west',270,5,6000],['framed',214,46,52000],
  ['max-out',214,50,150000],['cross-section',210,4,320]]){
  await page.evaluate(([az,el,dist])=>{
   const m=window.__reconstruction; m.seek(1400);
   m.setCamera(az*Math.PI/180,el*Math.PI/180,dist,null);
  },[az,el,dist]);
  await page.waitForTimeout(420);
  const s=await page.evaluate(()=>window.__reconstruction.snapshot());
  orbit.push({name,triangles:s.triangles,calls:s.calls});
  await page.screenshot({path:path.join(OUT,'qa-orbit-'+name+'.png')});
 }

 await page.evaluate(()=>window.__reconstruction.frameRoute());
 await page.waitForTimeout(500);
 const states=[];
 for(const t of [-30,10,200,480,900,2200,6000,11000]){
  await page.evaluate(t=>window.__reconstruction.seek(t),t);
  await page.waitForTimeout(380);
  states.push(await page.evaluate(()=>window.__reconstruction.snapshot()));
  await page.screenshot({path:path.join(OUT,'qa-t'+String(t).replace('-','minus')+'.png')});
 }
 for(let i=0;i<5;i++){
  await page.evaluate(i=>{window.__reconstruction.seek(i<3?600:2400);window.__reconstruction.gotoPreset(i);},i);
  await page.waitForTimeout(700);
  await page.screenshot({path:path.join(OUT,'qa-preset-'+(i+1)+'.png')});
 }
 // Backwards sweep.
 for(let t=14400;t>=-30;t-=180){
  await page.evaluate(t=>window.__reconstruction.seek(t),t);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));
 }

 // Active playback, and the off-screen idle that keeps scrolling smooth.
 await page.evaluate(()=>{window.__reconstruction.seek(900);window.__reconstruction.setPlaying(true);});
 await page.waitForTimeout(4000);
 const active=await page.evaluate(()=>window.__reconstruction.snapshot());
 await page.evaluate(()=>document.getElementById('hero').scrollIntoView());
 await page.waitForTimeout(1500);
 const offScreen=await page.evaluate(()=>window.__reconstruction.snapshot());
 await page.evaluate(()=>document.getElementById('model').scrollIntoView());
 await page.waitForTimeout(1200);
 await page.evaluate(()=>window.__reconstruction.setPlaying(false));

 // Quality tiers.
 const tiers={};
 for(const q of ['low','balanced','high']){
  await page.selectOption('#quality',q);
  await page.waitForTimeout(1600);
  tiers[q]=await page.evaluate(()=>window.__reconstruction.snapshot());
 }
 await page.selectOption('#quality','balanced');

 // Full-page and mobile records.
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.waitForTimeout(400);
 await page.screenshot({path:path.join(OUT,'qa-page.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.waitForTimeout(1200);
 await page.screenshot({path:path.join(OUT,'qa-mobile.png'),fullPage:true});

 const assets=network.filter(u=>!u.startsWith('http://localhost:8123/')&&!u.includes('cdn.jsdelivr.net')&&!u.includes('fonts.g'));
 const report={loadMs,errors,requests:network.length,
  nonCdnRequests:assets,pageParts,numeric,beatCheck,sections,orbit,states,active,offScreen,tiers};
 fs.writeFileSync(path.join(OUT,'verification.json'),JSON.stringify(report,null,1));
 console.log(JSON.stringify({loadMs,errors:errors.length,pageParts,
  beatRoundTrip:beatCheck.every(b=>b.frontMatch&&b.stageMatch),
  superelevationAllPositive:sections.every(s=>s.outerMinusInner>0),sections,
  orbit:orbit.map(o=>o.name+'='+o.triangles).join(' '),
  activeFps:active.fps,offScreenFps:offScreen.fps,
  tiers:Object.fromEntries(Object.entries(tiers).map(([k,v])=>[k,v.fps+'fps/'+v.triangles+'tri'])),
  nonCdnRequests:assets},null,1));
 await browser.close(); server.kill();
})().catch(e=>{console.error(e);process.exit(1);});
