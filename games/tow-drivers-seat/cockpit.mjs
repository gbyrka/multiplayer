import * as THREE from '../hamster/vendor/three.mjs';
import { mergeStaticMeshes } from '../hamster/static-batches.mjs';
import { makeMirrorFrame, STEERING_CENTRE, MIRROR_WIDTH, MIRROR_HEIGHT } from './view-geometry.mjs';

const box = new THREE.BoxGeometry(1, 1, 1), rod = new THREE.CylinderGeometry(1, 1, 1, 10);
const soft = new THREE.SphereGeometry(1, 10, 8), up = new THREE.Vector3(0, 1, 0);
const mat = color => new THREE.MeshLambertMaterial({ color });
const trim = mat('#293a32'), leather = mat('#14261e'), edge = mat('#75806a'), metal = mat('#8c9981');
const paint = mat('#c9af79'), cloth = mat('#657e69'), cuff = mat('#384f3f');
const skin = mat('#d8a580');
function piece(parent, geometry, material, p, size) {
  const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...p); mesh.scale.set(...size); parent.add(mesh); return mesh;
}
function bar(parent, a, b, radius, material) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), v = end.clone().sub(start);
  const mesh = piece(parent, rod, material, start.clone().add(end).multiplyScalar(.5).toArray(), [radius, v.length(), radius]);
  mesh.quaternion.setFromUnitVectors(up, v.normalize()); return mesh;
}
function hand(parent, side) {
  const palm = new THREE.Group(); palm.position.set(side * .18, .005, .018); palm.rotation.z = side * .12; parent.add(palm);
  // A single smooth grip reads better at this scale than separate fingers.
  piece(palm, soft, skin, [0,0,0], [.035,.052,.030]);
  return palm;
}

/** Physical cabin, all in the SAME car coordinates as the seated eye and mirror. */
export class Cockpit {
  constructor(canvas, mirrorTexture) {
    this.group = new THREE.Group(); this.group.name='driver-cabin'; this.angle=0;
    // Only the context-restoration message uses a screen overlay.
    this.canvas=document.createElement('canvas');this.canvas.className='cockpit-overlay';this.canvas.setAttribute('aria-hidden','true');
    canvas.after(this.canvas);this.ctx=this.canvas.getContext('2d');
    this.mirror=makeMirrorFrame();
    const g=this.group;
    // Bonnet is centred on the CAR, visibly to the right of the driver's sight line.
    piece(g,box,paint,[0,.88,-1.17],[1.68,.06,.87]);
    for (const x of [-.57,.57]) piece(g,box,edge,[x,.913,-1.17],[.008,.002,.80]);
    // Windshield's sloping A pillars. The left SIDE window is outside its left pillar.
    for (const side of [-1,1]) {
      bar(g,[side*.77,.92,-.79],[side*.75,1.51,-.53],.030,trim);
      bar(g,[side*.75,1.51,-.53],[side*.76,1.51,1.0],.035,trim);
      piece(g,box,trim,[side*.79,.78,.12],[.09,.28,1.88]);
      piece(g,box,edge,[side*.775,.925,.12],[.035,.018,1.84]);
      piece(g,box,leather,[side*.737,.82,.15],[.035,.08,.34]);
    }
    bar(g,[-.75,1.51,-.53],[.75,1.51,-.53],.045,trim);
    piece(g,box,trim,[0,1.55,.25],[1.58,.07,1.64]);
    // Dashboard spans both seats; centre console and passenger vents are to the right.
    piece(g,box,trim,[0,.83,-.74],[1.53,.16,.12]);
    piece(g,box,trim,[.36,.83,-.60],[.78,.16,.40]);
    piece(g,box,trim,[-.43,.65,-.61],[.63,.18,.18]);
    piece(g,box,edge,[0,.915,-.67],[1.50,.016,.18]);
    piece(g,box,leather,[0,.72,-.47],[.28,.30,.22]);
    piece(g,box,trim,[0,.48,.0],[.24,.12,.85]);
    bar(g,[0,.52,-.12],[0,.68,-.17],.018,metal);
    piece(g,soft,leather,[0,.69,-.17],[.033,.036,.033]);
    piece(g,box,leather,[.45,.835,-.497],[.35,.09,.012]);
    for(let i=0;i<4;i++)piece(g,box,edge,[.45,.809+i*.018,-.487],[.32,.003,.006]);
    // Wheel and gauges align with the LEFT seat, never the car's centre console.
    const column=new THREE.Group();column.position.copy(STEERING_CENTRE);column.rotation.x=-.26;g.add(column);this.column=column;
    this.wheel=new THREE.Group();column.add(this.wheel);
    piece(this.wheel,new THREE.TorusGeometry(.185,.021,8,40),leather,[0,0,0],[1,1,1]);
    piece(this.wheel,new THREE.TorusGeometry(.190,.002,4,40),edge,[0,0,.017],[1,1,1]);
    for(const side of [-1,1]) {
      const spoke=piece(this.wheel,box,metal,[side*.108,-.013,0],[.155,.026,.020]);spoke.rotation.z=side*.16;
    }
    piece(this.wheel,box,trim,[0,-.10,0],[.027,.16,.02]);
    piece(this.wheel,soft,trim,[0,-.01,.011],[.073,.061,.023]);
    this.logo=document.createElement('canvas');this.logo.width=128;this.logo.height=64;
    const logoCtx=this.logo.getContext('2d');logoCtx.fillStyle='#edc37d';logoCtx.font='800 36px system-ui';logoCtx.textAlign='center';logoCtx.fillText('T↗',64,45);
    const logoTexture=new THREE.CanvasTexture(this.logo);logoTexture.colorSpace=THREE.SRGBColorSpace;
    piece(this.wheel,new THREE.PlaneGeometry(.095,.048),new THREE.MeshBasicMaterial({map:logoTexture,transparent:true,depthWrite:false}),[0,-.005,.036],[1,1,1]);
    this.hands=[hand(this.wheel,-1),hand(this.wheel,1)];
    this.arms=this.hands.map((_,i)=>({ side:i?1:-1,
      sleeve:piece(g,rod,cloth,[0,0,0],[1,1,1]),wrist:piece(g,rod,skin,[0,0,0],[1,1,1]),
      cuff:piece(g,rod,cuff,[0,0,0],[1,1,1]) }));
    // Small instrument texture is updated only when its displayed values change.
    const pod=new THREE.Group();pod.name='instrument-cluster';pod.position.set(-.43,1.05,-.76);pod.rotation.x=-.20;pod.scale.setScalar(.75);g.add(pod);
    piece(g,box,trim,[-.43,.95,-.76],[.12,.07,.04]);
    piece(pod,box,leather,[0,0,0],[.49,.17,.07]);
    this.display=document.createElement('canvas');this.display.width=384;this.display.height=128;this.displayCtx=this.display.getContext('2d');
    this.displayTexture=new THREE.CanvasTexture(this.display);this.displayTexture.colorSpace=THREE.SRGBColorSpace;
    piece(pod,new THREE.PlaneGeometry(.46,.145),new THREE.MeshBasicMaterial({map:this.displayTexture}),[0,0,.036],[1,1,1]);
    // Mirror glass/housing are outside the side window, not an inset in the windshield.
    this.mirrorGroup=new THREE.Group();this.mirrorGroup.position.copy(this.mirror.centre);
    this.mirrorGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(this.mirror.right,this.mirror.up,this.mirror.normal));g.add(this.mirrorGroup);
    piece(this.mirrorGroup,box,trim,[0,0,-.027],[MIRROR_WIDTH+.028,MIRROR_HEIGHT+.028,.05]);
    const glass=new THREE.PlaneGeometry(MIRROR_WIDTH,MIRROR_HEIGHT),uv=glass.getAttribute('uv');
    for(let i=0;i<uv.count;i++)uv.setX(i,1-uv.getX(i));
    this.mirrorGlass=piece(this.mirrorGroup,glass,new THREE.MeshBasicMaterial({map:mirrorTexture,toneMapped:false}),[0,0,.001],[1,1,1]);
    for(const side of [-1,1])piece(this.mirrorGroup,box,edge,[side*(MIRROR_WIDTH/2+.004),0,.003],[.009,MIRROR_HEIGHT+.02,.008]);
    bar(g,[-.79,.94,-.56],this.mirror.centre.clone().add(new THREE.Vector3(0,-.07,-.02)).toArray(),.016,trim);
    mergeStaticMeshes(this.wheel); mergeStaticMeshes(this.mirrorGroup);
    mergeStaticMeshes(g,new Set([column,pod,this.mirrorGroup,...this.arms.flatMap(a=>[a.sleeve,a.wrist,a.cuff])]));
    this.grip=new THREE.Vector3();this.elbow=new THREE.Vector3();this.delta=new THREE.Vector3();this.wrist=new THREE.Vector3();
  }
  resize(width,height,density) {
    Object.assign(this,{width,height,density});this.canvas.width=Math.round(width*density);this.canvas.height=Math.round(height*density);
  }
  segment(mesh,a,b,radius) {
    this.delta.copy(b).sub(a);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.scale.set(radius,this.delta.length(),radius);
    mesh.quaternion.setFromUnitVectors(up,this.delta.normalize());
  }
  draw(car,color,dt) {
    this.angle+=(car.steer*2.35-this.angle)*(1-Math.exp(-20*dt));this.wheel.rotation.z=-this.angle;
    this.wheel.updateMatrix();this.column.updateMatrix();
    for(const arm of this.arms) {
      this.grip.set(arm.side*.18,-.025,.020).applyMatrix4(this.wheel.matrix).applyMatrix4(this.column.matrix);
      this.elbow.set(STEERING_CENTRE.x+arm.side*.23,.42,.20);
      this.wrist.copy(this.grip).lerp(this.elbow,.18);
      this.segment(arm.sleeve,this.elbow,this.wrist,.042);this.segment(arm.wrist,this.wrist,this.grip,.024);
      this.delta.copy(this.wrist).lerp(this.grip,.12);this.segment(arm.cuff,this.wrist,this.delta,.045);
    }
    const speed=Math.round(Math.abs(car.speed)*4.5/64*3.6),gear=car.speed < -1?'R':car.speed>1?'D':'N';
    const key=`${speed}/${gear}`;
    if(key===this.displayKey)return;this.displayKey=key;
    const ctx=this.displayCtx;ctx.fillStyle='#10251e';ctx.fillRect(0,0,384,128);
    ctx.fillStyle='#c9d7b9';ctx.font='600 38px system-ui';ctx.fillText(gear,28,76);
    ctx.fillStyle='#f1cd89';ctx.font='600 70px system-ui';ctx.textAlign='center';ctx.fillText(String(speed).padStart(2,'0'),184,87);
    ctx.fillStyle='#a8b79a';ctx.font='600 16px system-ui';ctx.fillText('KM/H',311,62);
    ctx.fillStyle='#c5d69b';ctx.fillRect(26,110,Math.min(330,330*speed/120),3);
    ctx.textAlign='left';
    this.displayTexture.needsUpdate=true;
  }
}
