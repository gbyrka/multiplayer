import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack, pointAt, project } from '../games/tow/track.mjs';
import { STEP, INPUT, makeRig, stepWorld, hitchError, cloneRig, corners, contact, serializeRig } from '../games/tow/physics.mjs';
import { createRace, advanceRace, resetRig, snapshot, validSnapshot, acceptInputFrames, COUNTDOWN_TICKS, rankRace } from '../games/tow/race.mjs';
import { Prediction } from '../games/tow/prediction.mjs';
import { drivingLine, drivingMask } from './tow-driver.mjs';

const straight = () => ({ points: [{ x: 0, y: 0, s: 0 }, { x: 0, y: -6000, s: 6000 }], length: 6000, halfWidth: 500,
  start: 260, finish: 5700, gates: [1800, 3600, 5700], obstacles: [] });
const finiteRig = rig => [rig.car, rig.trailer].every(b => ['x', 'y', 'a', 'vx', 'vy', 'omega'].every(key => Number.isFinite(b[key])));

test('seeded routes agree, vary, and include dense obstacles across the road without blocking passage', () => {
  assert.deepEqual(makeTrack(1777), makeTrack(1777));
  assert.notDeepEqual(makeTrack(1777).points, makeTrack(87654).points);
  for (const seed of [0, 72177, 42, 325599, 0xffffffff]) {
    const track = makeTrack(seed);
    assert.ok(track.length >= 24000 && track.length <= 29001);
    for (let i = 1; i < track.points.length; i++) assert.ok(track.points[i].y < track.points[i - 1].y);
    assert.ok(track.obstacles.length >= 95, `seed ${seed}: obstacle count ${track.obstacles.length}`);
    assert.ok(track.obstacles.filter(o => Math.abs(project(track, o.x, o.y).lateral) < 25).length >= 25, 'centre obstacles');
    assert.ok(track.obstacles.some(o => { const lateral = Math.abs(project(track, o.x, o.y).lateral); return lateral > 45 && lateral < 85; }), 'lane obstacles');
    for (const obstacle of track.obstacles) {
      assert.ok(obstacle.s > track.start + 600 && obstacle.s < track.finish - 650, 'clear grid and finish');
      for (const p of corners(obstacle)) assert.ok(project(track, p.x, p.y).distance < track.halfWidth, 'obstacles inside the road');
    }
    for (let s = track.start; s < track.finish; s += 100) {
      assert.ok([-105, -55, 0, 55, 105].some(offset => {
        const p = pointAt(track, s), rig = makeRig(track, 0, s);
        for (const b of [rig.car, rig.trailer]) { b.x += p.nx * (offset + 56); b.y += p.ny * (offset + 56); }
        return [rig.car, rig.trailer].every(b => corners(b).every(c => project(track, c.x, c.y).distance < track.halfWidth - 2) && !track.obstacles.some(o => contact(b, o)));
      }), `seed ${seed}: full-width blockage at ${s}`);
    }
    for (let s = 0; s < track.length; s += 190) {
      const p = pointAt(track, s); assert.ok(Math.abs(project(track, p.x, p.y).s - s) < 1e-6);
    }
  }
});

test('a trailer can complete different generated routes within 1–3 minutes', () => {
  for (const seed of [17, 412913, 3220342421]) {
    const track = makeTrack(seed), rig = makeRig(track, 0), line = drivingLine(track);
    let finish = null, maxJointError = 0;
    for (let tick = 0; tick < 180 / STEP; tick++) {
      stepWorld([rig], [drivingMask(track, line, rig.car)], track);
      maxJointError = Math.max(maxJointError, hitchError(rig));
      assert.ok(finiteRig(rig));
      if (corners(rig.trailer).every(p => project(track, p.x, p.y).s >= track.finish)) { finish = tick * STEP; break; }
    }
    assert.ok(finish >= 60 && finish < 180, `seed ${seed}: ${finish}s`);
    assert.ok(maxJointError < 1, `stable hitch on seed ${seed}: ${maxJointError}`);
  }
});

test('Space stops the rig and takes priority over throttle; opposite pedal brakes before reversing', () => {
  const track = straight(), rig = makeRig(track, 0);
  for (let n = 0; n < 360; n++) stepWorld([rig], [INPUT.UP], track);
  assert.ok(rig.car.speed > 300);
  for (let n = 0; n < 240; n++) stepWorld([rig], [INPUT.UP | INPUT.BRAKE], track);
  assert.ok(Math.abs(rig.car.speed) < .2);
  const stopped = cloneRig(rig);
  for (let n = 0; n < 120; n++) stepWorld([rig], [INPUT.DOWN | INPUT.BRAKE], track);
  assert.ok(Math.abs(rig.car.y - stopped.car.y) < 1);
  for (let n = 0; n < 120; n++) stepWorld([rig], [INPUT.DOWN], track);
  assert.ok(rig.car.speed < -25);
  stepWorld([rig], [INPUT.UP], track);
  assert.ok(rig.car.braking && rig.car.speed < 0);
  assert.ok(hitchError(rig) < .1);
});

function aimRig(rig, x, y, angle, vx, vy) {
  for (const [name, offset] of [['car', 0], ['trailer', 94]]) {
    Object.assign(rig[name], { x: x - Math.sin(angle) * offset, y: y + Math.cos(angle) * offset, a: angle, vx, vy, omega: 0 });
  }
}

test('an offset head-on impact transfers momentum and turns cars without breaking the hitch', () => {
  const track = straight(), a = makeRig(track, 0), b = makeRig(track, 1);
  aimRig(a, -70, -1000, Math.PI / 2, 240, 0); aimRig(b, 70, -1015, -Math.PI / 2, -240, 0);
  let peakSpin = 0, peakLateral = 0, maxHitch = 0;
  for (let n = 0; n < 180; n++) {
    stepWorld([a, b], [0, 0], track);
    peakSpin = Math.max(peakSpin, Math.abs(a.car.omega), Math.abs(b.car.omega));
    peakLateral = Math.max(peakLateral, Math.abs(a.car.vy), Math.abs(b.car.vy));
    maxHitch = Math.max(maxHitch, hitchError(a), hitchError(b));
    assert.ok(finiteRig(a) && finiteRig(b));
  }
  assert.ok(peakSpin > .25, `spin ${peakSpin}`); assert.ok(peakLateral > 10, `deflection ${peakLateral}`);
  assert.ok(maxHitch < 2); assert.ok((contact(a.car, b.car)?.depth ?? 0) < .1, 'no significant remaining overlap');
});

test('trailer impacts and road boundaries remain stable at racing speed', () => {
  const track = straight(), a = makeRig(track, 0), b = makeRig(track, 1);
  aimRig(a, -90, -911, Math.PI / 2, 380, 0); aimRig(b, 0, -1005, 0, 0, 0);
  let moved = 0, maxHitch = 0;
  for (let tick = 0; tick < 1200; tick++) {
    stepWorld([a, b], [INPUT.UP | (tick > 90 ? INPUT.RIGHT : 0), 0], track);
    moved = Math.max(moved, Math.hypot(b.car.vx, b.car.vy)); maxHitch = Math.max(maxHitch, hitchError(a), hitchError(b));
    for (const rig of [a, b]) { assert.ok(finiteRig(rig)); for (const p of [...corners(rig.car), ...corners(rig.trailer)]) assert.ok(project(track, p.x, p.y).distance <= track.halfWidth + 3); }
  }
  assert.ok(moved > 20, `trailer impact transferred speed ${moved}`); assert.ok(maxHitch < 3);
});

test('countdown, checkpoint reset penalty, finish, timeout and fresh rematch state', () => {
  const race = createRace(35, 'race1'); race.track = straight(); race.rigs = [makeRig(race.track, 0), makeRig(race.track, 1)];
  const initial = serializeRig(race.rigs[0]);
  for (let tick = 0; tick < COUNTDOWN_TICKS - 1; tick++) advanceRace(race, [INPUT.UP, INPUT.UP]);
  assert.deepEqual(serializeRig(race.rigs[0]), initial); assert.equal(race.phase, 'countdown');
  advanceRace(race, [INPUT.UP, INPUT.UP]); assert.equal(race.phase, 'racing');
  assert.equal(resetRig(race, 0), true); assert.equal(race.penalties[0], 3); assert.equal(resetRig(race, 0), false);
  for (let tick = 0; tick < 6000 && race.phase !== 'results'; tick++) advanceRace(race, [INPUT.UP, INPUT.UP]);
  assert.equal(race.phase, 'results'); assert.ok(race.finished.every(time => time !== null));
  assert.ok(Math.abs(race.finished[0] - race.finished[1] - 3) < .1);
  const fresh = createRace(36, 'race2'); assert.deepEqual(fresh.finished, [null, null]); assert.deepEqual(fresh.penalties, [0, 0]); assert.equal(fresh.tick, 0);
  const stalled = createRace(37, 'timeout'); stalled.tick = COUNTDOWN_TICKS + 240 / STEP - 1; stalled.phase = 'racing';
  advanceRace(stalled, [0, 0]); assert.equal(stalled.phase, 'results'); assert.deepEqual(stalled.finished, [null, null]);
});

test('transient input packets reject invalid values, old races and excessive future ticks', () => {
  const race = createRace(5, 'inputrace'), queue = new Map();
  assert.ok(acceptInputFrames(race, queue, { kind: 'input', id: race.id, epoch: 0, frames: [[1, 1], [1, 8], [120, 16], [121, 2], [-10, 2]] }));
  assert.deepEqual([...queue], [[1, 1], [120, 16]]);
  for (const frames of [[[2, 32]], [[2, -1]], [[2.5, 1]], [[2, NaN]], Array(65).fill([2, 1])]) {
    assert.equal(acceptInputFrames(race, queue, { kind: 'input', id: race.id, epoch: 0, frames }), false);
  }
  assert.equal(acceptInputFrames(race, queue, { kind: 'input', id: 'oldrace', epoch: 0, frames: [[2, 1]] }), false);
  race.epoch++; assert.equal(acceptInputFrames(race, queue, { kind: 'input', id: race.id, epoch: 0, frames: [[2, 1]] }), false, 'discard packets from before pause');
  const data = snapshot(race); assert.ok(validSnapshot(data)); data.rigs[0][0][0] = NaN; assert.equal(validSnapshot(data), false);
});

test('prediction responds immediately, replays authoritative ticks exactly and bounds history during a stall', () => {
  const race = createRace(876, 'prediction');
  for (let n = 0; n < 480; n++) advanceRace(race, [INPUT.UP, INPUT.UP]);
  const prediction = new Prediction(1), state = snapshot(race);
  prediction.receive(state, 1000, 0, INPUT.UP);
  assert.ok(prediction.tick > state.tick);
  const targetTick = prediction.tick;
  while (race.tick < targetTick) advanceRace(race, [INPUT.UP, INPUT.UP]);
  for (const name of ['car', 'trailer']) for (const key of ['x', 'y', 'a', 'vx', 'vy']) assert.ok(Math.abs(race.rigs[1][name][key] - prediction.rigs[1][name][key]) < 1e-8);
  assert.ok(prediction.receive(snapshot(race), 1100, 150, INPUT.UP));
  assert.equal(prediction.receive(state, 1200, 150, INPUT.UP), false, 'out-of-order snapshot');
  for (let n = 0; n < 240; n++) prediction.update(STEP, INPUT.UP);
  assert.ok(prediction.frames.size <= 120); assert.ok(prediction.packet().frames.length <= 64);
  assert.ok(prediction.display(1400).every(finiteRig));
});

test('2–4 drivers spawn separately, finish together and keep correctly sized race state', () => {
  for (const players of [2, 3, 4]) {
    const race = createRace(53, `drivers${players}`, players);
    assert.ok(validSnapshot(snapshot(race)));
    for (let i = 0; i < players; i++) for (let j = i + 1; j < players; j++) {
      for (const a of [race.rigs[i].car, race.rigs[i].trailer]) for (const b of [race.rigs[j].car, race.rigs[j].trailer]) assert.equal(contact(a, b), null);
    }
    for (const rig of race.rigs) for (const b of [rig.car, rig.trailer]) for (const p of corners(b)) assert.ok(project(race.track, p.x, p.y).distance < race.track.halfWidth);
    race.track = straight(); race.rigs = Array.from({ length: players }, (_, slot) => makeRig(race.track, slot, race.track.start, players));
    for (let tick = 0; tick < 6000 && race.phase !== 'results'; tick++) advanceRace(race, Array(players).fill(INPUT.UP));
    assert.equal(race.phase, 'results'); assert.ok(race.finished.every(time => time !== null));
    assert.ok(validSnapshot(snapshot(race))); assert.equal(race.rigs.length, players);
    const data = snapshot(race); data.horns.pop(); assert.equal(validSnapshot(data), false, 'all arrays must describe the same drivers');
  }
  for (const players of [0, 1, 5, 2.5]) assert.throws(() => createRace(1, 'invalid', players), RangeError);
});

test('four-player rankings include every driver and put finishers before unfinished cars', () => {
  const race = createRace(7, 'rank', 4);
  race.progress = [9000, 8200, 7500, 9500]; assert.deepEqual(rankRace(race), [3, 0, 1, 2]);
  race.finished = [null, 81, 78, null]; assert.deepEqual(rankRace(race), [2, 1, 3, 0]);
  race.finished = [90, 81, 78, 80]; assert.deepEqual(rankRace(race), [2, 3, 1, 0]);
});

test('reset searches every lane and avoids all three other cars and trailers', () => {
  const race = createRace(7, 'reset4', 4); race.track = straight(); race.track.halfWidth = 172;
  race.phase = 'racing'; race.tick = COUNTDOWN_TICKS + 500; race.nextGate[0] = 1;
  race.rigs = [makeRig(race.track, 0, 2400, 4), ...[0, 1, 2].map(lane => makeRig(race.track, lane, 1800, 4))];
  assert.ok(resetRig(race, 0)); assert.deepEqual(race.penalties, [3, 0, 0, 0]);
  assert.ok(Math.abs(race.rigs[0].car.x - 111) < .01, 'uses the remaining clear lane');
  for (const b of [race.rigs[0].car, race.rigs[0].trailer]) for (const rig of race.rigs.slice(1)) {
    for (const other of [rig.car, rig.trailer]) assert.equal(contact(b, other), null);
  }
  assert.equal(resetRig(race, 0), false); assert.equal(resetRig(race, 4), false);
});

test('four-player prediction replays each local driver and interpolates all remote drivers', () => {
  for (const slot of [1, 2, 3]) {
    const race = createRace(876, `prediction${slot}`, 4), masks = [INPUT.UP, INPUT.UP, INPUT.UP, INPUT.UP | INPUT.RIGHT];
    for (let n = 0; n < 420; n++) advanceRace(race, masks);
    const prediction = new Prediction(slot), state = snapshot(race);
    prediction.receive(state, 1000, 0, masks[slot]);
    while (race.tick < prediction.tick) advanceRace(race, masks);
    for (const name of ['car', 'trailer']) for (const key of ['x', 'y', 'a', 'vx', 'vy']) {
      assert.ok(Math.abs(race.rigs[slot][name][key] - prediction.rigs[slot][name][key]) < 1e-8);
    }
    const next = snapshot(race); assert.ok(prediction.receive(next, 1100, 0, masks[slot]));
    const display = prediction.display(1210);
    assert.equal(display.length, 4); assert.ok(display.every(finiteRig));
    for (let remote = 0; remote < 4; remote++) if (remote !== slot) {
      assert.ok(Math.abs(display[remote].car.x - next.rigs[remote][0][0]) < 1e-8);
      assert.ok(Math.abs(display[remote].car.y - next.rigs[remote][0][1]) < 1e-8);
    }
  }
});
