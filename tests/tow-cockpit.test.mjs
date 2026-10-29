import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { driverProgress } from '../games/tow-drivers-seat/progress.mjs';
import { createRace, rankRace } from '../games/tow/race.mjs';
import { COLLECTION_GAMES } from '../games/registry.mjs';

test('cockpit progress follows host positions and resets, reserving 100% for a complete trailer finish', () => {
  const state = createRace(1234, 'progress', 4), { track } = state;
  state.progress = [track.start - 200, track.start + (track.finish - track.start) * .5, track.finish + 40, track.start];
  assert.equal(driverProgress(state, track, 0).fraction, 0);
  assert.ok(Math.abs(driverProgress(state, track, 1).fraction - .5) < 1e-10);
  assert.equal(driverProgress(state, track, 2).fraction, .99);
  state.finished[3] = 80;
  assert.deepEqual(driverProgress(state, track, 3), { slot:3, finished:true, fraction:1 });
  assert.equal(rankRace(state)[0], 3);
  state.progress[1] = track.start;
  assert.equal(driverProgress(state, track, 1).fraction, 0);
});

test('Driver’s Seat is unlisted with noindex metadata, and its complete module graph is versioned', async () => {
  const root = new URL('../', import.meta.url);
  assert.ok(!COLLECTION_GAMES.some(game => game.href?.includes('tow-drivers-seat')));
  const [entry, catalog, collection] = await Promise.all(['games/tow-drivers-seat/index.html', '../games/index.html', 'index.html'].map(path => readFile(new URL(path, root), 'utf8')));
  assert.match(entry, /name="robots" content="noindex, nofollow, noarchive"/);
  assert.match(entry, /canonical.*https:\/\/mod-it.games\/multiplayer\/games\/tow-drivers-seat\//);
  assert.doesNotMatch(catalog, /tow-drivers-seat/); assert.doesNotMatch(collection, /tow-drivers-seat/);
  const files = (await readdir(root, { recursive:true })).filter(path => path.endsWith('.mjs') && !path.startsWith('tests/') && !path.startsWith('node_modules/')).map(path => `./${path}`).sort();
  const config = JSON.parse(await readFile(new URL('config.json', root), 'utf8'));
  assert.deepEqual([...config.modules].sort(), files);
});

test('the eye and steering wheel share the left seat, with the car centre to their right at every heading', async () => {
  const THREE = await import('../games/hamster/vendor/three.mjs');
  const { DRIVER_EYE, STEERING_CENTRE, positionDriverCamera } = await import('../games/tow-drivers-seat/view-geometry.mjs');
  assert.equal(DRIVER_EYE.x, STEERING_CENTRE.x); assert.ok(DRIVER_EYE.x < -.4);
  for (const heading of [0, .7, -1.5, Math.PI]) {
    const car = new THREE.Matrix4().makeRotationY(heading).setPosition(41, 0, -130);
    const camera = new THREE.PerspectiveCamera(); positionDriverCamera(camera, car, 16/9);
    assert.ok(camera.position.clone().applyMatrix4(car.clone().invert()).distanceTo(DRIVER_EYE) < 1e-12);
    const wheel = STEERING_CENTRE.clone().applyMatrix4(car).project(camera);
    const centre = new THREE.Vector3(0, STEERING_CENTRE.y, STEERING_CENTRE.z).applyMatrix4(car).project(camera);
    assert.ok(centre.x > wheel.x + .5, 'steering is left of the centre console, not centred across both seats');
  }
});

test('mirror rays obey equal incidence angles from the seated eye, including every edge of the glass', async () => {
  const { DRIVER_EYE, makeMirrorFrame, reflectPoint } = await import('../games/tow-drivers-seat/view-geometry.mjs');
  const mirror = makeMirrorFrame(), virtualEye = reflectPoint(DRIVER_EYE, mirror.centre, mirror.normal);
  const eyeDistance = DRIVER_EYE.clone().sub(mirror.centre).dot(mirror.normal);
  assert.ok(eyeDistance > 0);
  assert.ok(Math.abs(virtualEye.clone().sub(mirror.centre).dot(mirror.normal) + eyeDistance) < 1e-12);
  for (const p of [mirror.centre, mirror.topLeft, mirror.topRight, mirror.bottomLeft, mirror.bottomRight]) {
    const incident = p.clone().sub(DRIVER_EYE).normalize();
    const reflected = incident.clone().addScaledVector(mirror.normal, -2 * incident.dot(mirror.normal));
    assert.ok(reflected.distanceTo(p.clone().sub(virtualEye).normalize()) < 1e-12);
  }
});

test('the reflected camera crops exactly to the physical mirror, without a second arbitrary field of view', async () => {
  const THREE = await import('../games/hamster/vendor/three.mjs');
  const { DRIVER_EYE, makeMirrorFrame, positionMirrorCamera } = await import('../games/tow-drivers-seat/view-geometry.mjs');
  const mirror = makeMirrorFrame();
  for (const heading of [0, .8, -2]) {
    const car = new THREE.Matrix4().makeRotationY(heading).setPosition(-30, 0, 80), camera = new THREE.PerspectiveCamera();
    positionMirrorCamera(camera, DRIVER_EYE.clone().applyMatrix4(car), mirror, car);
    for (const [corner,x,y] of [['bottomRight',-1,-1],['bottomLeft',1,-1],['topRight',-1,1],['topLeft',1,1]]) {
      const ndc = mirror[corner].clone().applyMatrix4(car).project(camera);
      assert.ok(Math.abs(ndc.x-x)<1e-10 && Math.abs(ndc.y-y)<1e-10, `${corner} matches the reflected aperture`);
    }
    assert.ok(camera.near > .7 && camera.near < 1.1, 'near plane clips at the mirror, not at the virtual eye');
  }
});

test('straight trailer sight lines reveal the left flank and wheel while the car occludes the coupling and front centre', async () => {
  const THREE = await import('../games/hamster/vendor/three.mjs');
  const { DRIVER_EYE, makeMirrorFrame, positionMirrorCamera } = await import('../games/tow-drivers-seat/view-geometry.mjs');
  const camera = new THREE.PerspectiveCamera(); positionMirrorCamera(camera, DRIVER_EYE, makeMirrorFrame(), new THREE.Matrix4());
  const body = new THREE.Box3(new THREE.Vector3(-.85,.21,-1.6),new THREE.Vector3(.85,.91,1.6));
  const cabin = new THREE.Box3(new THREE.Vector3(-.735,.86,-.585),new THREE.Vector3(.735,1.52,.945));
  const roof = new THREE.Box3(new THREE.Vector3(-.8,1.48,-.63),new THREE.Vector3(.8,1.62,1.07));
  const occluded = point => {
    const ray = new THREE.Ray(camera.position.clone(),point.clone().sub(camera.position).normalize());
    return [body,cabin,roof].some(box => {
      const hit=ray.intersectBox(box,new THREE.Vector3()); return hit && hit.distanceTo(camera.position)<point.distanceTo(camera.position);
    });
  };
  for (const p of [new THREE.Vector3(-.8,.83,4.8),new THREE.Vector3(-.95,.39,5.1)]) {
    const ndc=p.clone().project(camera);assert.ok(Math.abs(ndc.x)<1 && Math.abs(ndc.y)<1);assert.ok(!occluded(p));
  }
  for (const p of [new THREE.Vector3(0,.37,2.25),new THREE.Vector3(0,.83,3.25)]) assert.ok(occluded(p));
});
