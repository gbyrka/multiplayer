import { makeTrack, project } from './track.mjs';
import { STEP, INPUT, makeRig, stepWorld, corners, contact, serializeRig } from './physics.mjs';

export const COUNTDOWN_TICKS = 360;
export const MAX_RACE_TICKS = 240 / STEP;
export function createRace(seed, id) {
  const track = makeTrack(seed);
  return { id, seed, track, tick: 0, epoch: 0, phase: 'countdown', rigs: [makeRig(track, 0), makeRig(track, 1)],
    masks: [0, 0], progress: [track.start, track.start], nextGate: [0, 0], finished: [null, null],
    penalties: [0, 0], lastReset: [-2000, -2000], firstFinish: null,
    horns: [false, false], hornUntil: [0, 0], audioSeq: 0, audioEvents: [], lastImpact: [-1000, -1000] };
}

function audioEvent(race, event) {
  race.audioEvents.push({ ...event, id: ++race.audioSeq, tick: race.tick });
  race.audioEvents = race.audioEvents.slice(-24);
}

/** Reliable horn intent, refreshed while held; expiry recovers a lost key release. */
export function setHorn(race, slot, pressed) {
  if (pressed && !['countdown', 'racing'].includes(race.phase)) return false;
  if (race.horns[slot] === pressed) { if (pressed) race.hornUntil[slot] = race.tick + 120; return false; }
  race.horns[slot] = pressed;
  if (pressed) { race.hornUntil[slot] = race.tick + 120; audioEvent(race, { type: 'horn', slot }); }
  else { race.hornUntil[slot] = 0; race.audioSeq++; }
  return true;
}

export function advanceRace(race, masks) {
  if (!['countdown', 'racing'].includes(race.phase)) return;
  race.tick++;
  for (let slot = 0; slot < 2; slot++) if (race.horns[slot] && race.tick >= race.hornUntil[slot]) setHorn(race, slot, false);
  race.audioEvents = race.audioEvents.filter(event => race.tick - event.tick <= 180);
  race.masks = masks.map((mask, i) => race.finished[i] === null ? mask : INPUT.BRAKE);
  if (race.tick < COUNTDOWN_TICKS) return;
  race.phase = 'racing';
  const impacts = [];
  stepWorld(race.rigs, race.masks, race.track, STEP, race.finished.map(time => time !== null), impact => impacts.push(impact));
  for (const impact of impacts.sort((a, b) => b.speed - a.speed)) {
    if (impact.slots.some(slot => race.tick - race.lastImpact[slot] < 22)) continue;
    impact.slots.forEach(slot => { race.lastImpact[slot] = race.tick; });
    audioEvent(race, { type: 'impact', ...impact, speed: Math.min(1400, impact.speed) });
  }
  for (let slot = 0; slot < 2; slot++) {
    const rig = race.rigs[slot], p = project(race.track, rig.car.x, rig.car.y);
    race.progress[slot] = p.s;
    while (race.nextGate[slot] < race.track.gates.length && p.s >= race.track.gates[race.nextGate[slot]]) race.nextGate[slot]++;
    if (race.finished[slot] === null && race.nextGate[slot] === race.track.gates.length &&
        corners(rig.trailer).every(point => project(race.track, point.x, point.y).s >= race.track.finish)) {
      race.finished[slot] = (race.tick - COUNTDOWN_TICKS) * STEP + race.penalties[slot];
      race.firstFinish ??= race.tick;
    }
  }
  if (race.finished.every(time => time !== null) || race.tick - COUNTDOWN_TICKS >= MAX_RACE_TICKS ||
      (race.firstFinish !== null && race.tick - race.firstFinish >= 60 / STEP)) race.phase = 'results';
}

/** A reset is a host decision with a time penalty and collision-free checkpoint. */
export function resetRig(race, slot) {
  if (race.phase !== 'racing' || race.finished[slot] !== null || race.tick - race.lastReset[slot] < 8 / STEP) return false;
  const gate = race.nextGate[slot] ? race.track.gates[race.nextGate[slot] - 1] : race.track.start;
  for (let back = 0; back < 500; back += 50) for (const lane of [slot, 1 - slot]) {
    const rig = makeRig(race.track, lane, Math.max(race.track.start, gate - back));
    const other = race.rigs[1 - slot];
    const blocked = [rig.car, rig.trailer].some(b =>
      race.track.obstacles.some(o => contact(b, o)) ||
      (race.finished[1 - slot] === null && [other.car, other.trailer].some(o => contact(b, o))) ||
      corners(b).some(p => project(race.track, p.x, p.y).distance > race.track.halfWidth - 2));
    if (blocked) continue;
    race.rigs[slot] = rig; race.progress[slot] = project(race.track, rig.car.x, rig.car.y).s;
    race.penalties[slot] += 3; race.lastReset[slot] = race.tick;
    return true;
  }
  return false;
}

export function snapshot(race) {
  return { id: race.id, seed: race.seed, tick: race.tick, epoch: race.epoch, phase: race.phase,
    rigs: race.rigs.map(serializeRig), masks: [...race.masks], progress: [...race.progress], nextGate: [...race.nextGate],
    finished: [...race.finished], penalties: [...race.penalties], lastReset: [...race.lastReset],
    horns: [...race.horns], audioSeq: race.audioSeq, audioEvents: race.audioEvents.map(event => ({ ...event, ...(event.slots ? { slots: [...event.slots] } : {}) })) };
}

export function validSnapshot(data) {
  const pair = (value, test) => Array.isArray(value) && value.length === 2 && value.every(test);
  const finite = value => Number.isFinite(value) && Math.abs(value) < 1000000;
  return !!data && typeof data.id === 'string' && data.id.length <= 64 && Number.isInteger(data.seed) && data.seed >= 0 && data.seed <= 0xffffffff &&
    Number.isInteger(data.tick) && data.tick >= 0 && data.tick <= MAX_RACE_TICKS + COUNTDOWN_TICKS + 1 && Number.isInteger(data.epoch) && data.epoch >= 0 && data.epoch <= 10000 &&
    ['countdown', 'racing', 'paused', 'results'].includes(data.phase) &&
    pair(data.rigs, rig => pair(rig, b => Array.isArray(b) && b.length === 8 && b.every(finite))) &&
    pair(data.masks, mask => Number.isInteger(mask) && mask >= 0 && mask <= 31) && pair(data.progress, finite) &&
    pair(data.nextGate, n => Number.isInteger(n) && n >= 0 && n <= 100) &&
    pair(data.finished, t => t === null || (finite(t) && t >= 0)) && pair(data.penalties, t => finite(t) && t >= 0) && pair(data.lastReset, finite) &&
    pair(data.horns, value => typeof value === 'boolean') && Number.isSafeInteger(data.audioSeq) && data.audioSeq >= 0 && data.audioSeq <= 100000 &&
    Array.isArray(data.audioEvents) && data.audioEvents.length <= 24 && data.audioEvents.every(event =>
      event && Number.isSafeInteger(event.id) && event.id > 0 && event.id <= data.audioSeq && Number.isInteger(event.tick) && event.tick >= 0 && event.tick <= data.tick &&
      (event.type === 'horn' ? event.slot === 0 || event.slot === 1 : event.type === 'impact' &&
        finite(event.x) && finite(event.y) && Number.isFinite(event.speed) && event.speed >= 0 && event.speed <= 1400 &&
        ['curb', 'obstacle', 'trailer', 'vehicle'].includes(event.kind) && Array.isArray(event.slots) && event.slots.length >= 1 && event.slots.length <= 2 && event.slots.every(slot => slot === 0 || slot === 1)));
}

export function acceptInputFrames(race, queue, packet) {
  if (!['countdown', 'racing'].includes(race.phase) || !packet || packet.kind !== 'input' || packet.id !== race.id || packet.epoch !== race.epoch || !Array.isArray(packet.frames) || packet.frames.length > 64) return false;
  if (!packet.frames.every(frame => Array.isArray(frame) && frame.length === 2 && Number.isInteger(frame[0]) && Number.isInteger(frame[1]) && frame[1] >= 0 && frame[1] <= 31)) return false;
  let current = false;
  for (const [tick, mask] of packet.frames) if (tick > race.tick && tick <= race.tick + 120) {
    current = true; if (!queue.has(tick)) queue.set(tick, mask);
  }
  return current;
}
