/** Actual WebGL views and mirror visibility. All fixtures live in this test only. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = new URL('../../', import.meta.url), output = 'test-results/tow-drivers-seat';
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (path.includes('..')) return res.writeHead(404).end();
  try {
    const file = path.slice(1) + (path.endsWith('/') ? 'index.html' : '');
    const body = await readFile(new URL(file, root));
    const type = { html:'text/html', mjs:'text/javascript', json:'application/json', css:'text/css', svg:'image/svg+xml', js:'text/javascript', jpg:'image/jpeg', webp:'image/webp' }[file.split('.').at(-1)];
    res.writeHead(200, { 'Content-Type':type ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless:true });
const errors = [];
let checks = 0;
const pass = message => { checks++; console.log(`PASS ${message}`); };
try {
  const page = await browser.newPage({ viewport:{width:1440,height:1000} });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if(message.type()==='error')errors.push(message.text()); });
  await page.route(/googlesyndication|googletagmanager|google-analytics/, route => route.fulfill({ contentType:'text/javascript',body:'' }));
  await page.goto(`${base}/multiplayer/games/tow-drivers-seat/`);
  await page.locator('#home:not([hidden])').waitFor();
  assert.match(await page.title(), /Driver’s Seat/);
  assert.match(await page.locator('meta[name=robots]').getAttribute('content'), /noindex/);
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1), `home overflow at ${width}`);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:`${output}/home.png`,fullPage:true});
  for(const path of ['/games/','/multiplayer/']) {
    const html=await (await page.request.get(base+path)).text();assert.doesNotMatch(html,/tow-drivers-seat/);
  }
  pass('Unlisted entry loads, opts out of indexing and fits 320–1440px');
  await page.evaluate(async () => {
    const {CockpitScene}=await import('/multiplayer/games/tow-drivers-seat/scene.mjs');
    const {createRace}=await import('/multiplayer/games/tow/race.mjs');
    const {pointAt}=await import('/multiplayer/games/tow/track.mjs');
    const {makeRig}=await import('/multiplayer/games/tow/physics.mjs');
    const THREE=await import('/multiplayer/games/hamster/vendor/three.mjs');
    const geometry=await import('/multiplayer/games/tow-drivers-seat/view-geometry.mjs');
    document.getElementById('home').hidden=true;document.getElementById('race').hidden=false;
    const previous=document.getElementById('game'),canvas=previous.cloneNode();previous.replaceWith(canvas);
    document.querySelector('.cockpit-overlay')?.remove();
    const scene=new CockpitScene(canvas),race=createRace(12345,'fixture',4);
    const names=['Alex','Morgan','Charlie','Sam'];race.phase='racing';scene.configure(race.track);
    window.fixture={scene,race,names,pointAt,makeRig,geometry,THREE};
    window.renderFixture=()=>{scene.updateHUD(race,0,names);scene.draw(race.rigs,0,names,race,1/15);};
    window.renderFixture();
  });
  assert.equal(await page.locator('.standings-row').count(),4);
  const initial=await page.evaluate(()=>{
    const {scene}=fixture;return {calls:scene.renderer.info.render.calls,triangles:scene.renderer.info.render.triangles,angle:scene.cockpit.angle};
  });
  await page.screenshot({path:`${output}/grid.png`,fullPage:true});
  assert.ok(initial.calls<200,`draw calls: ${initial.calls}`);assert.ok(initial.triangles<60000,`triangles: ${initial.triangles}`);
  await page.evaluate(()=>{fixture.race.rigs[0].car.steer=.45;for(let i=0;i<10;i++)renderFixture();});
  assert.ok(await page.evaluate(()=>fixture.scene.cockpit.angle>.9));
  await page.evaluate(()=>{fixture.race.rigs[0].car.steer=-.45;for(let i=0;i<10;i++)renderFixture();});
  assert.ok(await page.evaluate(()=>fixture.scene.cockpit.angle<-.9));
  pass(`Cockpit renders four rigs with bounded work (${initial.calls} draw calls, ${initial.triangles} triangles) and steering follows both turns`);
  const surfaces=await page.evaluate(()=>{
    const {scene,race,makeRig,THREE}=fixture;
    race.rigs=Array.from({length:4},(_,i)=>makeRig(race.track,i,6000,4));
    // Remove all other rigs from this optical-occlusion fixture.
    for(let i=1;i<4;i++){race.rigs[i].car.x+=20000;race.rigs[i].trailer.x+=20000;}
    const read=()=>{scene.mirrorAt=-Infinity;renderFixture();const pixels=new Uint8Array(256*180*4);scene.renderer.readRenderTargetPixels(scene.mirrorTarget,0,0,256,180,pixels);return pixels;};
    const before=read(),own=scene.models[0];
    const highlight=new THREE.MeshBasicMaterial({color:'#ff00ff'});
    const diff=pixels=>pixels.reduce((sum,v,i)=>sum+(Math.abs(v-before[i])>10?1:0),0);
    const check=mesh=>{const material=mesh.material;mesh.material=highlight;const result=diff(read());mesh.material=material;return result;};
    const drawbar=check(own.drawbar),leftWheel=check(own.trailerWheels[0]),rightWheel=check(own.trailerWheels[1]);
    const material=own.trailerBody.material;
    own.trailerBody.material=Array(6).fill(material);own.trailerBody.material[1]=highlight;const leftSide=diff(read());
    own.trailerBody.material=Array(6).fill(material);own.trailerBody.material[5]=highlight;const front=diff(read());
    own.trailerBody.material=material;highlight.dispose();read();
    const pixels=read(),canvas=document.createElement('canvas');canvas.width=256;canvas.height=180;
    const ctx=canvas.getContext('2d'),image=ctx.createImageData(256,180);
    for(let row=0;row<180;row++)image.data.set(pixels.subarray(row*256*4,(row+1)*256*4),(179-row)*256*4);
    ctx.putImageData(image,0,0);canvas.id='mirror-debug';canvas.style.cssText='width:768px;height:540px;image-rendering:pixelated';document.body.append(canvas);
    return {drawbar,leftWheel,rightWheel,leftSide,front};
  });
  await page.locator('#mirror-debug').screenshot({path:`${output}/mirror-straight.png`});
  await page.locator('#mirror-debug').evaluate(canvas=>canvas.remove());
  assert.equal(surfaces.drawbar,0,'the coupling is hidden, not exposed by omitting the car');
  assert.equal(surfaces.rightWheel,0,'the far wheel is occluded');
  assert.ok(surfaces.leftSide>100&&surfaces.leftWheel>30,'the near flank and near wheel are visible');
  pass('Physical mirror shows the near trailer flank and left wheel, with zero visible coupling or right wheel');
  // Mirror uses the actual articulated trailer, and really excludes off-camera rivals.
  const views=await page.evaluate(()=>{
    const {scene,race,makeRig}=fixture;race.rigs=Array.from({length:4},(_,i)=>makeRig(race.track,i,6000,4));
    const car=race.rigs[0].car,s=Math.sin(car.a),c=Math.cos(car.a);
    // Move rivals far away, then place one behind the left side of our rig.
    for(let i=1;i<4;i++){race.rigs[i].car.x+=20000;race.rigs[i].trailer.x+=20000;}
    const pixels=new Uint8Array(256*180*4);
    const read=()=>{scene.mirrorAt=-Infinity;renderFixture();scene.renderer.readRenderTargetPixels(scene.mirrorTarget,0,0,256,180,pixels);return Array.from(pixels);};
    const baseline=read(),ownTrailer={...race.rigs[0].trailer};race.rigs[0].trailer.x+=20000;const noTrailer=read();Object.assign(race.rigs[0].trailer,ownTrailer);
    const other=race.rigs[1];other.car.x=car.x-s*220-c*55;other.car.y=car.y+c*220-s*55;other.car.a=car.a;
    other.trailer.x=other.car.x-s*94;other.trailer.y=other.car.y+c*94;other.trailer.a=car.a;
    const behind=read();other.car.x=car.x+s*180-c*55;other.car.y=car.y-c*180-s*55;other.trailer.x+=20000;const ahead=read();
    const diff=(a,b)=>a.reduce((sum,v,i)=>sum+(Math.abs(v-b[i])>10?1:0),0);
    return {trailer:diff(baseline,noTrailer),behind:diff(baseline,behind),ahead:diff(baseline,ahead)};
  });
  const articulation=await page.evaluate(()=>{
    const {scene,race}=fixture,rig=race.rigs[0],car=rig.car;
    const read=()=>{scene.mirrorAt=-Infinity;renderFixture();const pixels=new Uint8Array(256*180*4);scene.renderer.readRenderTargetPixels(scene.mirrorTarget,0,0,256,180,pixels);return pixels;};
    const straight=read(),results=[];
    for(const angle of [-.3,.3]) {
      rig.trailer.a=car.a+angle;
      rig.trailer.x=car.x-Math.sin(car.a)*40-Math.sin(rig.trailer.a)*54;
      rig.trailer.y=car.y+Math.cos(car.a)*40+Math.cos(rig.trailer.a)*54;
      const pixels=read();results.push(pixels.reduce((sum,v,i)=>sum+(Math.abs(v-straight[i])>10?1:0),0));
    }
    return results;
  });
  assert.ok(articulation.every(changed=>changed>300),'actual articulated geometry changes the reflected trailer on either turn');
  assert.ok(views.trailer>300,JSON.stringify(views));assert.ok(views.behind>50,JSON.stringify(views));assert.ok(views.ahead<views.behind*.15,JSON.stringify(views));
  pass(`Live mirror reflects the trailer and a rival behind, excludes a rival ahead (${JSON.stringify(views)})`);
  await page.evaluate(()=>{
    const {race,scene,makeRig}=fixture;race.rigs=Array.from({length:4},(_,i)=>makeRig(race.track,i,9000+i*125,4));
    race.rigs[0].car.steer=.18;race.rigs[0].car.speed=220;race.rigs[1].car.braking=true;race.progress=[9000,9125,9250,9375];renderFixture();
  });
  await page.screenshot({path:`${output}/drive.png`,fullPage:true});
  const stopLights=await page.evaluate(()=>{
    const {scene,race,THREE}=fixture;
    const target=new THREE.WebGLRenderTarget(320,200),camera=new THREE.PerspectiveCamera(50,1.6,.1,60);
    const car=scene.models[1].car;car.updateMatrixWorld(true);
    camera.position.set(0,1.8,10).applyMatrix4(car.matrixWorld);
    camera.lookAt(new THREE.Vector3(0,.9,0).applyMatrix4(car.matrixWorld));
    const capture=braking=>{
      race.rigs[1].car.braking=braking;renderFixture();
      scene.renderer.setRenderTarget(target);scene.renderer.render(scene.world,camera);
      const pixels=new Uint8Array(320*200*4);scene.renderer.readRenderTargetPixels(target,0,0,320,200,pixels);scene.renderer.setRenderTarget(null);return pixels;
    };
    const off=capture(false),on=capture(true);
    const independent=scene.models[1].brakeLights.emissiveIntensity>0 && scene.models.filter((_,i)=>i!==1).every(m=>m.brakeLights.emissiveIntensity===0);
    const released=capture(false);
    let brighter=0;for(let i=0;i<on.length;i+=4)if(on[i]>off[i]+20)brighter++;
    const restored=off.every((v,i)=>v===released[i]);
    // Braking must not change the smaller speed/gear display at all.
    const ctx=scene.cockpit.displayCtx,driver=race.rigs[0].car;driver.braking=false;renderFixture();
    const display=ctx.getImageData(0,0,384,128).data;driver.braking=true;renderFixture();
    const after=ctx.getImageData(0,0,384,128).data;
    const noIndicator=display.every((v,i)=>v===after[i]);driver.braking=false;renderFixture();target.dispose();
    return {brighter,independent,restored,noIndicator};
  });
  assert.ok(stopLights.brighter>50,JSON.stringify(stopLights));
  assert.ok(stopLights.independent,'one driver braking does not light other cars');
  assert.ok(stopLights.restored,'rear lamps return to their original appearance on release');
  assert.ok(stopLights.noIndicator,'braking does not add a warning or change the instrument display');
  assert.ok(await page.locator('#brake-indicator').isHidden());
  pass(`Rear stop lamps brighten only for the braking rig and extinguish on release (${stopLights.brighter} pixels); speedometer has no brake indicator`);
  const before=await page.locator('.is-you .standings-value').innerText();
  await page.evaluate(()=>{fixture.race.progress[0]=fixture.race.track.start;renderFixture();});
  assert.equal(await page.locator('.is-you .standings-value').innerText(),'0%');assert.notEqual(before,'0%');
  await page.evaluate(()=>{fixture.race.finished[0]=82.1;renderFixture();});
  assert.equal(await page.locator('.is-you .standings-value').innerText(),'FINISHED');
  pass('All four progress bars reflect host progress, resets, position and completed trailer finishes');
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:1000});await page.evaluate(()=>{fixture.scene.resize();renderFixture();});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`race overflow at ${width}`);
    const points=await page.evaluate(()=>{const {scene,geometry}=fixture;return geometry.projectedMirror(scene.cockpit.mirror,scene.models[0].car.matrixWorld,scene.camera,scene.width,scene.height);});
    assert.ok(points.some(p=>p.x>0&&p.x<width*.25),'physical mirror is partly visible through the side window');
    assert.ok(points.some(p=>p.x<0),'outer mirror fragment is clipped by the actual field of view');
    await page.screenshot({path:`${output}/race-${width}.png`,fullPage:true});
  }
  const pauseWork=await page.evaluate(()=>{
    const {scene,race}=fixture;let calls=0;const render=scene.renderer.render.bind(scene.renderer);
    scene.renderer.render=(...args)=>{calls++;return render(...args);};
    race.phase='paused';race.epoch++;renderFixture();const first=calls;
    for(let i=0;i<20;i++)renderFixture();const idle=calls-first;
    scene.resize();renderFixture();const resized=calls-first;
    scene.renderer.render=render;race.phase='racing';race.epoch++;
    return {first,idle,resized};
  });
  assert.ok(pauseWork.first>0);assert.equal(pauseWork.idle,0);assert.ok(pauseWork.resized>0);
  pass('Paused graphics are cached, while resizing still redraws the mirror and cockpit');
  const memory=await page.evaluate(()=>{
    const {scene,race}=fixture;const samples=[];
    for(let i=0;i<6;i++){scene.configure(race.track);renderFixture();samples.push({...scene.renderer.info.memory});}return samples;
  });
  assert.ok(memory.at(-1).geometries<=memory[1].geometries+1,JSON.stringify(memory));
  assert.ok(memory.at(-1).textures<=memory[1].textures+1,JSON.stringify(memory));
  assert.deepEqual(errors,[]);pass('Race fits small screens; repeated rematches keep GPU geometry and texture memory bounded; no browser exceptions');
  const contextRecovery=await page.evaluate(()=>{
    const extension=fixture.scene.renderer.getContext().getExtension('WEBGL_lose_context');
    if(!extension)return false;window.loseGraphics=extension;extension.loseContext();return true;
  });
  if(contextRecovery) {
    await page.waitForFunction(()=>fixture.scene.contextLost);
    await page.evaluate(()=>renderFixture());
    assert.ok(await page.evaluate(()=>fixture.scene.cockpit.ctx.getImageData(0,0,1,1).data[3]>0));
    await page.evaluate(()=>loseGraphics.restoreContext());
    await page.waitForFunction(()=>!fixture.scene.contextLost);
    await page.evaluate(()=>renderFixture());
    assert.equal(await page.evaluate(()=>fixture.scene.cockpit.ctx.getImageData(0,0,1,1).data[3]),0);
    assert.deepEqual(errors,[]);pass('Context restoration redraws the physical cabin and clears its temporary message');
  }
  console.log(`TOW cockpit browser checks: ${checks} passed.`);
} finally { await browser.close();server.close(); }
