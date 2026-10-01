import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack } from '../games/tow/track.mjs';
import { makeRig, INPUT, STEP } from '../games/tow/physics.mjs';
import { createRace, advanceRace, snapshot, setHorn, validSnapshot, COUNTDOWN_TICKS } from '../games/tow/race.mjs';
import { spatialMix, vehicleSound, engineGear, SoundTimeline } from '../games/tow/audio-model.mjs';
import { Prediction } from '../games/tow/prediction.mjs';

test('other vehicles attenuate monotonically with distance and move to the correct ear', () => {
  const listener = { x: 0, y: 0, vx: 0, vy: 0 }, gains = [0, 100, 320, 800, 1600, 2200, 4000].map(x => spatialMix({ x, y: 0 }, listener).gain);
  for (let i = 1; i < gains.length; i++) assert.ok(gains[i] <= gains[i - 1]);
  assert.equal(gains[0], 1); assert.equal(gains.at(-1), 0); assert.ok(gains[4] < .02);
  assert.ok(spatialMix({ x: -200, y: 0 }, listener).pan < 0); assert.ok(spatialMix({ x: 200, y: 0 }, listener).pan > 0);
  assert.deepEqual(spatialMix({ x: 4000, y: 0 }, listener, true), { gain: 1, pan: 0, doppler: 1 });
  assert.ok(spatialMix({ x: 400, y: 0, vx: -250 }, listener).doppler > 1);
  assert.ok(spatialMix({ x: 400, y: 0, vx: 250 }, listener).doppler < 1);
});

test('engine responds to throttle and speed, with stable gears and skid only under load', () => {
  const rig = makeRig(makeTrack(3), 0), idle = vehicleSound(rig, 0, 1);
  assert.equal(idle.skid, 0); assert.equal(idle.rolling, 0);
  assert.ok(vehicleSound(rig, INPUT.UP, 1).rpm > idle.rpm);
  Object.assign(rig.car, { speed: 300, vx: 0, vy: -300, a: 0, omega: 0 });
  assert.equal(vehicleSound(rig, INPUT.UP, 3).skid, 0);
  rig.car.omega = 2; assert.ok(vehicleSound(rig, INPUT.UP, 3).skid > .4);
  Object.assign(rig.car, { speed: 300, omega: 0, braking: true }); assert.ok(vehicleSound(rig, INPUT.BRAKE, 3).skid > 0);
  Object.assign(rig.car, { speed: 0, vx: 0, vy: 0, omega: 3 }); assert.equal(vehicleSound(rig, INPUT.RIGHT, 1).skid, 0);
  assert.equal(engineGear(108, 1), 2); assert.equal(engineGear(99, 2), 2); assert.equal(engineGear(95, 2), 2); assert.equal(engineGear(65, 2), 1);
  assert.equal(engineGear(-40, 2), 0);
});

test('the host reports real collisions, bounds repeated effects and shares immutable event IDs', () => {
  const race = createRace(1, 'collision'); race.tick = COUNTDOWN_TICKS; race.phase = 'racing';
  race.track = { points: [{ x: 0, y: 0, s: 0 }, { x: 0, y: -6000, s: 6000 }], length: 6000, halfWidth: 500, start: 260, finish: 5700, gates: [5700], obstacles: [] };
  race.rigs = [makeRig(race.track, 0), makeRig(race.track, 1)];
  for (const [slot, x, angle, vx] of [[0, -55, Math.PI / 2, 250], [1, 55, -Math.PI / 2, -250]]) {
    for (const [name, offset] of [['car', 0], ['trailer', 94]]) Object.assign(race.rigs[slot][name], { x: x - Math.sin(angle) * offset, y: -1000 + Math.cos(angle) * offset, a: angle, vx, vy: 0 });
  }
  for (let tick = 0; tick < 36; tick++) advanceRace(race, [0, 0]);
  const impacts = race.audioEvents.filter(e => e.type === 'impact'); assert.ok(impacts.length > 0 && impacts.length < 4);
  assert.ok(impacts.some(e => e.kind === 'vehicle' && e.slots.length === 2 && e.speed > 100));
  assert.ok(validSnapshot(snapshot(race)));
  const view = snapshot(race); view.audioEvents[0].slots[0] = 10; assert.ok(race.audioEvents[0].slots.every(slot => slot < 2));
  for (let tick = 0; tick < 240; tick++) advanceRace(race, [0, 0]);
  assert.ok(race.audioEvents.every(e => race.tick - e.tick <= 180));
});

test('short horn taps survive snapshots, held horns refresh, releases/timeouts/pause silence them', () => {
  const race = createRace(7, 'horn');
  assert.ok(setHorn(race, 1, true)); assert.ok(setHorn(race, 1, false)); assert.equal(race.horns[1], false);
  assert.equal(race.audioEvents.filter(e => e.type === 'horn').length, 1, 'even a press/release on the same tick is observable');
  setHorn(race, 1, true); const sequence = race.audioSeq;
  for (let tick = 0; tick < 100; tick++) advanceRace(race, [0, 0]);
  assert.equal(setHorn(race, 1, true), false); assert.equal(race.audioSeq, sequence);
  for (let tick = 0; tick < 100; tick++) advanceRace(race, [0, 0]); assert.equal(race.horns[1], true);
  for (let tick = 0; tick < 30; tick++) advanceRace(race, [0, 0]); assert.equal(race.horns[1], false);
  race.phase = 'paused'; assert.equal(setHorn(race, 0, true), false);
  assert.ok(validSnapshot(snapshot(race)));
});

test('prediction accepts same-tick horn changes and rejects older audio revisions', () => {
  const race = createRace(7, 'hornrevision'), prediction = new Prediction(1);
  const old = snapshot(race); prediction.receive(old, 0);
  setHorn(race, 0, true); assert.ok(prediction.receive(snapshot(race), 10));
  setHorn(race, 0, false); assert.ok(prediction.receive(snapshot(race), 20));
  assert.equal(prediction.receive(old, 30), false);
});

test('effects play once across repeated/lost snapshots; countdown is 3–2–1–go without replay on pause', () => {
  const race = createRace(9, 'timeline'), timeline = new SoundTimeline();
  assert.deepEqual(timeline.receive(snapshot(race)).map(e => [e.type, e.count]), [['countdown', 3]]);
  assert.deepEqual(timeline.receive(snapshot(race)), []);
  race.tick = 120; assert.deepEqual(timeline.receive(snapshot(race)).map(e => e.count), [2]);
  race.phase = 'paused'; assert.deepEqual(timeline.receive(snapshot(race)), []);
  race.phase = 'countdown'; assert.deepEqual(timeline.receive(snapshot(race)), []);
  race.tick = 240; assert.deepEqual(timeline.receive(snapshot(race)).map(e => e.count), [1]);
  race.tick = 360; race.phase = 'racing'; assert.deepEqual(timeline.receive(snapshot(race)).map(e => e.type), ['go']);
  setHorn(race, 0, true); setHorn(race, 0, false); race.tick += 24;
  assert.equal(timeline.receive(snapshot(race)).filter(e => e.type === 'horn').length, 1);
  assert.deepEqual(timeline.receive(snapshot(race)), []);
  race.finished[1] = 1.2; assert.deepEqual(timeline.receive(snapshot(race)).map(e => [e.type, e.slot]), [['finish', 1]]);
  assert.deepEqual(timeline.receive(snapshot(race)), []);
  setHorn(race, 1, true); race.tick += 91; assert.deepEqual(timeline.receive(snapshot(race)), [], 'do not play an old horn after returning');
  const fresh = createRace(10, 'rematch'); assert.equal(timeline.receive(snapshot(fresh))[0].count, 3);
});

test('third and fourth drivers have independent horns, finish, checkpoint and reset sounds', () => {
  const race = createRace(9, 'four-sounds', 4), timeline = new SoundTimeline();
  timeline.receive(snapshot(race));
  assert.ok(setHorn(race, 2, true)); assert.ok(setHorn(race, 3, true));
  assert.deepEqual(timeline.receive(snapshot(race)).map(e => [e.type, e.slot]), [['horn', 2], ['horn', 3]]);
  assert.ok(validSnapshot(snapshot(race)));
  assert.equal(setHorn(race, 4, true), false);
  const invalid = snapshot(race); invalid.audioEvents[0].slot = 4; assert.equal(validSnapshot(invalid), false);
  race.finished[2] = 70; race.nextGate[3]++; race.lastReset[3] = 100;
  assert.deepEqual(timeline.receive(snapshot(race)).map(e => [e.type, e.slot]), [['finish', 2], ['checkpoint', 3], ['reset', 3]]);
  assert.deepEqual(timeline.receive(snapshot(race)), []);
  for (let tick = 0; tick < 120; tick++) advanceRace(race, [0, 0, 0, 0]);
  assert.deepEqual(race.horns, [false, false, false, false]);
});
