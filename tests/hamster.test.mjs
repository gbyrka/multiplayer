import test from 'node:test';
import assert from 'node:assert/strict';
import { createArena, advanceArena, resolveHamsters, snapshot, validSnapshot, acceptInput, COUNTDOWN_TICKS, ROUND_TICKS, winners, rankArena } from '../games/hamster/game-core.mjs';
import { STEP, INPUT, makeHamster, stepHamster, nearWater } from '../games/hamster/physics.mjs';
import { foodSpot, ramps, rampHeight, floorAt, inside, decks, house, obstacles } from '../games/hamster/world.mjs';
import { tunnelPose, tunnelPaths } from '../games/hamster/tunnel.mjs';
import { Prediction } from '../games/hamster/prediction.mjs';
import { HamsterSession } from '../games/hamster/session.mjs';
import { RequestCache, message } from '../shared/protocol.mjs';
import { mergeStaticMeshes, batchStaticMeshes } from '../games/hamster/static-batches.mjs';
import { Group, Mesh, SphereGeometry, BoxGeometry, MeshStandardMaterial, Vector3, TorusGeometry } from '../games/hamster/vendor/three.mjs';
import { readFile, readdir } from 'node:fs/promises';

const active = (count = 2) => { const arena = createArena(1777, 'PICNIC', count); arena.tick = COUNTDOWN_TICKS; arena.phase = 'playing'; return arena; };
const steps = (arena, count, masks = []) => { for (let i = 0; i < count; i++) advanceArena(arena, masks); };
function sessionFixture(t, options = {}) {
  const documentBefore = globalThis.document;
  globalThis.document = { addEventListener() {}, removeEventListener() {}, hidden: false };
  const views = [];
  const session = new HamsterSession({ Peer: null, version: 'hamster1', onLobby: value => views.push(value), onSnapshot: value => views.push(value), onStatus() {}, onEnded() {}, ...options });
  session.network = { send: () => true, destroy() {}, drop() {} };
  t.after(() => { session.close(); globalThis.document = documentBefore; });
  return { session, views };
}

test('2–4 players share seeded accessible food, three levels and a three-second countdown', () => {
  for (const count of [2, 3, 4]) {
    const a = createArena(42, 'A', count), b = createArena(42, 'A', count);
    assert.deepEqual(a, b); assert.equal(a.foods.length, 8 + (count - 2) * 2);
    assert.deepEqual([...new Set(a.foods.map(f => f.y))].sort(), [0, 3, 6]);
    const before = structuredClone(a.hamsters);
    steps(a, COUNTDOWN_TICKS - 1, [INPUT.UP]); assert.deepEqual(a.hamsters, before);
    advanceArena(a, []); assert.equal(a.phase, 'playing'); assert.ok(validSnapshot(snapshot(a)));
  }
  for (const count of [1, 5, 2.5, NaN]) assert.throws(() => createArena(1, 'A', count));
});
test('running drains energy, Shift restores it, and original ramps and gravity remain walkable', () => {
  const p = makeHamster(0); p.x = 0; p.z = 5;
  for (let i = 0; i < 60; i++) stepHamster(p, INPUT.UP);
  assert.ok(p.z < 1.5 && p.energy < 82);
  const energy = p.energy;
  for (let i = 0; i < 60; i++) stepHamster(p, INPUT.UP | INPUT.WALK);
  assert.ok(p.energy > energy);
  for (const ramp of ramps) {
    const hamster = makeHamster(0), alongX = ramp.axis === 'x';
    hamster.x = alongX ? ramp.x1 + .1 : (ramp.x1 + ramp.x2) / 2;
    hamster.z = alongX ? (ramp.z1 + ramp.z2) / 2 : ramp.z2 - .1;
    hamster.y = rampHeight(ramp, hamster.x, hamster.z);
    hamster.angle = alongX ? -Math.PI / 2 : 0;
    for (let i = 0; i < 190; i++) stepHamster(hamster, INPUT.UP | INPUT.WALK);
    assert.ok(hamster.y >= ramp.high - .01, 'ascends the original ramp');
  }
  p.x = 1; p.z = 3; p.y = 6;
  for (let i = 0; i < 90; i++) stepHamster(p, 0);
  assert.equal(p.y, 0);
});
test('collection is shared and exclusive, with five slots and no points until eating', () => {
  const arena = active(); arena.foods = [{ id: 1, x: 0, z: 2, y: 0, type: 2, level: 0, expires: 0, readyAt: 0 }];
  arena.hamsters.forEach(p => { p.x = 0; p.z = 2; });
  // Isolate collection from physical separation by putting bodies just within collection range.
  arena.hamsters[0].x = -.55; arena.hamsters[1].x = .55;
  advanceArena(arena, []);
  assert.equal(arena.hamsters.reduce((sum, p) => sum + p.pouch.length, 0), 1);
  assert.ok(arena.hamsters.every(p => p.score === 0));
  assert.ok(Math.hypot(arena.foods[0].x, arena.foods[0].z - 2) > .8, 'shared treat respawned');
  arena.hamsters[0].pouch = [0, 1, 2, 0, 1];
  arena.foods[0].x = arena.hamsters[0].x; arena.foods[0].z = arena.hamsters[0].z;
  arena.foods[0].readyAt = 0; advanceArena(arena, []); assert.equal(arena.hamsters[0].pouch.length, 5);
});
test('holding Space eats the entire pouch after .85 seconds; early release cancels', () => {
  const arena = active(), p = arena.hamsters[0]; p.pouch = [0, 1, 2, 3, 1]; p.energy = 10;
  steps(arena, 30, [INPUT.EAT]); assert.equal(p.score, 0); assert.equal(p.pouch.length, 5);
  steps(arena, 1, [0]); assert.equal(p.eat, 0);
  steps(arena, 52, [INPUT.EAT]); assert.equal(p.score, 130); assert.equal(p.eaten, 5); assert.equal(p.pouch.length, 0); assert.ok(p.energy > 70);
  steps(arena, 60, [INPUT.EAT]); assert.equal(p.score, 130, 'held eating cannot duplicate points');
});
test('drinking takes priority over pouch eating and has an interruptible sip and cooldown', () => {
  const p = makeHamster(0); Object.assign(p, { x: 7.8, z: 5.8, angle: -Math.PI / 2, energy: 50, pouch: [2] });
  assert.ok(nearWater(p));
  for (let i = 0; i < 30; i++) stepHamster(p, INPUT.EAT);
  stepHamster(p, 0); assert.equal(p.drink, 0); assert.equal(p.score, 0);
  for (let i = 0; i < 74; i++) stepHamster(p, INPUT.EAT);
  assert.equal(p.score, 2); assert.deepEqual(p.pouch, [2]); assert.ok(p.drinkCooldown > 4.9);
  for (let i = 0; i < 120; i++) stepHamster(p, INPUT.EAT);
  assert.equal(p.score, 2); assert.deepEqual(p.pouch, [2]);
});
test('ordinary contact separates bodies without spilling food or crossing different levels', () => {
  const arena = active(), [a, b] = arena.hamsters;
  Object.assign(a, { x: 0, z: 2, pouch: [1], score: 120 }); Object.assign(b, { x: .1, z: 2, pouch: [2], score: 110 });
  resolveHamsters(arena); assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > .9);
  assert.deepEqual(a.pouch, [1]); assert.deepEqual(b.pouch, [2]); assert.equal(a.score, 120);
  a.x = b.x = 0; a.z = b.z = 2; b.y = 3; resolveHamsters(arena); assert.equal(a.x, b.x);
});
test('a frontal dash spills exactly one unbanked treat, pushes, and grants protection', () => {
  const arena = active(), [a, b] = arena.hamsters;
  Object.assign(a, { x: 0, z: 3, angle: 0, dash: .3, pouch: [0], score: 70 });
  Object.assign(b, { x: 0, z: 2, angle: 0, pouch: [0, 1, 2], score: 100 });
  const foods = arena.foods.length; resolveHamsters(arena);
  assert.deepEqual(b.pouch, [0, 1]); assert.equal(b.score, 100); assert.equal(a.score, 70); assert.equal(a.bumpCount, 1);
  assert.equal(arena.foods.length, foods + 1); assert.equal(arena.foods.at(-1).type, 2); assert.equal(b.shield, 2); assert.ok(b.bumpZ < 0);
  a.x = b.x; a.z = b.z + .6; a.dash = .3; resolveHamsters(arena); assert.equal(b.pouch.length, 2);
  b.shield = 0; a.x = b.x; a.z = b.z + .6; a.angle = Math.PI; a.dash = .3;
  resolveHamsters(arena); assert.equal(b.pouch.length, 2, 'a backward-facing contact cannot steal');
});
test('dash costs energy, expires quickly, needs a fresh press and a four-second cooldown', () => {
  const p = makeHamster(0); p.x = 0;
  stepHamster(p, INPUT.DASH); assert.ok(p.dash > 0); assert.ok(p.energy < 89);
  for (let i = 0; i < 300; i++) stepHamster(p, INPUT.DASH);
  assert.equal(p.dash, 0, 'holding Q never repeatedly dashes');
  stepHamster(p, 0); stepHamster(p, INPUT.DASH); assert.ok(p.dash > 0);
  p.energy = 0; p.dash = p.dashCooldown = p.lastMask = 0; stepHamster(p, INPUT.DASH); assert.equal(p.dash, 0);
});
test('six golden treats rotate levels every 30 seconds and expire after ten seconds', () => {
  const arena = active();
  for (const level of [0, 1, 2]) {
    arena.tick = COUNTDOWN_TICKS + (arena.bloom + 1) * 1800 - 1;
    advanceArena(arena, []);
    const gold = arena.foods.filter(f => f.type === 3);
    assert.equal(gold.length, 6); assert.ok(gold.every(f => f.level === level && f.y === level * 3));
    assert.ok(validSnapshot(snapshot(arena))); steps(arena, 600); assert.equal(arena.foods.filter(f => f.type === 3).length, 0);
  }
});
test('wheel approach is animated, has one occupant, recharges, and gives three point bonuses without extending time', () => {
  const arena = active(), [a, b] = arena.hamsters;
  Object.assign(a, { x: 6, z: 4.3, angle: 0, energy: 10 }); Object.assign(b, { x: 6, z: 4.3, angle: 0 });
  advanceArena(arena, [INPUT.WHEEL, INPUT.WHEEL]); assert.ok(a.wheelTransition); assert.equal(b.wheelTransition, null);
  assert.ok(arena.events.some(e => e.type === 'wheel-busy' && e.slot === 1));
  steps(arena, 400); assert.ok(a.wheel); assert.equal(a.wheelTransition, null);
  const before = arena.tick; steps(arena, 1200, [INPUT.UP]); assert.equal(a.bonuses, 3); assert.equal(a.score, 30); assert.equal(a.energy, 100);
  assert.equal(arena.tick - before, 1200); advanceArena(arena, [INPUT.WHEEL]); steps(arena, 400); assert.equal(a.wheel, false);
});
test('all six original tube routes work, sheltered from bumps, with optional nibbling inside', () => {
  for (let branch = 0; branch < 3; branch++) for (const steer of [INPUT.LEFT, INPUT.RIGHT]) {
    const arena = active(), p = arena.hamsters[0], start = tunnelPose(branch, 0);
    Object.assign(p, start); p.pouch = [1]; p.energy = 20;
    advanceArena(arena, [INPUT.UP]); assert.ok(p.tube);
    steps(arena, 52, [INPUT.EAT]); assert.equal(p.score, 20);
    let entered = false, exited = false;
    for (let tick = 0; tick < 1400; tick++) {
      advanceArena(arena, [INPUT.UP | steer]); entered ||= !!p.tube;
      assert.ok(validSnapshot(snapshot(arena)), 'a tube/fork pose has a bounded valid wire representation');
      if (entered && !p.tube) { exited = true; break; }
    }
    assert.ok(exited, `branch ${branch} exits with ${steer}`); assert.notEqual(p.y, NaN); assert.ok(p.energy > 20);
  }
});
test('three-minute finish stops simulation, excludes uneaten food, and allows shared winners', () => {
  const arena = active(4); arena.hamsters[0].score = arena.hamsters[2].score = 100; arena.hamsters[1].score = 90;
  arena.hamsters[1].pouch = [3, 3, 3]; arena.tick = COUNTDOWN_TICKS + ROUND_TICKS - 1;
  advanceArena(arena, []); assert.equal(arena.phase, 'results'); assert.deepEqual(winners(arena), [0, 2]); assert.deepEqual(rankArena(arena), [0, 2, 1, 3]);
  const final = snapshot(arena); steps(arena, 100, [INPUT.UP, INPUT.EAT]); assert.deepEqual(snapshot(arena), final);
});
test('malformed, forged, old-round, replayed and old-epoch input cannot change state or control another hamster', () => {
  const arena = active(), link = { slot: 1, seq: 0, mask: 0, lastInput: 0 };
  const input = { kind: 'input', id: arena.id, epoch: 0, seq: 1, mask: INPUT.UP, slot: 0, score: 9999, x: 99 };
  assert.ok(acceptInput(arena, link, input, 100)); assert.equal(arena.inputSeqs[1], 1); assert.equal(arena.inputSeqs[0], 0);
  assert.equal(arena.hamsters[1].score, 0); assert.equal(link.mask, INPUT.UP);
  for (const changes of [{}, { seq: 0 }, { seq: 9999 }, { seq: 2, id: 'OLD' }, { seq: 2, epoch: 1 }, { seq: 2, mask: 512 }, { seq: 2, mask: NaN }])
    assert.equal(acceptInput(arena, link, { ...input, ...changes }, 200), false);
  assert.equal(acceptInput(arena, link, null, 200), false); assert.equal(link.lastInput, 100);
});
test('snapshot validation rejects nonfinite positions, huge food, malformed tube frames and forged scores', () => {
  const original = snapshot(active(4)); assert.ok(validSnapshot(original)); assert.ok(JSON.stringify(original).length < 16000);
  const mutations = [s => { s.hamsters[0].x = Infinity; }, s => { s.hamsters[1].energy = NaN; }, s => { s.hamsters[2].score = -1; },
    s => { s.hamsters[0].pouch = [0, 1, 2, 3, 0, 1]; }, s => { s.foods = Array(41).fill(s.foods[0]); },
    s => { s.hamsters[0].tube = { branch: 0, s: 1, direction: 1, turn: null }; }, s => { s.tick = 99999; },
    s => { s.events = [{ type: 'bump', id: 1, tick: 0, slot: 99 }]; s.eventSeq = 1; }];
  for (const mutate of mutations) { const state = structuredClone(original); mutate(state); assert.equal(validSnapshot(state), false); }
  original.hamsters[0].pouch.push(2); assert.equal(active().hamsters[0].pouch.length, 0);
});
test('prediction discards stale states and snaps on new epochs without predicting points', () => {
  const arena = active(), prediction = new Prediction(1); arena.hamsters[1].pouch = [2];
  const state = snapshot(arena), now = performance.now(); assert.ok(prediction.receive(state, now, 80, INPUT.UP));
  prediction.update(.1, INPUT.UP); assert.ok(prediction.local.z < state.hamsters[1].z); assert.equal(prediction.local.score, 0);
  assert.equal(prediction.receive(state, now + 50, 80, 0), false);
  arena.epoch++; arena.phase = 'paused'; assert.ok(prediction.receive(snapshot(arena), now + 60, 80, 0));
  const z = prediction.local.z; prediction.update(.1, INPUT.UP); assert.equal(prediction.local.z, z);
  const packet = prediction.packet(INPUT.UP); assert.equal(packet.epoch, 1); assert.equal(packet.mask, INPUT.UP); assert.ok(!Object.hasOwn(packet, 'score'));
});
test('host-only start, readiness, four-player limit, pause/resume epochs and lobby return follow existing room policy', t => {
  const { session, views } = sessionFixture(t); session.isHost = true; session.players = [{ name: 'Host', ready: true }];
  assert.equal(session.start(), false);
  const connection = {}, player = { name: 'Guest', ready: false };
  session.links.set(connection, { connection, player, accepted: true, slot: 1, seq: 0, mask: 0, fast: { readyState: 'open', close() {} } });
  session.players.push(player); assert.equal(session.start(), false); player.ready = true; assert.equal(session.start(), true);
  const id = session.arena.id; session.pause(); assert.equal(session.arena.phase, 'paused'); assert.equal(session.arena.epoch, 1);
  session.resume(); assert.equal(session.arena.phase, 'countdown'); assert.equal(session.arena.epoch, 2);
  session.arena.phase = 'results'; assert.equal(session.start(), true); assert.notEqual(session.arena.id, id);
  session.arena.phase = 'results'; session.returnLobby(); assert.equal(session.arena, null); assert.equal(player.ready, false); assert.equal(views.at(-1).kind, 'lobby');
  session.isHost = false; player.ready = true; assert.equal(session.start(), false);
});
test('guest control packets cannot start, pause or score; replayed ready intents execute once', t => {
  const { session } = sessionFixture(t); session.isHost = true; session.players = [{ name: 'Host', ready: true }, { name: 'Guest', ready: false }];
  const connection = {}, link = { connection, slot: 1, player: session.players[1], accepted: true, seq: 0, requests: new RequestCache(), fast: { readyState: 'open', close() {} } };
  session.links.set(connection, link);
  for (const type of ['START_GAME', 'PLAY_AGAIN']) session.receiveControl(connection, message(type, { slot: 0, action: 'score', score: 10000 }));
  assert.equal(session.arena, null);
  const ready = message('SET_READY', { ready: true }); session.receiveControl(connection, ready); assert.equal(link.player.ready, true);
  session.receiveControl(connection, { ...ready, payload: { ready: false } }); assert.equal(link.player.ready, true);
});
test('reliable short taps survive key release, are consumed once, and reject replays and stale epochs', t => {
  const { session } = sessionFixture(t); session.isHost = true; session.arena = active(); session.players = [{ name: 'Host', ready: true }, { name: 'Guest', ready: true }];
  const connection = {}, link = { connection, slot: 1, player: session.players[1], accepted: true, seq: 0, mask: 0, lastInput: 0, lastPing: performance.now(), requests: new RequestCache(), fast: { readyState: 'open', close() {}, bufferedAmount: 0, send() {} } };
  session.links.set(connection, link);
  const tapped = message('PLAY_AGAIN', { action: 'tap', id: session.arena.id, epoch: 0, key: INPUT.DASH });
  session.receiveControl(connection, tapped); assert.equal(session.pendingTaps[1], INPUT.DASH);
  session.previous = performance.now() - 25; session.accumulator = 0; session.clockTick();
  assert.ok(session.arena.hamsters[1].dash > 0); assert.equal(session.pendingTaps[1], 0);
  session.receiveControl(connection, tapped); assert.equal(session.pendingTaps[1], 0, 'duplicate request is consumed once');
  session.receiveControl(connection, message('PLAY_AGAIN', { ...tapped.payload, epoch: 99 })); assert.equal(session.pendingTaps[1], 0);
  session.receiveControl(connection, message('PLAY_AGAIN', { ...tapped.payload, key: INPUT.UP })); assert.equal(session.pendingTaps[1], 0);
  session.tap(INPUT.SQUEAK); assert.equal(session.pendingTaps[0], INPUT.SQUEAK); session.pause(); assert.ok(session.pendingTaps.every(n => n === 0));
});
test('host visibility pauses immediately and long stalls pause play while countdown preparation stays bounded', t => {
  const { session } = sessionFixture(t); session.isHost = true; session.arena = createArena(1, 'PICNIC'); session.players = [{ name: 'Host', ready: true }, { name: 'Guest', ready: true }];
  session.previous = performance.now() - 10000; session.accumulator = 0; session.clockTick();
  assert.equal(session.arena.phase, 'countdown'); assert.ok(session.arena.tick <= 30);
  session.arena.phase = 'playing'; session.previous = performance.now() - 4000; session.clockTick(); assert.equal(session.arena.phase, 'paused');
  session.resume(); globalThis.document.hidden = true; session.visibilityHandler(); assert.equal(session.arena.phase, 'paused');
});
test('merging static meshes preserves rig geometry and keeps articulated parts independently movable', () => {
  const rig = new Group(), material = new MeshStandardMaterial(), sphere = new Mesh(new SphereGeometry(.5, 8, 6), material), cube = new Mesh(new BoxGeometry(1, 1, 1), material);
  sphere.position.set(-1, .4, 0); cube.position.set(1, .5, 0); const jaw = new Mesh(new SphereGeometry(.2), material); jaw.position.set(0, -.5, 0);
  rig.add(sphere, cube, jaw); mergeStaticMeshes(rig, new Set([jaw])); assert.equal(rig.children.length, 2); assert.ok(rig.children.includes(jaw));
  const merged = rig.children.find(mesh => mesh !== jaw); merged.geometry.computeBoundingBox();
  assert.ok(merged.geometry.boundingBox.min.x < -1.4 && merged.geometry.boundingBox.max.x > 1.4);
  jaw.position.y = -.8; assert.equal(merged.position.y, 0); rig.rotation.y = Math.PI / 2; rig.updateMatrixWorld();
  const world = new Vector3(1, 0, 0).applyMatrix4(merged.matrixWorld); assert.ok(Math.abs(world.z + 1) < 1e-10);
  const ribs = new Group(), translucent = new MeshStandardMaterial({ transparent: true, opacity: .38 }); translucent.name = 'tube-ribs';
  const ring = new TorusGeometry(.72, .02, 8, 16); for (let i = 0; i < 10; i++) { const rib = new Mesh(ring, translucent); rib.position.z = i; ribs.add(rib); }
  batchStaticMeshes(ribs); assert.equal(ribs.children.length, 1); assert.equal(ribs.children[0].count, 10);
});
test('stale remote epochs cannot undo a pause and leaving a guest returns the remaining players to the lobby', t => {
  const { session, views } = sessionFixture(t); const arena = active(), before = snapshot(arena); session.deliver(before, 0);
  arena.phase = 'paused'; arena.epoch++; session.deliver(snapshot(arena), 1); session.deliver(before, 2);
  assert.equal(session.remotePhase, 'paused'); assert.equal(views.length, 2);
  session.isHost = true; session.arena = active(3); session.players = [{ name: 'Host', ready: true }, { name: 'Guest', ready: true }, { name: 'Friend', ready: true }];
  const first = {}, second = {};
  session.links.set(first, { connection: first, slot: 1, player: session.players[1], accepted: true, fast: { close() {} } });
  session.links.set(second, { connection: second, slot: 2, player: session.players[2], accepted: true, mask: 0, fast: { close() {} } });
  session.lost(first); assert.equal(session.arena, null); assert.equal(session.players.length, 2); assert.equal(session.links.get(second).slot, 1);
  assert.equal(session.players[1].ready, false); assert.equal(views.at(-1).kind, 'lobby');
});
test('HAMSTER is only a direct entry, is noindexed, and every production module is versioned', async () => {
  const root = new URL('../', import.meta.url), html = await readFile(new URL('games/hamster/index.html', root), 'utf8');
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  const { COLLECTION_GAMES } = await import('../games/registry.mjs'); assert.ok(COLLECTION_GAMES.every(game => game.id !== 'hamster'));
  const collection = await readFile(new URL('index.html', root), 'utf8'); assert.ok(!collection.includes('games/hamster/'));
  const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith('.mjs') && !file.startsWith('tests/') && !file.startsWith('node_modules/')).map(file => './' + file).sort();
  const config = JSON.parse(await readFile(new URL('config.json', root), 'utf8')); assert.deepEqual([...config.modules].sort(), files);
});
