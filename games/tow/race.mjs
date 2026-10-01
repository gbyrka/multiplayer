import { makeTrack, project } from './track.mjs';
import { STEP, INPUT, makeRig, stepWorld, corners, contact, serializeRig } from './physics.mjs';

export const COUNTDOWN_TICKS = 360;
export const MAX_RACE_TICKS = 240 / STEP;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export function createRace(seed, id, players = MIN_PLAYERS) {
  if (!Number.isInteger(players) || players < MIN_PLAYERS || players > MAX_PLAYERS) throw new RangeError('A race needs 2–4 drivers.');
  const track = makeTrack(seed);
  const fill = value => Array(players).fill(value);
  return { id, seed, track, tick: 0, epoch: 0, phase: 'countdown', rigs: Array.from({ length: players }, (_, slot) => makeRig(track, slot, track.start, players)),
    masks: fill(0), progress: fill(track.start), nextGate: fill(0), finished: fill(null),
    penalties: fill(0), lastReset: fill(-2000), firstFinish: null,
    horns: fill(false), hornUntil: fill(0), audioSeq: 0, audioEvents: [], lastImpact: fill(-1000) };
}

export function rankRace(state) {
  return state.rigs.map((_, slot) => slot).sort((a, b) =>
    (state.finished[a] ?? Infinity) - (state.finished[b] ?? Infinity) || state.progress[b] - state.progress[a] || a - b);
}

function audioEvent(race, event) {
  race.audioEvents.push({ ...event, id: ++race.audioSeq, tick: race.tick });
  race.audioEvents = race.audioEvents.slice(-24);
}

/** Reliable horn intent, refreshed while held; expiry recovers a lost key release. */
export function setHorn(race, slot, pressed) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= race.rigs.length || typeof pressed !== 'boolean') return false;
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
  for (let slot = 0; slot < race.rigs.length; slot++) if (race.horns[slot] && race.tick >= race.hornUntil[slot]) setHorn(race, slot, false);
  race.audioEvents = race.audioEvents.filter(event => race.tick - event.tick <= 180);
  race.masks = race.rigs.map((_, i) => race.finished[i] === null ? masks[i] ?? 0 : INPUT.BRAKE);
  if (race.tick < COUNTDOWN_TICKS) return;
  race.phase = 'racing';
  const impacts = [];
  stepWorld(race.rigs, race.masks, race.track, STEP, race.finished.map(time => time !== null), impact => impacts.push(impact));
  for (const impact of impacts.sort((a, b) => b.speed - a.speed)) {
    if (impact.slots.some(slot => race.tick - race.lastImpact[slot] < 22)) continue;
    impact.slots.forEach(slot => { race.lastImpact[slot] = race.tick; });
    audioEvent(race, { type: 'impact', ...impact, speed: Math.min(1400, impact.speed) });
  }
  for (let slot = 0; slot < race.rigs.length; slot++) {
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
  if (!Number.isInteger(slot) || slot < 0 || slot >= race.rigs.length) return false;
  if (race.phase !== 'racing' || race.finished[slot] !== null || race.tick - race.lastReset[slot] < 8 / STEP) return false;
  const gate = race.nextGate[slot] ? race.track.gates[race.nextGate[slot] - 1] : race.track.start;
  const lanes = [slot, ...race.rigs.map((_, i) => i).filter(i => i !== slot)];
  for (let back = 0; back < 500; back += 50) for (const lane of lanes) {
    const rig = makeRig(race.track, lane, Math.max(race.track.start, gate - back), race.rigs.length);
    const blocked = [rig.car, rig.trailer].some(b =>
      race.track.obstacles.some(o => contact(b, o)) ||
      race.rigs.some((other, i) => i !== slot && race.finished[i] === null && [other.car, other.trailer].some(o => contact(b, o))) ||
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
  const players = data?.rigs?.length;
  if (!Number.isInteger(players) || players < MIN_PLAYERS || players > MAX_PLAYERS) return false;
  const vector = (value, test) => Array.isArray(value) && value.length === players && value.every(test);
  const slot = value => Number.isInteger(value) && value >= 0 && value < players;
  const finite = value => Number.isFinite(value) && Math.abs(value) < 1000000;
  return !!data && typeof data.id === 'string' && data.id.length <= 64 && Number.isInteger(data.seed) && data.seed >= 0 && data.seed <= 0xffffffff &&
    Number.isInteger(data.tick) && data.tick >= 0 && data.tick <= MAX_RACE_TICKS + COUNTDOWN_TICKS + 1 && Number.isInteger(data.epoch) && data.epoch >= 0 && data.epoch <= 10000 &&
    ['countdown', 'racing', 'paused', 'results'].includes(data.phase) &&
    vector(data.rigs, rig => Array.isArray(rig) && rig.length === 2 && rig.every(b => Array.isArray(b) && b.length === 8 && b.every(finite))) &&
    vector(data.masks, mask => Number.isInteger(mask) && mask >= 0 && mask <= 31) && vector(data.progress, finite) &&
    vector(data.nextGate, n => Number.isInteger(n) && n >= 0 && n <= 100) &&
    vector(data.finished, t => t === null || (finite(t) && t >= 0)) && vector(data.penalties, t => finite(t) && t >= 0) && vector(data.lastReset, finite) &&
    vector(data.horns, value => typeof value === 'boolean') && Number.isSafeInteger(data.audioSeq) && data.audioSeq >= 0 && data.audioSeq <= 100000 &&
    Array.isArray(data.audioEvents) && data.audioEvents.length <= 24 && data.audioEvents.every(event =>
      event && Number.isSafeInteger(event.id) && event.id > 0 && event.id <= data.audioSeq && Number.isInteger(event.tick) && event.tick >= 0 && event.tick <= data.tick &&
      (event.type === 'horn' ? slot(event.slot) : event.type === 'impact' &&
        finite(event.x) && finite(event.y) && Number.isFinite(event.speed) && event.speed >= 0 && event.speed <= 1400 &&
        ['curb', 'obstacle', 'trailer', 'vehicle'].includes(event.kind) && Array.isArray(event.slots) && event.slots.length >= 1 && event.slots.length <= 2 && event.slots.every(slot)));
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
