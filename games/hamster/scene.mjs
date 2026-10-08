// Habitat, detailed hamster anatomy and food artwork adapted from the sibling HAMSTER.
import * as THREE from './vendor/three.mjs';
import { standingTurnPaw } from './paws.mjs';
import { tunnelPaths, tunnelRadius, tunnelPose, tunnelTurnPaw } from './tunnel.mjs';
import { decks, supports, waterFixture, ramps, surfaceNormal, house, houseWalls } from './world.mjs';
import { batchStaticMeshes, mergeStaticMeshes } from './static-batches.mjs';
import { nearWater } from './physics.mjs';
import { COLORS } from './game-core.mjs';

export class HamsterScene {
  constructor(canvas, map) { Object.assign(this, createScene(canvas, map)); }
}
function createScene(canvas, map) {
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const underfurSource = new URL(`./assets/hamster-underfur.png?v=${document.documentElement.dataset.appVersion}`, import.meta.url).href;
let clock = 0, farCamera = false;
const look = new THREE.Vector3();
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
} catch (error) {
  throw new Error("WebGL 2 is unavailable. Enable hardware acceleration or try another browser.", { cause: error });
}
const gl = renderer.getContext(), debugRenderer = gl.getExtension('WEBGL_debug_renderer_info');
const gpuName = debugRenderer ? gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL) : '';
const software = /swiftshader|llvmpipe|software rasterizer/i.test(gpuName);
renderer.setPixelRatio(Math.min(devicePixelRatio, software ? .4 : 1.4));
renderer.shadowMap.enabled = !software;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#152b34");
scene.fog = new THREE.Fog("#152b34", 27, 65);
const camera = new THREE.PerspectiveCamera(53, 1, 0.1, 100);
scene.add(new THREE.HemisphereLight("#c8eef6", "#70523a", 2.0));
const sun = new THREE.DirectionalLight("#ffe2ad", 3.5);
sun.position.set(-8, 18, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, {
  left: -17,
  right: 17,
  top: 17,
  bottom: -17,
  near: 1,
  far: 45,
});
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.04;
scene.add(sun);
const fill = new THREE.DirectionalLight("#7ddfe2", 1.5);
fill.position.set(10, 9, -10);
scene.add(fill);
const mat = (color, roughness = 0.8, metalness = 0) =>
  software ? new THREE.MeshLambertMaterial({ color }) : new THREE.MeshStandardMaterial({ color, roughness, metalness });
function texture(kind) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = kind === "wood" ? "#ba8b58" : "#b79662";
  ctx.fillRect(0, 0, 256, 256);
  let seed = 421;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < (kind === "wood" ? 480 : 2400); i++) {
    const x = rand() * 256,
      y = rand() * 256;
    ctx.strokeStyle = `rgba(${rand() > 0.5 ? "255,233,191" : "74,46,23"},${
      rand() * 0.22
    })`;
    ctx.lineWidth = rand() * 2 + 0.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
      x + (kind === "wood" ? rand() * 95 : rand() * 10),
      y + rand() * 4
    );
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(kind === "wood" ? 3 : 7, kind === "wood" ? 1 : 7);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const wood = mat("#dfb782");
wood.map = texture("wood");
const bedding = mat("#e4c79a");
bedding.map = texture("bedding");
const darkWood = mat("#8d603e"),
  metal = mat("#41616b", 0.35, 0.65),
  teal = mat("#397f7a"),
  cream = mat("#f5dfba"),
  pink = mat("#d99c96"),
  black = mat("#151516", 0.15),
  gold = mat("#efb65c", 0.45);
const sphereGeo = new THREE.SphereGeometry(1, 24, 16),
  boxGeo = new THREE.BoxGeometry(1, 1, 1),
  rodGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
function mesh(geo, material, parent = scene) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function box(x, y, z, w, h, d, material, parent = scene) {
  const m = mesh(boxGeo, material, parent);
  m.position.set(x, y, z);
  m.scale.set(w, h, d);
  return m;
}
function ell(x, y, z, sx, sy, sz, material, parent = scene) {
  const m = mesh(sphereGeo, material, parent);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}
function rod(a, b, r, material, parent = scene) {
  const va = new THREE.Vector3(...a),
    vb = new THREE.Vector3(...b),
    delta = vb.clone().sub(va);
  const m = mesh(
    rodGeo,
    material,
    parent
  );
  m.scale.set(r, delta.length(), r);
  m.position.copy(va.add(vb).multiplyScalar(0.5));
  m.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    delta.normalize()
  );
  return m;
}
const ringGeometries = new Map();
function ring(radius, tube, material, parent = scene) {
  const key = `${radius}:${tube}`;
  if (!ringGeometries.has(key)) ringGeometries.set(key, new THREE.TorusGeometry(radius, tube, 12, 64));
  return mesh(ringGeometries.get(key), material, parent);
}
// Habitat: a warm wooden miniature against a quiet, blue evening room.
box(0, -0.65, 0, 24, 1, 20, teal);
box(0, -0.1, 0, 22, 0.25, 18, bedding);
box(0, -1.35, 0, 45, 0.35, 38, mat("#263d43"));
box(-11.2, 0.34, 0, 0.25, 0.85, 18.5, wood);
for (const [a, b] of [
  [-9.25, -7.85],
  [-6.15, 6.15],
  [7.85, 9.25],
])
  box(11.2, 0.34, (a + b) / 2, 0.25, 0.85, b - a, wood);
for (const z of [-9.2, 9.2]) box(0, 0.34, z, 22.6, 0.85, 0.25, wood);
for (const x of [-11.2, 11.2])
  for (const z of [-9.2, 9.2]) {
    box(x, 4.3, z, 0.25, 8, 0.25, metal);
    ell(x, 8.35, z, 0.22, 0.22, 0.22, gold);
  }
for (const y of [1.1, 8.15]) {
  for (const z of [-9.2, 9.2]) box(0, y, z, 22.5, 0.09, 0.09, metal);
  box(-11.2, y, 0, 0.09, 0.09, 18.5, metal);
  for (const [a, b] of y < 2
    ? [
        [-9.25, -7.85],
        [-6.15, 6.15],
        [7.85, 9.25],
      ]
    : [[-9.25, 9.25]])
    box(11.2, y, (a + b) / 2, 0.09, 0.09, b - a, metal);
}
// Front bars fade with the camera, keeping the hamster visible from inside.
const bars = [];
for (let x = -10.6; x < 11; x += 0.72)
  for (const z of [-9.2, 9.2]) {
    const m = rod([x, 0.7, z], [x, 8.15, z], 0.028, metal.clone());
    bars.push(m);
  }
for (let z = -8.6; z < 9; z += 0.72)
  for (const x of [-11.2, 11.2]) {
    const spans =
      x < 0
        ? [[0.7, 8.15]]
        : Math.abs(Math.abs(z) - 7) < 0.86
        ? [[1.65, 8.15]]
        : Math.abs(z + 4) < 0.9
        ? [
            [0.7, 5.95],
            [7.6, 8.15],
          ]
        : [[0.7, 8.15]];
    for (const [a, b] of spans) {
      const m = rod([x, a, z], [x, b, z], 0.028, metal.clone());
      bars.push(m);
    }
  }
for (const m of bars) {
  m.material.transparent = true;
  m.castShadow = false;
}
for (const d of decks) {
  const cx = (d.x1 + d.x2) / 2,
    cz = (d.z1 + d.z2) / 2;
  box(cx, d.y - 0.16, cz, d.x2 - d.x1, 0.32, d.z2 - d.z1, wood);
  box(cx, d.y + 0.045, d.z1 + 0.15, d.x2 - d.x1, 0.09, 0.1, gold);
}
for (const support of supports) rod(support.from, support.to, support.radius, darkWood);
for (const r of ramps) {
  const alongX = r.axis === "x",
    length = alongX ? r.x2 - r.x1 : r.z2 - r.z1,
    rise = r.high - r.low;
  const group = new THREE.Group();
  group.position.set(
    (r.x1 + r.x2) / 2,
    (r.low + r.high) / 2,
    (r.z1 + r.z2) / 2
  );
  if (alongX) group.rotation.z = Math.atan2(rise, length);
  else group.rotation.x = Math.atan2(rise, length);
  scene.add(group);
  const span = Math.hypot(length, rise);
  box(
    0,
    -0.08,
    0,
    alongX ? span : r.x2 - r.x1,
    0.16,
    alongX ? r.z2 - r.z1 : span,
    wood,
    group
  );
  for (let i = 0; i <= Math.floor(length / 0.43); i++) {
    const t = (i / Math.floor(length / 0.43) - 0.5) * span;
    box(
      alongX ? t : 0,
      0.04,
      alongX ? 0 : t,
      alongX ? 0.08 : r.x2 - r.x1,
      0.065,
      alongX ? r.z2 - r.z1 : 0.08,
      darkWood,
      group
    );
  }
  for (const edge of [-1, 1])
    box(
      alongX ? 0 : (edge * (r.x2 - r.x1)) / 2,
      0.13,
      alongX ? (edge * (r.z2 - r.z1)) / 2 : 0,
      alongX ? span : 0.09,
      0.24,
      alongX ? 0.09 : span,
      teal,
      group
    );
}
// Scatter actual curled wood chips; one draw call for the whole bedding.
const chipGeo = new THREE.BoxGeometry(0.16, 0.025, 0.055),
  chips = new THREE.InstancedMesh(chipGeo, cream, 1400),
  dummy = new THREE.Object3D();
for (let i = 0; i < 1400; i++) {
  dummy.position.set(
    (Math.random() - 0.5) * 21.5,
    0.05 + Math.random() * 0.04,
    (Math.random() - 0.5) * 17.5
  );
  dummy.rotation.set(
    Math.random() * 0.4,
    Math.random() * 6.28,
    Math.random() * 0.3
  );
  dummy.scale.setScalar(0.5 + Math.random() * 1.5);
  dummy.updateMatrix();
  chips.setMatrixAt(i, dummy.matrix);
}
chips.receiveShadow = true;
scene.add(chips);
// A hollow hut with an arched entrance and a cutaway roof when occupied.
const houseCutaway = [];
function cutawayMaterial(source) {
  const material = source.clone();
  material.transparent = true;
  houseCutaway.push(material);
  return material;
}
for (const wall of houseWalls.slice(0, 3)) {
  box(
    (wall.x1 + wall.x2) / 2,
    house.y / 2,
    (wall.z1 + wall.z2) / 2,
    wall.x2 - wall.x1,
    house.y,
    wall.z2 - wall.z1,
    wood
  );
}
const frontShape = new THREE.Shape();
frontShape.moveTo(house.x1, 0);
frontShape.lineTo(house.doorX - 0.8, 0);
frontShape.lineTo(house.doorX - 0.8, 0.65);
frontShape.absarc(house.doorX, 0.65, 0.8, Math.PI, 0, true);
frontShape.lineTo(house.doorX + 0.8, 0);
frontShape.lineTo(house.x2, 0);
frontShape.lineTo(house.x2, house.y);
frontShape.lineTo(house.x1, house.y);
frontShape.closePath();
const front = mesh(
  new THREE.ExtrudeGeometry(frontShape, {
    depth: house.thickness,
    bevelEnabled: false,
    curveSegments: 32,
  }),
  cutawayMaterial(wood)
);
front.position.z = house.z2 - house.thickness;
for (const side of [-1, 1]) {
  const roof = box(
    -1 + side * 0.8,
    2.13,
    -6,
    1.95,
    0.18,
    2.75,
    cutawayMaterial(teal)
  );
  roof.rotation.z = -side * 0.42;
}
// Soft, low bedding leaves enough room to walk and turn inside.
const nest = ell(-1, 0.07, -6.25, 0.88, 0.07, 0.56, darkWood);
for (let i = 0; i < 28; i++) {
  const angle = i * 2.4,
    r = 0.35 + (i % 5) * 0.1;
  const straw = box(
    -1 + Math.sin(angle) * r,
    0.12,
    -6.25 + Math.cos(angle) * r * 0.65,
    0.3,
    0.025,
    0.045,
    cream
  );
  straw.rotation.y = angle;
}
const hutLight = new THREE.PointLight("#ffdfa0", 0.7, 3.5, 2);
hutLight.position.set(-1, 1.2, -6);
scene.add(hutLight);
// Water bottle and food bowl.
const waterSpout = new THREE.Vector3(...waterFixture.spout);
const bottleMat = new THREE.MeshPhysicalMaterial({
  color: "#a7e1e1",
  roughness: 0.15,
  transparent: true,
  opacity: 0.48,
  metalness: 0.05,
});
const bottle = mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.65, 24), bottleMat);
bottle.position.set(10.55, 2.1, 5.8);
const bottleCap = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.14, 28), teal);
bottleCap.position.set(10.55, 2.98, 5.8);
for (let i = 0; i < 6; i++) {
  box(10.55, 1.55 + i * 0.21, 6.205, i % 2 ? 0.1 : 0.18, 0.014, 0.006, cream);
}
const water = mesh(
  new THREE.CylinderGeometry(0.35, 0.35, 0.85, 24),
  mat("#50a9b4")
);
water.position.set(10.55, 1.8, 5.8);
const nozzleMetal = mat("#bdcbd0", 0.19, 0.88);
for (const nozzle of waterFixture.nozzle) rod(nozzle.from, nozzle.to, nozzle.radius, nozzleMetal);
ell(8.65, 0.62, 5.8, 0.06, 0.055, 0.055, nozzleMetal);
ell(9.3, 0.15, 5.8, 0.5, 0.15, 0.5, teal);
const dropletMaterial = new THREE.MeshPhysicalMaterial({
  color: "#bde9f4",
  roughness: 0.05,
  metalness: 0.1,
  transparent: true,
  opacity: 0.8,
});
const waterDrops = Array.from({ length: 4 }, () => {
  const drop = ell(8.65, 0.58, 5.8, 0.022, 0.038, 0.022, dropletMaterial);
  drop.visible = false;
  return drop;
});
const bowl = ring(0.75, 0.16, teal);
bowl.rotation.x = Math.PI / 2;
bowl.position.set(2, 0.2, 7);
ell(2, 0.09, 7, 0.72, 0.08, 0.72, darkWood);
// Freestanding exercise wheel. Axis is perpendicular to the open front.
const wheel = new THREE.Group();
wheel.position.set(6, 2.25, 1.5);
scene.add(wheel);
const wheelRotor = new THREE.Group();
wheel.add(wheelRotor);
for (const z of [-0.6, 0.6]) {
  const r = ring(2.05, 0.115, teal, wheelRotor);
  r.position.z = z;
}
for (let i = 0; i < 52; i++) {
  const a = (i / 52) * Math.PI * 2;
  const slat = box(
    Math.sin(a) * 2.05,
    Math.cos(a) * 2.05,
    0,
    0.22,
    0.08,
    1.2,
    wood,
    wheelRotor
  );
  slat.rotation.z = -a;
}
for (let i = 0; i < 8; i++) {
  const a = (i * Math.PI) / 4;
  rod(
    [0, 0, -0.65],
    [Math.sin(a) * 2, Math.cos(a) * 2, -0.65],
    0.045,
    teal,
    wheelRotor
  );
}
ell(0, 0, -0.66, 0.22, 0.22, 0.15, gold, wheelRotor);
rod([6, 0.1, 0.55], [6, 2.25, 0.55], 0.14, metal);
box(6, 0.08, 1, 3, 0.16, 2, teal);
// A little plant outside the habitat gives the room a sense of scale.
const plant = mat("#427a65");
box(14, 0.4, -9, 2, 2, 2, mat("#c8b7a0"));
for (let i = 0; i < 12; i++) {
  const a = i * 2.4;
  const leaf = ell(
    14 + Math.sin(a) * 0.65,
    2 + i * 0.19,
    -9 + Math.cos(a) * 0.65,
    0.27,
    0.9,
    0.16,
    plant
  );
  leaf.rotation.z = Math.sin(a) * 0.7;
}
// Translucent open-ended plastic, fine ribs and candy-coloured locking collars.
const tubeColors = ["#9ce8e3", "#bcb1ed", "#ffc798"];
const tubeGlass = new THREE.MeshPhysicalMaterial({
  color: "#c6f3f0",
  transparent: true,
  opacity: 0.14,
  roughness: 0.19,
  metalness: 0,
  clearcoat: 1,
  clearcoatRoughness: 0.12,
  side: THREE.DoubleSide,
  depthWrite: false,
});
class TunnelCurve extends THREE.Curve {
  constructor(branch) {
    super();
    this.branch = branch;
  }
  getPoint(t, target = new THREE.Vector3()) {
    const p = tunnelPose(this.branch, t * tunnelPaths[this.branch].length);
    return target.set(p.x, p.y + tunnelRadius, p.z);
  }
}
for (let branch = 0; branch < tunnelPaths.length; branch++) {
  const path = tunnelPaths[branch],
    curve = new TunnelCurve(branch);
  const geometry = new THREE.TubeGeometry(curve, 180, tunnelRadius, 32, false);
  // Trim internal walls where the three open tubes meet, forming one real Y lumen.
  const vertices = geometry.attributes.position;
  const indices = geometry.index.array,
    visibleFaces = [];
  const neighbors = tunnelPaths
    .filter((_, i) => i !== branch)
    .flatMap((p) => p.points.filter((v) => v.s > p.length - 3));
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i],
      b = indices[i + 1],
      c = indices[i + 2];
    const x = (vertices.getX(a) + vertices.getX(b) + vertices.getX(c)) / 3;
    const y = (vertices.getY(a) + vertices.getY(b) + vertices.getY(c)) / 3;
    const z = (vertices.getZ(a) + vertices.getZ(b) + vertices.getZ(c)) / 3;
    const internal =
      Math.hypot(x - 15, y - tunnelRadius, z) < 3.5 &&
      neighbors.some(
        (p) =>
          (x - p.x) ** 2 + (y - p.y - tunnelRadius) ** 2 + (z - p.z) ** 2 <
          (tunnelRadius * 0.99) ** 2
      );
    if (!internal) visibleFaces.push(a, b, c);
  }
  geometry.setIndex(visibleFaces);
  const shell = mesh(geometry, tubeGlass);
  shell.castShadow = false;
  shell.renderOrder = 3;
  const collarMaterial = mat(tubeColors[branch], 0.3);
  const ribMaterial = new THREE.MeshStandardMaterial({
    color: tubeColors[branch],
    transparent: true,
    opacity: 0.38,
    roughness: 0.3,
    depthWrite: false,
  });
  const count = Math.ceil(path.length / 0.48);
  ribMaterial.name = 'tube-ribs';
  for (let i = 0; i <= count; i++) {
    const distance = (i / count) * path.length;
    // Leave the shared Y chamber clear of solid rings.
    if (distance > path.length - 0.85) continue;
    const collar = i === 0 || i % 6 === 0;
    const r = ring(
      tunnelRadius + 0.018,
      collar ? 0.065 : 0.018,
      collar ? collarMaterial : ribMaterial
    );
    r.position.copy(curve.getPoint(i / count));
    r.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      curve.getTangent(i / count)
    );
    r.castShadow = collar;
    if (!collar) r.renderOrder = 4;
  }
  // A fine reflected streak makes the transparent wall legible against the cage.
  for (const side of [-1, 1]) {
    const points = path.points.map(
      (p) =>
        new THREE.Vector3(p.x + side * 0.39, p.y + tunnelRadius + 0.58, p.z)
    );
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: "#edffff",
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      })
    );
    line.renderOrder = 4;
    scene.add(line);
  }
}
// Small feet and saddles anchor the outdoor run to the display table.
for (const [branch, fraction] of [
  [0, 0.3],
  [0, 0.65],
  [1, 0.35],
  [2, 0.35],
  [2, 0.85],
]) {
  const p = tunnelPose(branch, tunnelPaths[branch].length * fraction);
  box(p.x, -1.08, p.z, 1.25, 0.16, 0.85, teal);
  rod([p.x, -1, p.z], [p.x, p.y - 0.05, p.z], 0.065, metal);
  const saddle = ring(tunnelRadius + 0.08, 0.04, teal);
  saddle.position.set(p.x, p.y + tunnelRadius, p.z);
  saddle.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new TunnelCurve(branch).getTangent(fraction)
  );
}


function createHamster(slot) {
// Anatomical hamster model: pear-shaped body, articulated legs, ears and whiskers.
const hamster = new THREE.Group();
scene.add(hamster);
const bodyRig = new THREE.Group();
hamster.add(bodyRig);
const fur = software ? new THREE.MeshLambertMaterial({ color: '#e5c7a0' }) : new THREE.MeshPhysicalMaterial({
    color: "#e5c7a0",
    roughness: 0.95,
    sheen: 0.85,
    sheenColor: "#f4dfbc",
    sheenRoughness: 0.9,
  }),
  furLight = fur.clone(),
  furDark = mat("#967044");
const furCanvas = document.createElement("canvas");
furCanvas.width = 1024;
furCanvas.height = 512;
const furCtx = furCanvas.getContext("2d");
const coatGradient = furCtx.createLinearGradient(0, 0, 0, 512);
coatGradient.addColorStop(0, "#b18b61");
coatGradient.addColorStop(0.38, "#c49a69");
coatGradient.addColorStop(0.65, "#d6b184");
coatGradient.addColorStop(1, "#f0e2c9");
furCtx.fillStyle = coatGradient;
furCtx.fillRect(0, 0, 1024, 512);
for (let i = 0; i < 65000; i++) {
  const x = Math.random() * 1024,
    y = Math.random() * 512;
  furCtx.strokeStyle = Math.random() > 0.5 ? "#f1d8a755" : "#704a2c35";
  furCtx.lineWidth = 0.5 + Math.random() * 0.6;
  furCtx.beginPath();
  furCtx.moveTo(x, y);
  furCtx.lineTo(x + Math.random() * 2 - 1, y + 2 + Math.random() * 5);
  furCtx.stroke();
}
const furTexture = new THREE.CanvasTexture(furCanvas);
furTexture.colorSpace = THREE.SRGBColorSpace;
fur.map = furTexture;
furLight.map = furTexture;
fur.bumpMap = furTexture;
fur.bumpScale = 0.018;
furLight.bumpMap = furTexture;
furLight.bumpScale = 0.012;
const bellyFur = fur.clone();
bellyFur.color.set("#fff5df");
// Embedded by esbuild so WebGL can use this texture even on file:// pages.
// Keep the procedural coat as a fallback until the image has decoded.
const underfurTexture = new THREE.TextureLoader().load(
  underfurSource,
  (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 1);
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    for (const material of [fur, furLight, bellyFur]) {
      material.map = texture;
      material.bumpMap = texture;
      material.bumpScale = 0.012;
      material.needsUpdate = true;
    }
    fur.color.set("#e8d5bf");
    furLight.color.set("#fff5e7");
    bellyFur.color.set("#ffffff");
  },
  undefined,
  () => {
    // The procedural coat remains available if the image fails to decode.
  }
);
ell(0, 0.58, 0.13, 0.49, 0.49, 0.73, fur, bodyRig);
ell(0, 0.43, -0.03, 0.415, 0.34, 0.63, bellyFur, bodyRig);
ell(0, 0.49, 0.65, 0.12, 0.12, 0.15, pink, bodyRig);
const head = new THREE.Group();
head.position.set(0, 0.65, -0.51);
bodyRig.add(head);
ell(0, 0, 0, 0.38, 0.35, 0.36, furLight, head);
const cheeks = [];
for (const side of [-1, 1]) {
  cheeks.push(
    ell(side * 0.225, -0.105, -0.135, 0.185, 0.17, 0.18, bellyFur, head)
  );
  ell(side * 0.25, 0.28, 0.03, 0.145, 0.155, 0.052, fur, head);
  ell(side * 0.25, 0.285, -0.027, 0.105, 0.115, 0.027, pink, head);
  // Soft fur sockets seat the eyes in the face; small catchlights keep them wet.
  ell(side * 0.264, 0.055, -0.233, 0.074, 0.081, 0.043, furLight, head);
  ell(side * 0.264, 0.055, -0.251, 0.061, 0.067, 0.039, black, head);
  ell(side * 0.252, 0.074, -0.285, 0.01, 0.012, 0.005, cream, head);
}
// A short split muzzle sits in front of the cheek pouches, with a tapered
// moist nose, a fine philtrum and a soft chin instead of a round button mouth.
const muzzlePads = [],
  whiskerFans = [];
for (const side of [-1, 1]) {
  const pad = ell(
    side * 0.082,
    -0.098,
    -0.335,
    0.106,
    0.077,
    0.082,
    bellyFur,
    head
  );
  muzzlePads.push(pad);
}
const noseMaterial = new THREE.MeshPhysicalMaterial({
  color: "#bb817e",
  roughness: 0.43,
  clearcoat: 0.25,
  clearcoatRoughness: 0.38,
});
const noseGeometry = new THREE.SphereGeometry(1, 32, 20);
const noseVertices = noseGeometry.attributes.position;
for (let i = 0; i < noseVertices.count; i++) {
  const x = noseVertices.getX(i),
    y = noseVertices.getY(i),
    z = noseVertices.getZ(i);
  noseVertices.setXYZ(
    i,
    x * 0.054 * (0.65 + y * 0.3),
    y * 0.032 - Math.exp(-x * x * 18) * Math.max(0, y) * 0.006,
    z * 0.026
  );
}
noseGeometry.computeVertexNormals();
const nose = mesh(noseGeometry, noseMaterial, head);
nose.position.set(0, -0.05, -0.411);
const lipMaterial = mat("#76504b", 0.9);
const nostrilMaterial = mat("#613e3b", 0.8);
for (const side of [-1, 1]) {
  const nostril = ell(
    side * 0.026,
    -0.05,
    -0.432,
    0.008,
    0.004,
    0.003,
    nostrilMaterial,
    head
  );
  nostril.rotation.z = side * -0.25;
}
function facialCurve(points, radius, material, parent = head, taper = false) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p))
  );
  const geometry = new THREE.TubeGeometry(curve, 20, radius, 5, false);
  if (taper) {
    const vertices = geometry.attributes.position;
    for (let i = 0; i <= 20; i++) {
      const center = curve.getPointAt(i / 20);
      const width = 1 - (i / 20) * 0.91;
      for (let j = 0; j <= 5; j++) {
        const k = i * 6 + j;
        vertices.setXYZ(
          k,
          center.x + (vertices.getX(k) - center.x) * width,
          center.y + (vertices.getY(k) - center.y) * width,
          center.z + (vertices.getZ(k) - center.z) * width
        );
      }
    }
    geometry.computeVertexNormals();
  }
  const strand = mesh(geometry, material, parent);
  strand.castShadow = false;
  return strand;
}
facialCurve(
  [
    [0, -0.077, -0.427],
    [0, -0.102, -0.413],
    [0, -0.128, -0.398],
  ],
  0.0022,
  lipMaterial
);
for (const side of [-1, 1])
  facialCurve(
    [
      [0, -0.128, -0.399],
      [side * 0.028, -0.141, -0.4],
      [side * 0.065, -0.133, -0.395],
    ],
    0.002,
    lipMaterial
  );
const mouth = ell(0, -0.139, -0.389, 0.031, 0.01, 0.018, lipMaterial, head);
const jaw = ell(0, -0.169, -0.327, 0.088, 0.048, 0.078, bellyFur, head);
const tongue = ell(0, -0.145, -0.378, 0.021, 0.01, 0.052, pink, head);
tongue.visible = false;
const whiskerMaterial = mat("#e3daca", 0.92);
const follicleMaterial = mat("#b5a08a", 1);
for (const side of [-1, 1]) {
  const fan = new THREE.Group();
  fan.position.set(side * 0.135, -0.095, -0.385);
  head.add(fan);
  whiskerFans.push(fan);
  for (let i = 0; i < 6; i++) {
    const spread = (i - 2.5) * 0.031;
    const length = 0.3 + (i % 3) * 0.042;
    facialCurve(
      [
        [0, spread * 0.28, 0],
        [side * length * 0.38, spread * 0.7 + 0.012, -0.037],
        [side * length * 0.75, spread * 1.35, -0.045 - i * 0.006],
        [side * length, spread * 1.85 - 0.025, -0.025 - i * 0.013],
      ],
      0.0026,
      whiskerMaterial,
      fan,
      true
    );
  }
  for (let i = 0; i < 3; i++)
    ell(
      side * (0.095 + i * 0.019),
      -0.09 + (i % 2) * 0.017,
      -0.414 + i * 0.008,
      0.003,
      0.0025,
      0.002,
      follicleMaterial,
      head
    );
}
const legs = [];
for (const z of [-0.36, 0.46])
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.32, 0.36, z);
    hamster.add(pivot);
    const limb = ell(0, -0.07, 0, 0.14, 0.2, 0.16, furLight, pivot);
    const paw = new THREE.Group();
    paw.position.set(0, -0.235, -0.055);
    pivot.add(paw);
    ell(0, 0, 0, 0.105, 0.075, 0.17, pink, paw);
    for (let i = 0; i < 3; i++)
      ell((i - 1) * 0.044, -0.01, -0.125, 0.013, 0.019, 0.036, cream, paw);
    pivot.userData = { limb, paw };
    legs.push(pivot);
  }
// Dense, individually shaded guard hairs follow the body instead of standing like spikes.
const hairMaterial = software ? new THREE.MeshLambertMaterial({ color: '#ffffff' }) : new THREE.MeshStandardMaterial({
  color: "#ffffff",
  roughness: 1,
});
const hairGeometry = new THREE.CylinderGeometry(0.0006, 0.0021, 1, 3, 1);
function coat(parent, center, radii, count, lengthScale = 1) {
  if (software) count = Math.max(90, Math.round(count * .25));
  const strands = new THREE.InstancedMesh(hairGeometry, hairMaterial, count);
  const normal = new THREE.Vector3(),
    direction = new THREE.Vector3();
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const u = Math.random() * Math.PI * 2,
      y = Math.random() * 2 - 1;
    const radial = Math.sqrt(1 - y * y);
    normal.set(radial * Math.cos(u), y, radial * Math.sin(u));
    const length = (0.025 + Math.random() * 0.04) * lengthScale;
    direction
      .copy(normal)
      .multiplyScalar(0.6)
      .add(new THREE.Vector3(0, -0.12, 0.55))
      .normalize();
    dummy.position.set(
      center[0] + normal.x * radii[0],
      center[1] + normal.y * radii[1],
      center[2] + normal.z * radii[2]
    );
    dummy.position.addScaledVector(direction, length * 0.35);
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    dummy.scale.set(1, length, 1);
    dummy.updateMatrix();
    strands.setMatrixAt(i, dummy.matrix);
    color.set(normal.y < -0.25 ? "#e5d6ba" : "#ad8053");
    color.lerp(new THREE.Color("#f1dbb7"), Math.random() * 0.65);
    strands.setColorAt(i, color);
  }
  parent.add(strands);
}
coat(bodyRig, [0, 0.58, 0.13], [0.49, 0.49, 0.73], 6000);
coat(head, [0, 0, 0], [0.38, 0.35, 0.36], 2200, 0.45);
for (const cheek of cheeks) coat(cheek, [0, 0, 0], [1, 1, 1], 650);
for (const pad of muzzlePads) coat(pad, [0, 0, 0], [1, 1, 1], 500);
coat(jaw, [0, 0, 0], [1, 1, 1], 300);
const pawDown = new THREE.Vector3(0, -1, 0);
const pawDirection = new THREE.Vector3();
const groundUp = new THREE.Vector3(),
  groundForward = new THREE.Vector3();
const groundRight = new THREE.Vector3(),
  groundBack = new THREE.Vector3();
const groundFrame = new THREE.Matrix4();
const smoothedGroundUp = new THREE.Vector3(0, 1, 0);
function animateHamster(dt, state) {
  const gait = state.gait;
  hamster.position.set(state.x, state.y, state.z);
  if (state.tube) {
    const frame = state.tubeFrame;
    hamster.quaternion.fromArray(frame.quaternion);
    // Keep the feet on the same tube floor throughout the local turn.
    hamster.position.x -= frame.up[0] * tunnelRadius;
    hamster.position.y += (1 - frame.up[1]) * tunnelRadius;
    hamster.position.z -= frame.up[2] * tunnelRadius;
  } else {
    const normal = state.wheelTransition
      ? {
          x: Math.sin(state.angle) * Math.sin(state.pitch),
          y: Math.cos(state.pitch),
          z: Math.cos(state.angle) * Math.sin(state.pitch),
        }
      : state.wheel || state.fallSpeed > 0
      ? { x: 0, y: 1, z: 0 }
      : surfaceNormal(state.x, state.z, state.y);
    groundUp.set(normal.x, normal.y, normal.z);
    // Smooth only the supporting normal: steering stays responsive while the
    // body eases into and out of a slope instead of snapping at its boundary.
    smoothedGroundUp
      .lerp(groundUp, state.mode === "paused" ? 0 : 1 - Math.exp(-dt * 9))
      .normalize();
    groundUp.copy(smoothedGroundUp);
    const sin = Math.sin(state.angle),
      cos = Math.cos(state.angle);
    // Preserve steering in the horizontal plane while placing both the length
    // and width of the body on the ramp (including sideways turns).
    groundForward
      .set(-sin, (groundUp.x * sin + groundUp.z * cos) / groundUp.y, -cos)
      .normalize();
    groundRight.crossVectors(groundForward, groundUp).normalize();
    groundBack.copy(groundForward).negate();
    groundFrame.makeBasis(groundRight, groundUp, groundBack);
    hamster.quaternion.setFromRotationMatrix(groundFrame);
  }
  // Curl only along the length; preserve the hamster's height and width.
  const curl = state.curl;
  bodyRig.scale.set(1, 1, 1 - curl * 0.38);
  head.position.set(0, 0.65, -0.51 + curl * 0.2);
  const moving =
    state.mode === "playing" ? Math.min(1, Math.abs(state.speed) / 2) : 0;
  const eating = state.mode === "playing" && state.eat > 0;
  const drinking = state.mode === "playing" && state.drink > 0;
  const breath = Math.sin(clock * 3) * 0.009;
  bodyRig.position.y =
    breath + (reduced ? 0 : Math.abs(Math.sin(gait * 2)) * 0.045 * moving);
  bodyRig.rotation.z = reduced ? 0 : Math.sin(gait) * 0.04 * moving;
  bodyRig.rotation.x = eating ? -0.1 + Math.sin(clock * 22) * 0.025 : 0;
  head.rotation.x = eating
    ? 0.16 + Math.sin(clock * 24) * 0.065
    : Math.sin(clock * 2) * 0.025;
  head.rotation.y = !moving && !drinking ? Math.sin(clock * 0.8) * 0.1 : 0;
  if (drinking) {
    bodyRig.rotation.x = 0.015;
    head.rotation.x = 0.12 + Math.sin(clock * 18) * 0.025;
  }
  const chew = eating ? (1 + Math.sin(clock * 28)) / 2 : 0;
  mouth.scale.y = 0.01 + chew * 0.026;
  jaw.position.y = -0.169 - chew * 0.027;
  jaw.position.x = eating ? Math.sin(clock * 14) * 0.008 : 0;
  for (let i = 0; i < muzzlePads.length; i++) {
    const side = i ? 1 : -1;
    muzzlePads[i].position.y = -0.098 + chew * 0.004;
    muzzlePads[i].scale.x = 0.106 + chew * 0.003;
    whiskerFans[i].rotation.y = reduced
      ? 0
      : side * (Math.sin(clock * 3.2) * 0.025 + chew * 0.04);
  }
  tongue.visible = drinking;
  tongue.scale.z = 0.03 + Math.max(0, Math.sin(clock * 24)) * 0.065;
  for (let i = 0; i < legs.length; i++) {
    const phase = gait + (i === 0 || i === 3 ? 0 : Math.PI);
    legs[i].rotation.x = Math.sin(phase) * 0.7 * moving;
    // Lift paws on the return stroke; reverse the cycle when backing up.
    legs[i].position.y = 0.36 + Math.max(0, Math.cos(phase)) * 0.09 * moving;
    legs[i].position.x = (i % 2 ? 1 : -1) * 0.32;
    legs[i].position.z = (i < 2 ? -0.36 : 0.46) * (1 - curl * 0.5);
    const { limb, paw } = legs[i].userData;
    paw.position.set(0, -0.235, -0.055);
    paw.rotation.set(0, 0, 0);
    limb.position.set(0, -0.07, 0);
    limb.rotation.set(0, 0, 0);
    limb.scale.set(0.14, 0.2, 0.16);
    let step;
    if (state.tube?.turn) {
      const t = Math.min(1, state.tube.turn.elapsed / 1.15);
      step = tunnelTurnPaw(i, t * t * (3 - 2 * t));
    } else if (state.standingTurn) {
      const turn = state.standingTurn;
      step = standingTurnPaw(i, turn.angle, turn.direction);
      const t = Math.min(1, turn.settle / 0.14);
      const settle = t * t * (3 - 2 * t);
      step.x = THREE.MathUtils.lerp(step.x, legs[i].position.x, settle);
      step.y = THREE.MathUtils.lerp(step.y, 0.125, settle);
      step.z = THREE.MathUtils.lerp(step.z, legs[i].position.z - 0.055, settle);
      step.yaw *= 1 - settle;
    }
    if (step) {
      // Paw contacts live in the same inclined frame as the body. Bend each
      // leg towards its planted paw while the hip continues around the turn.
      legs[i].rotation.x = 0;
      paw.position.set(
        step.x - legs[i].position.x,
        step.y - legs[i].position.y,
        step.z - legs[i].position.z
      );
      paw.rotation.y = step.yaw;
      const reach = paw.position.length();
      limb.position.copy(paw.position).multiplyScalar(0.42);
      limb.scale.y = reach * 0.6;
      limb.quaternion.setFromUnitVectors(
        pawDown,
        pawDirection.copy(paw.position).normalize()
      );
    } else if (eating && i < 2)
      legs[i].rotation.x = -1.1 + Math.sin(clock * 24) * 0.08;
  }
  for (const cheek of cheeks)
    cheek.scale.set(
      0.185 + state.pouch.length * 0.012 + chew * 0.006,
      0.17 + state.pouch.length * 0.007 - chew * 0.004,
      0.18
    );
}

const playerColor = mat(COLORS[slot]);
const collar = ring(.35, .04, playerColor, bodyRig);
collar.position.set(0, .59, -.41);
ell(-.12, 1.07, -.24, .14, .065, .09, playerColor, bodyRig);
ell(.12, 1.07, -.24, .14, .065, .09, playerColor, bodyRig);
ell(0, 1.085, -.24, .06, .065, .065, playerColor, bodyRig);
const halo = new THREE.Mesh(new THREE.RingGeometry(.59, .65, 40), new THREE.MeshBasicMaterial({ color: COLORS[slot], transparent: true, opacity: .65, side: THREE.DoubleSide, depthWrite: false }));
halo.rotation.x = -Math.PI / 2; halo.position.y = .018; hamster.add(halo);
if (software) {
  const contact = new THREE.Mesh(new THREE.CircleGeometry(.49, 32), new THREE.MeshBasicMaterial({ color: '#403323', transparent: true, opacity: .2, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = .008; contact.scale.y = 1.4; hamster.add(contact);
}
const labelCanvas = document.createElement('canvas'); labelCanvas.width = 512; labelCanvas.height = 96;
const labelTexture = new THREE.CanvasTexture(labelCanvas);
labelTexture.colorSpace = THREE.SRGBColorSpace;
const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, depthTest: false, transparent: true, toneMapped: false }));
label.position.set(0, 1.55, 0); label.scale.set(2.25, .42, 1); hamster.add(label);
let savedName = '';
function setName(name, own) {
  const text = `${own ? 'YOU · ' : ''}${name}`;
  if (savedName === text) return; savedName = text;
  const ctx = labelCanvas.getContext('2d'); ctx.font = 'bold 35px system-ui, sans-serif';
  const width = Math.min(512, Math.max(156, Math.ceil(ctx.measureText(text).width + 50)));
  labelCanvas.width = width; label.scale.set(width / 512 * 2.25, .42, 1);
  ctx.fillStyle = '#102c30dd'; ctx.beginPath(); ctx.roundRect(8, 5, width - 16, 84, 24); ctx.fill();
  ctx.strokeStyle = COLORS[slot]; ctx.lineWidth = 4; ctx.stroke();
  ctx.font = 'bold 35px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff7e4';
  ctx.fillText(text, width / 2, 48, width - 40); labelTexture.needsUpdate = true;
}
// The body casts a soft shadow; submillimeter facial details need no shadow pass.
hamster.traverse(part => {
  if (part.isMesh) part.castShadow = part.geometry === sphereGeo && part.scale.x > .25 && part.scale.y > .25;
});
const movingParts = new Set([...cheeks, ...muzzlePads, jaw, mouth, tongue, ...legs.map(leg => leg.userData.limb)]);
mergeStaticMeshes(hamster, movingParts);
batchStaticMeshes(hamster, movingParts);
return { root: hamster, animate: animateHamster, setName, halo };
}
// Procedural food surfaces: striped husks, root scars and dense broccoli buds.
function foodTexture(kind) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = kind === "seed" ? "#3c3229" : "#c87531";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    const x = Math.random() * 256,
      y = Math.random() * 256;
    ctx.strokeStyle = kind === "seed" ? "#dacaa068" : "#73361645";
    ctx.lineWidth = kind === "seed" ? 1 + Math.random() * 3 : 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
      x + (kind === "seed" ? 1 : 4 + Math.random() * 18),
      y + (kind === "seed" ? 12 + Math.random() * 60 : Math.random() * 2)
    );
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
const seedMaterial = mat("#ffffff", 0.8);
seedMaterial.map = foodTexture("seed");
seedMaterial.bumpMap = seedMaterial.map;
seedMaterial.bumpScale = 0.009;
const carrotMaterial = mat("#ffc789", 0.83);
carrotMaterial.map = foodTexture("carrot");
carrotMaterial.bumpMap = carrotMaterial.map;
carrotMaterial.bumpScale = 0.01;
const leafMat = mat("#456c2c");
const stalkMat = mat("#91ac58");
const budMaterial = mat("#ffffff", 0.95);
function makeFood(type) {
  const group = new THREE.Group();
  if (type === 0) {
    const profile = [
      new THREE.Vector2(0, -0.28),
      new THREE.Vector2(0.055, -0.22),
      new THREE.Vector2(0.115, -0.06),
      new THREE.Vector2(0.105, 0.12),
      new THREE.Vector2(0.05, 0.23),
      new THREE.Vector2(0, 0.27),
    ];
    const seed = mesh(
      new THREE.LatheGeometry(profile, 24),
      seedMaterial,
      group
    );
    seed.rotation.x = Math.PI / 2;
    seed.scale.z = 0.57;
    seed.position.y = 0.1;
    rod([0, 0.13, -0.23], [0, 0.15, 0.22], 0.006, cream, group);
  } else if (type === 1) {
    const root = new THREE.Group();
    group.add(root);
    root.position.set(0, 0.19, 0);
    root.rotation.z = -1.3;
    const profile = [
      new THREE.Vector2(0.005, -0.36),
      new THREE.Vector2(0.04, -0.23),
      new THREE.Vector2(0.1, 0.02),
      new THREE.Vector2(0.15, 0.2),
      new THREE.Vector2(0.13, 0.29),
      new THREE.Vector2(0, 0.31),
    ];
    mesh(new THREE.LatheGeometry(profile, 28), carrotMaterial, root);
    for (let j = 0; j < 6; j++) {
      const a = j * 2.4;
      const tip = [
        Math.sin(a) * 0.18,
        0.48 + (j % 2) * 0.12,
        Math.cos(a) * 0.13,
      ];
      rod([0, 0.29, 0], tip, 0.01, leafMat, root);
      for (let k = 0; k < 4; k++) {
        const t = 0.45 + k * 0.14;
        const leaf = ell(
          tip[0] * t,
          0.29 + (tip[1] - 0.29) * t,
          tip[2] * t,
          0.075,
          0.018,
          0.025,
          leafMat,
          root
        );
        leaf.rotation.z = a + k;
      }
    }
    rod([0, -0.34, 0], [0.025, -0.43, 0.025], 0.005, carrotMaterial, root);
  } else if (type === 2) {
    rod([0, 0.02, 0], [0, 0.26, 0], 0.065, stalkMat, group);
    const buds = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 7, 5),
      budMaterial,
      240
    );
    for (let j = 0; j < 6; j++) {
      const a = j * 2.4,
        cx = Math.sin(a) * 0.13,
        cz = Math.cos(a) * 0.13,
        cy = 0.3 + (j % 2) * 0.07;
      rod([0, 0.16, 0], [cx, cy, cz], 0.03, stalkMat, group);
      for (let k = 0; k < 40; k++) {
        const u = Math.random() * Math.PI * 2,
          h = Math.random(),
          r = Math.sqrt(1 - h * h);
        dummy.position.set(
          cx + Math.cos(u) * r * 0.115,
          cy + h * 0.1,
          cz + Math.sin(u) * r * 0.115
        );
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0.022 + Math.random() * 0.012);
        dummy.updateMatrix();
        buds.setMatrixAt(j * 40 + k, dummy.matrix);
        buds.setColorAt(
          j * 40 + k,
          new THREE.Color().setHSL(
            0.25 + Math.random() * 0.04,
            0.35 + Math.random() * 0.2,
            0.2 + Math.random() * 0.13
          )
        );
      }
    }
    buds.castShadow = true;
    group.add(buds);
  } else {
    const golden = mat('#ffdf83', .25, .35); golden.emissive.set('#b77326'); golden.emissiveIntensity = .35;
    const berry = ell(0, .28, 0, .22, .25, .22, golden, group);
    const crown = new THREE.Mesh(new THREE.OctahedronGeometry(.13), mat('#fff6ce', .2, .2));
    crown.position.y = .62; group.add(crown);
    const glow = new THREE.Mesh(new THREE.RingGeometry(.28, .39, 32), new THREE.MeshBasicMaterial({ color: '#ffd979', opacity: .5, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = .035; group.add(glow);
  }
  return group;
}
function updateCamera(dt, state) {
  let pos, target;
  const atHouse =
    state.mode !== "menu" &&
    state.y < house.y &&
    state.x > house.x1 &&
    state.x < house.x2 &&
    state.z > house.z1 &&
    state.z < house.z2 + 0.7;
  for (const material of houseCutaway) {
    material.opacity = THREE.MathUtils.damp(
      material.opacity,
      atHouse ? 0.06 : 1,
      7,
      dt
    );
    material.depthWrite = material.opacity > 0.98;
  }
  if (state.mode === "menu") {
    const a = Math.sin(clock * 0.1) * 0.07;
    pos = new THREE.Vector3(23 + a, 16, 27);
    target = new THREE.Vector3(3, 2, 0);
  } else if (state.tube) {
    // Stable outside view: the tube and the curled turn remain visible together.
    pos = new THREE.Vector3(
      state.x + (farCamera ? 7 : 4.6),
      state.y + (farCamera ? 4.5 : 3),
      state.z + 4.3
    );
    target = new THREE.Vector3(state.x, state.y + 0.6, state.z);
  } else if (atHouse) {
    pos = new THREE.Vector3(-1, 3.3, -1.5);
    target = new THREE.Vector3(state.x, 0.55, state.z);
  } else if (nearWater(state)) {
    // A gentle side view makes the mouth/nozzle contact and lapping visible.
    pos = new THREE.Vector3(7.6, 1.9, 8.6);
    target = new THREE.Vector3(8.45, 0.8, 5.8);
  } else if (state.wheel || state.wheelTransition) {
    pos = new THREE.Vector3(9, 4.5, 8);
    target = new THREE.Vector3(6, 1.5, 1.5);
  } else {
    const distance = farCamera ? 7 : 4.8;
    pos = new THREE.Vector3(
      state.x + Math.sin(state.angle) * distance,
      state.y + (farCamera ? 4 : 2.7),
      state.z + Math.cos(state.angle) * distance
    );
    pos.x = THREE.MathUtils.clamp(pos.x, -10.8, 10.8);
    pos.z = THREE.MathUtils.clamp(pos.z, -8.8, 8.8);
    target = new THREE.Vector3(
      state.x - Math.sin(state.angle) * 1.3,
      state.y + 0.65,
      state.z - Math.cos(state.angle) * 1.3
    );
    // Lift the camera over platforms when a following shot would intersect timber.
    for (const d of decks)
      if (
        pos.x > d.x1 - 0.2 &&
        pos.x < d.x2 + 0.2 &&
        pos.z > d.z1 - 0.2 &&
        pos.z < d.z2 + 0.2 &&
        pos.y > d.y - 0.7
      )
        pos.y = Math.max(pos.y, d.y + 0.8);
  }
  const smooth = 1 - Math.exp(-dt * 5);
  camera.position.lerp(pos, smooth);
  look.lerp(target, smooth);
  camera.lookAt(look);
  for (const b of bars) {
    const near = b.position.distanceTo(camera.position);
    b.material.opacity = near < 5 ? 0.08 : 0.5;
  }
}
function drawMap(players, slot, foods) {
  const c = mapCtx;
  c.clearRect(0, 0, 180, 148);
  const mapScale = 5.2;
  const mx = (x) => 68 + x * mapScale,
    mz = (z) => 74 + z * mapScale;
  c.fillStyle = "#172f38";
  c.strokeStyle = "#688f95";
  c.lineWidth = 1;
  c.fillRect(mx(-11), mz(-9), 22 * mapScale, 18 * mapScale);
  c.strokeRect(mx(-11), mz(-9), 22 * mapScale, 18 * mapScale);
  for (const d of decks) {
    c.fillStyle = d.y === 3 ? "#3b6764" : "#66877a";
    c.fillRect(
      mx(d.x1),
      mz(d.z1),
      (d.x2 - d.x1) * mapScale,
      (d.z2 - d.z1) * mapScale
    );
  }
  for (const r of ramps) {
    c.fillStyle = "#b79c65";
    c.fillRect(
      mx(r.x1),
      mz(r.z1),
      (r.x2 - r.x1) * mapScale,
      (r.z2 - r.z1) * mapScale
    );
  }
  tunnelPaths.forEach((path, branch) => {
    c.strokeStyle = tubeColors[branch];
    c.lineWidth = 3;
    c.beginPath();
    path.points.forEach((p, i) =>
      i ? c.lineTo(mx(p.x), mz(p.z)) : c.moveTo(mx(p.x), mz(p.z))
    );
    c.stroke();
    c.fillStyle = tubeColors[branch];
    c.beginPath();
    c.arc(mx(path.points[0].x), mz(path.points[0].z), 3, 0, Math.PI * 2);
    c.fill();
  });
  c.lineWidth = 1;
  c.fillStyle = "#83d9f4";
  c.fillRect(mx(waterSpout.x) - 2, mz(waterSpout.z) - 3, 4, 6);
  c.strokeStyle = "#63e6e2";
  c.beginPath();
  c.arc(mx(6), mz(1.5), 2.1 * mapScale, 0, Math.PI * 2);
  c.stroke();
  for (const f of foods) {
    c.fillStyle = f.type === 3 ? '#ffdf83' : f.y < 1 ? '#f5cd79' : f.y < 4 ? '#a7edcf' : '#ffffff';
    c.beginPath(); c.arc(mx(f.x), mz(f.z), f.type === 3 ? 3 : 1.7, 0, Math.PI * 2); c.fill();
  }
  players.forEach((p, i) => {
    c.save(); c.translate(mx(p.x), mz(p.z)); c.rotate(-p.angle);
    c.fillStyle = COLORS[i]; c.strokeStyle = '#102c30'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, i === slot ? -6 : -4); c.lineTo(4, 4); c.lineTo(0, 2); c.lineTo(-4, 4); c.closePath(); c.fill(); c.stroke();
    if (i === slot) { c.strokeStyle = '#fff7e4'; c.beginPath(); c.arc(0, 0, 7, 0, Math.PI * 2); c.stroke(); }
    c.restore();
  });
}

const mapCtx = map.getContext('2d');
batchStaticMeshes(scene, new Set([...bars, ...waterDrops]));
const models = Array.from({ length: 4 }, (_, slot) => createHamster(slot));
const templates = [0, 1, 2, 3].map(makeFood), foodMeshes = new Map();
camera.position.set(16, 12.5, 21); look.set(0, 2, 0);
let lastId = null;
function resize() {
  const w = Math.max(1, canvas.parentElement.clientWidth), h = Math.max(1, canvas.parentElement.clientHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, software ? Math.min(1, 400 / w) : 1.4));
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
const observer = new ResizeObserver(resize); observer.observe(canvas.parentElement);
let warmed = null;
return {
  resize,
  warmup() {
    return warmed ??= (async () => {
      camera.lookAt(look); renderer.setSize(1, 1, false);
      scene.add(...templates);
      await renderer.compileAsync(scene, camera);
      renderer.render(scene, camera);
      templates.forEach(template => scene.remove(template));
    })();
  },
  camera() { farCamera = !farCamera; },
  draw(players, slot, names, state, dt) {
    clock = state.tick / 60;
    if (state.id !== lastId) { lastId = state.id; camera.position.set(players[slot].x + 5, players[slot].y + 5, players[slot].z + 7); look.set(players[slot].x, players[slot].y + .6, players[slot].z); }
    models.forEach((model, i) => {
      model.root.visible = i < players.length;
      if (!model.root.visible) return;
      model.setName(names[i], i === slot);
      model.animate(dt, { ...players[i], mode: state.phase === 'paused' ? 'paused' : state.phase === 'playing' ? 'playing' : 'ended' });
      model.halo.material.opacity = players[i].shield ? .9 : i === slot ? .7 : .35;
      model.halo.scale.setScalar(players[i].shield && !reduced ? 1 + Math.sin(clock * 12) * .08 : 1);
    });
    const ids = new Set(state.foods.map(f => f.id));
    for (const [id, mesh] of foodMeshes) if (!ids.has(id)) { scene.remove(mesh); foodMeshes.delete(id); }
    for (const food of state.foods) {
      let mesh = foodMeshes.get(food.id);
      if (!mesh) { mesh = templates[food.type].clone(true); foodMeshes.set(food.id, mesh); scene.add(mesh); }
      mesh.position.set(food.x, food.y + .03 + (food.type === 3 && !reduced ? Math.sin(clock * 3 + food.id) * .06 : 0), food.z);
      mesh.rotation.y = food.type === 3 && !reduced ? clock + food.id : food.id * 2.4;
      mesh.visible = food.readyAt <= state.tick;
    }
    const active = players.find(p => p.wheel);
    if (state.phase === 'playing' && active) wheelRotor.rotation.z += dt * active.speed / 2.05;
    const drinking = players.some(p => p.drink > 0);
    waterDrops.forEach((drop, i) => {
      drop.visible = drinking;
      const t = (clock * 2 + i / waterDrops.length) % 1;
      drop.position.set(waterSpout.x - .035, waterSpout.y - .05 - t * .4, waterSpout.z + Math.sin(i * 2) * .025); drop.scale.setScalar(.018 * (1 - t));
    });
    updateCamera(dt, { ...players[slot], mode: state.phase });
    drawMap(players, slot, state.foods); renderer.render(scene, camera);
  },
  dispose() { observer.disconnect(); renderer.dispose(); },
};
}
