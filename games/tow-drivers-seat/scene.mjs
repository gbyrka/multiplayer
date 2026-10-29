import * as THREE from '../hamster/vendor/three.mjs';
import { pointAt, seededRandom } from '../tow/track.mjs';
import { COLORS } from '../tow/scene.mjs';
import { Cockpit } from './cockpit.mjs';
import { RaceProgress } from './progress.mjs';
import { mergeStaticMeshes } from '../hamster/static-batches.mjs';

const SCALE = 1 / 20;
const box = new THREE.BoxGeometry(1, 1, 1);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 10);
const cone = new THREE.ConeGeometry(1, 1, 7);
const shadow = new THREE.CircleGeometry(1, 16); shadow.rotateX(-Math.PI / 2);
const material = color => new THREE.MeshLambertMaterial({ color });
const asphalt = material('#62685f'), shoulder = material('#b6b49a'), paint = material('#e9dfb7');
const dark = material('#283d35'), tyres = material('#24302b'), glass = material('#66877e');
const chrome = material('#a7b2a0'), cream = material('#e2e2ce'), red = material('#d27960');
const shadowMat = new THREE.MeshBasicMaterial({ color: '#344a36', transparent: true, opacity: .36, depthWrite: false });

function part(parent, geometry, mat, x, y, z, sx, sy, sz) {
  const mesh = new THREE.Mesh(geometry, mat); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); parent.add(mesh); return mesh;
}
function ribbon(track, offset, width, y, mat, start = 0, end = track.points.length - 1) {
  const vertices = [], indices = [];
  for (let i = start; i <= end; i++) {
    const p = pointAt(track, track.points[i].s);
    for (const side of [-1, 1]) vertices.push((p.x + p.nx * (offset + side * width / 2)) * SCALE, y, (p.y + p.ny * (offset + side * width / 2)) * SCALE);
    if (i > start) { const n = (i - start) * 2; indices.push(n - 2, n - 1, n, n - 1, n + 1, n); }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, mat);
}
function instances(parent, geometry, mat, transforms, chunk = true) {
  if (!transforms.length) return;
  // Instancing alone would send every tree/barrel on the 25 km-unit route to
  // the GPU. Spatial batches let both cameras discard distant sections.
  if (chunk && transforms.length > 80) {
    const sections = new Map();
    for (const t of transforms) { const key = Math.floor(t.z / 80); if (!sections.has(key)) sections.set(key, []); sections.get(key).push(t); }
    for (const section of sections.values()) instances(parent, geometry, mat, section, false);
    return;
  }
  const mesh = new THREE.InstancedMesh(geometry, mat, transforms.length), dummy = new THREE.Object3D();
  transforms.forEach((t, i) => { dummy.position.set(t.x, t.y, t.z); dummy.rotation.set(0, t.a ?? 0, 0); dummy.scale.set(t.sx, t.sy, t.sz); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
  mesh.computeBoundingSphere(); parent.add(mesh); return mesh;
}
function label(text, color) {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 48;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#1e322ae8'; ctx.beginPath(); ctx.roundRect(0, 0, 256, 48, 12); ctx.fill();
  ctx.font = '600 24px system-ui'; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(text, 128, 32, 238);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false })); sprite.scale.set(2.3, .43, 1); return sprite;
}
function vehicle(color) {
  const car = new THREE.Group(), trailer = new THREE.Group(), body = material(color);
  part(car, shadow, shadowMat, 0, .025, 0, 1.05, 1.9, 1.9);
  part(car, box, dark, 0, .40, 0, 1.66, .38, 3.15);
  part(car, box, body, 0, .72, 0, 1.7, .58, 3.20);
  part(car, box, glass, 0, 1.19, .18, 1.47, .66, 1.53);
  part(car, box, body, 0, 1.55, .22, 1.60, .14, 1.70);
  for (const side of [-1, 1]) {
    part(car, box, body, side * .76, 1.22, .2, .10, .65, .10);
    part(car, box, body, side * .76, 1.22, -.55, .10, .65, .12);
    part(car, box, body, side * .76, 1.22, .95, .10, .65, .12);
    part(car, box, body, side * .98, 1.04, -.53, .23, .15, .30);
    part(car, box, chrome, side * .866, .91, .45, .025, .04, .22);
    part(car, box, cream, side * .58, .75, -1.615, .35, .18, .025);
    part(car, box, red, side * .61, .72, 1.615, .30, .19, .025);
  }
  part(car, box, dark, 0, .59, -1.625, .65, .19, .05);
  part(car, box, chrome, 0, .41, -1.635, 1.6, .09, .07);
  part(car, box, chrome, 0, .41, 1.635, 1.6, .09, .07);
  const frontWheels = [];
  for (const x of [-.86, .86]) for (const z of [-1.04, 1.02]) {
    const pivot = new THREE.Group(); pivot.position.set(x, .42, z); car.add(pivot);
    const wheel = part(pivot, cylinder, tyres, 0, 0, 0, .39, .21, .39); wheel.rotation.z = Math.PI / 2;
    const hub = part(pivot, cylinder, chrome, x < 0 ? -.115 : .115, 0, 0, .19, .015, .19); hub.rotation.z = Math.PI / 2;
    if (z < 0) frontWheels.push(pivot);
  }
  part(trailer, shadow, shadowMat, 0, .025, 0, 1.1, 1.8, 1.8);
  part(trailer, box, chrome, 0, .37, -.7, .10, .10, 3.8);
  part(trailer, box, dark, 0, .48, 0, 1.60, .16, 2.90);
  part(trailer, box, cream, 0, .83, 0, 1.60, .62, 2.90);
  part(trailer, box, chrome, 0, 1.16, 0, 1.64, .08, 2.94);
  part(trailer, box, material('#9caa91'), 0, 1.205, 0, 1.44, .025, 2.72);
  for (const x of [-.7,.7]) part(trailer, box, red, x, .71, 1.46, .18, .14, .03);
  for (const x of [-.85,.85]) {
    const wheel = part(trailer, cylinder, tyres, x, .39, .4, .38, .18, .38); wheel.rotation.z = Math.PI / 2;
    part(trailer, box, chrome, x, .71, .4, .22, .09, 1.0);
    for (const z of [-1.35, 0, 1.35]) part(trailer, box, chrome, x * .91, .83, z, .04, .62, .06);
  }
  mergeStaticMeshes(car, new Set(frontWheels)); mergeStaticMeshes(trailer);
  return { car, trailer, frontWheels };
}

export class CockpitScene {
  constructor(canvas) {
    this.canvas = canvas; this.elapsed = 0; this.drawBudget = 0; this.mirrorAt = -Infinity; this.slowFrames = 0; this.models = [];
    try { this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' }); }
    catch (cause) { throw new Error('The cockpit needs WebGL 2. Enable browser hardware acceleration and reload.', { cause }); }
    const gl = this.renderer.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info');
    this.software = info && /swiftshader|llvmpipe|software rasterizer/i.test(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
    this.pixelRatio = Math.min(devicePixelRatio || 1, this.software ? .65 : 1.4);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;
    this.world = new THREE.Scene(); this.world.background = new THREE.Color('#d6dfcf'); this.world.fog = new THREE.Fog('#d6dfcf', 95, 245);
    this.world.add(new THREE.HemisphereLight('#fff5dc', '#647652', 2.15));
    const sun = new THREE.DirectionalLight('#ffe0a3', 1.55); sun.position.set(-80, 130, -70); this.world.add(sun);
    this.camera = new THREE.PerspectiveCamera(70, 1, .08, 290);
    this.rearCamera = new THREE.PerspectiveCamera(76, 1.43, .08, 200);
    this.mirrorTarget = new THREE.WebGLRenderTarget(256, 180, { depthBuffer: true, stencilBuffer: false });
    this.mirrorWorld = new THREE.Scene();
    const mirrorMat = new THREE.MeshBasicMaterial({ map: this.mirrorTarget.texture, toneMapped: false, depthTest: false, depthWrite: false });
    const mirrorPlane = new THREE.Mesh(new THREE.PlaneGeometry(2,2), mirrorMat); mirrorPlane.scale.x = -1; mirrorMat.side = THREE.DoubleSide;
    this.mirrorWorld.add(mirrorPlane); this.flatCamera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    this.cockpit = new Cockpit(canvas); this.progress = new RaceProgress(document.getElementById('race-standings'));
    this.look = new THREE.Vector3();
    this.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.contextLost = true; });
    this.canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; this.mirrorAt = -Infinity; });
  }
  configure(track) {
    if (this.environment) {
      this.world.remove(this.environment);
      const geometries = new Set(), materials = new Set(), retained = [asphalt,shoulder,paint,dark,tyres,glass,chrome,cream,red,shadowMat];
      this.environment.traverse(node => {
        if (node.geometry && ![box,cylinder,cone,shadow].includes(node.geometry)) geometries.add(node.geometry);
        if (node.material && !retained.includes(node.material)) materials.add(node.material);
        if (node.isInstancedMesh) node.dispose();
      });
      geometries.forEach(g => g.dispose()); materials.forEach(m => { m.map?.dispose(); m.dispose(); });
    }
    this.track = track; this.environment = new THREE.Group(); this.world.add(this.environment);
    this.progress.configure(track); this.mirrorAt = -Infinity; this.cockpit.angle = 0;
    const env = this.environment;
    this.ground = part(env, box, material('#879870'), 0, -.09, 0, 600, .1, 600);
    // Short road chunks are independently culled instead of drawing a map-sized mesh.
    for (let start = 0; start < track.points.length - 1; start += 20) {
      const end = Math.min(start + 20, track.points.length - 1);
      env.add(ribbon(track,0,356,0,shoulder,start,end),ribbon(track,0,344,.012,asphalt,start,end));
      for (const side of [-1,1]) env.add(ribbon(track,side*156,2,.025,paint,start,end));
    }
    const marks = [];
    for(let s=40;s<track.length;s+=70) {
      const p=pointAt(track,s); marks.push({x:p.x*SCALE,y:.025,z:p.y*SCALE,a:-p.a,sx:.10,sy:.015,sz:1.35});
    }
    instances(env,box,material('#d7d4b0'),marks);
    // Repeated objects use a few draw calls; no real-time shadow maps or post effects.
    const trunks=[],leaves=[],rocks=[],verges=[]; const rand=seededRandom(track.seed);
    for(let s=0;s<track.length;s+=125) for(const side of [-1,1]) {
      const p=pointAt(track,s),lateral=side*(235+rand()*480),x=(p.x+p.nx*lateral)*SCALE,z=(p.y+p.ny*lateral)*SCALE;
      const size=1.5+rand()*2.8;
      trunks.push({x,y:size*.48,z,sx:.16,sy:size,sz:.16});
      leaves.push({x,y:size*1.1,z,sx:size*.65,sy:size*1.6,sz:size*.65,a:rand()*6});
      if(rand()>.5) rocks.push({x:x+2,y:.30,z:z+3,sx:.9,sy:.6,sz:.8,a:rand()*6});
      const edge=side*(187+rand()*20);verges.push({x:(p.x+p.nx*edge)*SCALE,y:.12,z:(p.y+p.ny*edge)*SCALE,sx:.10,sy:.24,sz:.10});
    }
    instances(env,cylinder,material('#76694e'),trunks); instances(env,cone,material('#587654'),leaves);
    instances(env,new THREE.DodecahedronGeometry(1,0),material('#9b9e84'),rocks); instances(env,box,paint,verges);
    const barrels=[],bands=[],crates=[],braces=[];
    for(const o of track.obstacles) {
      const x=o.x*SCALE,z=o.y*SCALE,a=-o.a;
      if(o.kind==='barrel') {
        barrels.push({x,y:.62,z,a,sx:o.w*SCALE*.5,sy:1.24,sz:o.h*SCALE*.5});
        for(const y of [.33,.89]) bands.push({x,y,z,a,sx:o.w*SCALE*.505,sy:.14,sz:o.h*SCALE*.505});
      } else {
        crates.push({x,y:.65,z,a,sx:o.w*SCALE,sy:1.30,sz:o.h*SCALE});
        for(const y of [.13,1.17]) braces.push({x,y,z,a,sx:o.w*SCALE*1.02,sy:.10,sz:o.h*SCALE*1.02});
      }
    }
    instances(env,cylinder,material('#ba7650'),barrels); instances(env,cylinder,paint,bands);
    instances(env,box,material('#a58a5d'),crates);instances(env,box,material('#d4bb87'),braces);
    const posts=[],gateBars=[];
    for(const s of track.gates) {
      const p=pointAt(track,s),finish=s===track.finish;
      for(const side of [-1,1]) posts.push({x:(p.x+p.nx*side*166)*SCALE,y:1.7,z:(p.y+p.ny*side*166)*SCALE,a:-p.a,sx:.17,sy:3.4,sz:.17});
      gateBars.push({x:p.x*SCALE,y:.04,z:p.y*SCALE,a:-p.a,sx:15.7,sy:.025,sz:finish?1.1:.15});
      if(finish) {
        const sign=label('F I N I S H', '#f5dfac');sign.position.set(p.x*SCALE,4.3,p.y*SCALE);sign.scale.set(7,1.3,1);env.add(sign);
        const finishSquares=[];
        for(let row=0;row<2;row++)for(let col=0;col<16;col++)if((row+col)%2) {
          const lateral=-150+col*20,longitudinal=-5+row*10;
          finishSquares.push({x:(p.x+p.nx*lateral+p.tx*longitudinal)*SCALE,y:.07,z:(p.y+p.ny*lateral+p.ty*longitudinal)*SCALE,a:-p.a,sx:1,sy:.015,sz:.5});
        }
        instances(env,box,dark,finishSquares);
      }
    }
    instances(env,box,material('#e7c48a'),posts);instances(env,box,material('#d6d6aa'),gateBars);
    // A clear physical start stripe on the same original grid.
    const start=pointAt(track,track.start+60);
    const stripe=part(env,box,paint,start.x*SCALE,.03,start.y*SCALE,15.6,.02,.12);stripe.rotation.y=-start.a;
    this.resize();
  }
  resize() {
    const rect=this.canvas.getBoundingClientRect();this.width=Math.max(1,rect.width);this.height=Math.max(1,rect.height);
    const density=Math.min(this.pixelRatio,Math.sqrt(1800000/(this.width*this.height)));
    this.renderer.setPixelRatio(density);this.renderer.setSize(this.width,this.height,false);
    this.camera.aspect=this.width/this.height;this.camera.updateProjectionMatrix();
    this.cockpit.resize(this.width,this.height,Math.min(devicePixelRatio||1,1.5));
    const m=this.cockpit.mirror;this.rearCamera.aspect=m.w/m.h;this.rearCamera.updateProjectionMatrix();
    this.mirrorAt=-Infinity; this.forceFrame=true;
  }
  updateHUD(state,slot,names) { this.progress.update(state,slot,names); }
  draw(rigs,slot,names,state,dt) {
    if(!this.track||!rigs?.[slot]||document.hidden)return;
    if(this.contextLost) {
      const ctx=this.cockpit.ctx;ctx.setTransform(this.cockpit.density,0,0,this.cockpit.density,0,0);ctx.fillStyle='#17291f';ctx.fillRect(0,0,this.width,this.height);ctx.fillStyle='#e7dbb5';ctx.font='14px system-ui';ctx.textAlign='center';ctx.fillText('Graphics paused. Restoring the cockpit…',this.width/2,this.height/2);return;
    }
    this.elapsed+=dt; this.drawBudget+=dt;
    const staticFrame = ['paused','results'].includes(state.phase) ? `${state.id}/${state.epoch}/${state.phase}` : null;
    if (!this.forceFrame && staticFrame && this.lastStaticFrame === staticFrame) return;
    // Simulation, input and sound still update at their original rates. Only
    // software graphics are capped, and an unchanged paused scene is cached.
    if (!this.forceFrame && this.drawBudget < 1 / (this.software ? 30 : 60)) return;
    const renderDT = Math.min(.1, this.drawBudget); this.drawBudget = 0;
    this.forceFrame=false; this.lastStaticFrame=staticFrame;
    // Adapt only graphics resolution, never the original simulation or networking.
    this.slowFrames=dt>.037?this.slowFrames+1:Math.max(0,this.slowFrames-1);
    if(this.slowFrames>90&&this.pixelRatio>.6) {this.pixelRatio=Math.max(.6,this.pixelRatio*.8);this.slowFrames=0;this.resize();}
    while(this.models.length<rigs.length) {
      const i=this.models.length,model=vehicle(COLORS[i]);this.world.add(model.car,model.trailer);this.models.push(model);
    }
    this.models.forEach((model,i)=> {
      const rig=rigs[i];model.car.visible=model.trailer.visible=!!rig;if(!rig)return;
      for(const kind of ['car','trailer']) {const b=rig[kind];model[kind].position.set(b.x*SCALE,0,b.y*SCALE);model[kind].rotation.y=-b.a;}
      model.frontWheels.forEach(w=>w.rotation.y=-rig.car.steer);
      if(model.name!==names[i]) {
        if(model.label) {model.car.remove(model.label);model.label.material.map.dispose();model.label.material.dispose();}
        model.name=names[i];model.label=label(`${i+1} · ${names[i]}`,COLORS[i]);model.label.position.set(0,2.25,0);model.car.add(model.label);
      }
    });
    const car=rigs[slot].car,s=Math.sin(car.a),c=Math.cos(car.a),x=car.x*SCALE,z=car.y*SCALE,own=this.models[slot];
    // Eye is inside the driver's seat, offset left. No camera orbit or chase lag.
    this.camera.position.set(x-c*.39-s*.10,1.34,z-s*.39+c*.10);
    this.look.set(this.camera.position.x+s*20,-2.86,this.camera.position.z-c*20);this.camera.lookAt(this.look);
    this.ground.position.x=x;this.ground.position.z=z;
    const renderer=this.renderer;renderer.info.reset();
    // Left mirror uses the same rig positions. Omit our near car body so its
    // cabin does not occlude the trailer in this compact convex-mirror view.
    own.car.visible=false;
    if(this.elapsed-this.mirrorAt>=1/15) {
      this.mirrorAt=this.elapsed;
      this.rearCamera.position.set(x-c*1.12+s*.46,1.13,z-s*1.12-c*.46);
      this.look.set(this.rearCamera.position.x-s*20+c*1.35,1.0,this.rearCamera.position.z+c*20+s*1.35);this.rearCamera.lookAt(this.look);
      renderer.setRenderTarget(this.mirrorTarget);renderer.setScissorTest(false);renderer.clear();renderer.render(this.world,this.rearCamera);
    }
    own.car.visible=false;own.trailer.visible=false;
    renderer.setRenderTarget(null);renderer.setViewport(0,0,this.width,this.height);renderer.setScissorTest(false);renderer.clear();renderer.render(this.world,this.camera);
    own.car.visible=true;own.trailer.visible=true;
    const m=this.cockpit.mirror;
    renderer.autoClear=false;renderer.setViewport(m.x,this.height-m.y-m.h,m.w,m.h);renderer.setScissor(m.x,this.height-m.y-m.h,m.w,m.h);renderer.setScissorTest(true);renderer.render(this.mirrorWorld,this.flatCamera);
    renderer.setScissorTest(false);renderer.autoClear=true;
    this.cockpit.draw(car,COLORS[slot],renderDT);
  }
}
