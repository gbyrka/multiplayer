import { STEP, INPUT, INPUT_MAX, makeHamster, stepHamster, onGround, nearWater } from './physics.mjs';
import { foodSpot, moveTo } from './world.mjs';
import { tunnelOrientation, tunnelTravelPose } from './tunnel.mjs';

export const MIN_PLAYERS = 2, MAX_PLAYERS = 4;
export const COUNTDOWN_TICKS = 3 / STEP, ROUND_TICKS = 180 / STEP;
export const FOOD_TYPES = Object.freeze([
  { name: 'Seed', points: 10, color: '#eac586', symbol: '●' },
  { name: 'Carrot', points: 20, color: '#f7a86c', symbol: '▾' },
  { name: 'Broccoli', points: 30, color: '#a9cd87', symbol: '♣' },
  { name: 'Golden treat', points: 50, color: '#ffe089', symbol: '✦' },
]);
export const COLORS = Object.freeze(['#f1b96e', '#8bcfd2', '#c0a0e4', '#b6d77f']);

function randomFor(arena) {
  return () => { arena.randomState = (Math.imul(arena.randomState, 1664525) + 1013904223) >>> 0; return arena.randomState / 4294967296; };
}
function spawnFood(arena, food) {
  const random = randomFor(arena);
  let point;
  for (let i = 0; i < 40; i++) {
    point = foodSpot(food.level, random);
    if (arena.foods.every(other => other === food || Math.abs(point.y - other.y) > .8 || Math.hypot(point.x - other.x, point.z - other.z) > 1) &&
        arena.hamsters.every(p => Math.abs(point.y - p.y) > .8 || Math.hypot(point.x - p.x, point.z - p.z) > 1.2)) break;
  }
  Object.assign(food, point, { readyAt: arena.tick + 12 });
}
export function createArena(seed, id, count = MIN_PLAYERS) {
  if (!Number.isInteger(count) || count < MIN_PLAYERS || count > MAX_PLAYERS) throw new RangeError('A picnic needs 2–4 players.');
  const arena = { id, seed: seed >>> 0, randomState: seed >>> 0, tick: 0, epoch: 0, phase: 'countdown',
    hamsters: Array.from({ length: count }, (_, i) => makeHamster(i)), masks: Array(count).fill(0),
    foods: [], nextFoodId: 0, bloom: 0, eventSeq: 0, events: [], inputSeqs: Array(count).fill(0) };
  for (let i = 0; i < 8 + (count - 2) * 2; i++) {
    const food = { id: ++arena.nextFoodId, type: Math.floor(i / 3) % 3, level: i % 3, expires: 0 };
    spawnFood(arena, food); arena.foods.push(food);
  }
  return arena;
}

export function addEvent(arena, event) {
  arena.events.push({ ...event, id: ++arena.eventSeq, tick: arena.tick });
  arena.events = arena.events.slice(-24);
}
function spill(arena, attacker, victim, nx, nz) {
  const a = arena.hamsters[attacker], b = arena.hamsters[victim];
  if (!a.dash || b.shield || (-Math.sin(a.angle) * nx - Math.cos(a.angle) * nz) < .35) return;
  b.bumpX += nx * 4; b.bumpZ += nz * 4; b.shield = 2; b.eat = b.drink = 0;
  a.dash = 0; a.bumpCount++;
  const type = b.pouch.pop();
  if (type !== undefined) {
    const position = moveTo(b.x - nx * .8 + nz * .65, b.z - nz * .8 - nx * .65, b.y, b.angle);
    arena.foods.push({ id: ++arena.nextFoodId, type, ...position, level: Math.round(position.y / 3),
      expires: arena.tick + 12 / STEP, readyAt: arena.tick + .45 / STEP, dropped: true });
  }
  addEvent(arena, { type: 'bump', slot: attacker, target: victim, dropped: type !== undefined });
}

/** Height-aware soft body contacts; only a deliberate forward dash spills food. */
export function resolveHamsters(arena) {
  const players = arena.hamsters;
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
    const a = players[i], b = players[j];
    if (!onGround(a) || !onGround(b) || Math.abs(a.y - b.y) > .65 || Math.hypot(a.x - b.x, a.z - b.z) > 1.6) continue;
    for (const offsetA of [-.28, .28]) for (const offsetB of [-.28, .28]) {
      const dx = b.x - Math.sin(b.angle) * offsetB - a.x + Math.sin(a.angle) * offsetA;
      const dz = b.z - Math.cos(b.angle) * offsetB - a.z + Math.cos(a.angle) * offsetA;
      const distance = Math.hypot(dx, dz), limit = .94;
      if (distance >= limit) continue;
      const nx = distance > 1e-6 ? dx / distance : i % 2 ? 0 : 1, nz = distance > 1e-6 ? dz / distance : i % 2 ? 1 : 0;
      if (pass === 0) { spill(arena, i, j, nx, nz); spill(arena, j, i, -nx, -nz); }
      const correction = (limit - distance + .002) / 2;
      const pa = moveTo(a.x - nx * correction, a.z - nz * correction, a.y, a.angle);
      const pb = moveTo(b.x + nx * correction, b.z + nz * correction, b.y, b.angle);
      a.x = pa.x; a.z = pa.z; b.x = pb.x; b.z = pb.z;
    }
  }
}
function snackBloom(arena) {
  arena.bloom++;
  const level = (arena.bloom - 1) % 3;
  for (let i = 0; i < 6; i++) {
    const food = { id: ++arena.nextFoodId, type: 3, level, expires: arena.tick + 10 / STEP };
    spawnFood(arena, food); arena.foods.push(food);
  }
  addEvent(arena, { type: 'bloom', level });
}
export function advanceArena(arena, masks) {
  if (!['countdown', 'playing'].includes(arena.phase)) return;
  arena.tick++;
  if (arena.tick < COUNTDOWN_TICKS) return;
  arena.phase = 'playing';
  arena.masks = arena.hamsters.map((_, i) => Number.isInteger(masks[i]) && masks[i] >= 0 && masks[i] <= INPUT_MAX ? masks[i] : 0);
  const event = value => addEvent(arena, value);
  for (let i = 0; i < arena.hamsters.length; i++) {
    stepHamster(arena.hamsters[i], arena.masks[i], STEP, { slot: i, event,
      wheelAvailable: !arena.hamsters.some((p, slot) => slot !== i && (p.wheel || p.wheelTransition)) });
  }
  resolveHamsters(arena);
  arena.foods = arena.foods.filter(food => !food.expires || food.expires > arena.tick);
  // Rotate first claim each tick so simultaneous food claims do not favor the host.
  for (let index = 0; index < arena.hamsters.length; index++) {
    const slot = (arena.tick + index) % arena.hamsters.length, p = arena.hamsters[slot];
    if (p.tube || p.wheel || p.wheelTransition || p.eat || p.drink || nearWater(p) || p.pouch.length >= 5 || p.fallSpeed > 0) continue;
    for (const food of [...arena.foods]) {
      if (p.pouch.length >= 5) break;
      if (arena.tick < food.readyAt || Math.abs(food.y - p.y) > .45 || Math.hypot(food.x - p.x, food.z - p.z) >= .65) continue;
      p.pouch.push(food.type); event({ type: 'collect', slot, foodType: food.type });
      if (food.expires) arena.foods.splice(arena.foods.indexOf(food), 1); else spawnFood(arena, food);
    }
  }
  const elapsed = arena.tick - COUNTDOWN_TICKS;
  if (elapsed > 0 && elapsed % (30 / STEP) === 0 && elapsed < ROUND_TICKS) snackBloom(arena);
  if (elapsed >= ROUND_TICKS) { arena.phase = 'results'; arena.hamsters.forEach(p => { p.speed = p.dash = p.eat = p.drink = 0; }); }
  arena.events = arena.events.filter(value => arena.tick - value.tick <= 3 / STEP);
}

export function rankArena(state) {
  return state.hamsters.map((_, i) => i).sort((a, b) => state.hamsters[b].score - state.hamsters[a].score || a - b);
}
export function winners(state) {
  const highest = Math.max(...state.hamsters.map(p => p.score));
  return state.hamsters.flatMap((p, i) => p.score === highest ? [i] : []);
}
export function snapshot(arena) {
  return { id: arena.id, seed: arena.seed, tick: arena.tick, epoch: arena.epoch, phase: arena.phase,
    hamsters: arena.hamsters.map(p => ({ ...p,
      pouch: [...p.pouch], standingTurn: p.standingTurn ? { ...p.standingTurn } : null,
      wheelTransition: !!p.wheelTransition,
      tube: p.tube ? { branch: p.tube.branch, s: p.tube.s, direction: p.tube.direction,
        turn: p.tube.turn ? { elapsed: p.tube.turn.elapsed } : null } : null,
      tubeFrame: p.tube ? tunnelOrientation(p.tube.branch, p.tube.s, p.angle, tunnelTravelPose(p.tube, 1)) : null,
    })), foods: arena.foods.map(f => ({ ...f })), bloom: arena.bloom,
    eventSeq: arena.eventSeq, events: arena.events.map(e => ({ ...e })), inputSeqs: [...arena.inputSeqs] };
}

const finite = value => Number.isFinite(value) && Math.abs(value) < 100000;
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
export function validSnapshot(data) {
  const count = data?.hamsters?.length;
  if (!integer(count, MIN_PLAYERS, MAX_PLAYERS) || typeof data.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(data.id) ||
      !integer(data.seed, 0, 0xffffffff) || !integer(data.tick, 0, COUNTDOWN_TICKS + ROUND_TICKS) || !integer(data.epoch, 0, 10000) ||
      !['countdown', 'playing', 'paused', 'results'].includes(data.phase) || !integer(data.bloom, 0, 5) || !integer(data.eventSeq, 0, 100000) ||
      !Array.isArray(data.inputSeqs) || data.inputSeqs.length !== count || !data.inputSeqs.every(n => integer(n, 0, 1000000))) return false;
  if (!data.hamsters.every(p => p && ['x', 'y', 'z', 'angle', 'speed', 'fallSpeed', 'gait', 'curl', 'pitch', 'bumpX', 'bumpZ'].every(k => finite(p[k])) &&
      p.x >= -11 && p.x <= 20 && p.z >= -9 && p.z <= 9 && p.y >= -.25 && p.y <= 8 && finite(p.energy) && p.energy >= 0 && p.energy <= 100 &&
      integer(p.score, 0, 100000) && integer(p.eaten, 0, 10000) && integer(p.bonuses, 0, 3) && integer(p.drinks, 0, 1000) && integer(p.bumpCount, 0, 10000) &&
      Array.isArray(p.pouch) && p.pouch.length <= 5 && p.pouch.every(n => integer(n, 0, 3)) &&
      ['eat', 'drink', 'drinkCooldown', 'dash', 'dashCooldown', 'shield', 'squeakCooldown', 'wheelProgress'].every(k => finite(p[k]) && p[k] >= 0) &&
      typeof p.wheel === 'boolean' && typeof p.wheelTransition === 'boolean' && integer(p.lastMask, 0, INPUT_MAX) &&
      (p.standingTurn === null || (p.standingTurn && finite(p.standingTurn.angle) && [-1, 1].includes(p.standingTurn.direction) && finite(p.standingTurn.settle))) &&
      (p.tube === null || (p.tube && integer(p.tube.branch, 0, 2) && finite(p.tube.s) && [-1, 1].includes(p.tube.direction) &&
        (p.tube.turn === null || finite(p.tube.turn?.elapsed)) && p.tubeFrame && Array.isArray(p.tubeFrame.quaternion) && p.tubeFrame.quaternion.length === 4 && p.tubeFrame.quaternion.every(finite) &&
        Array.isArray(p.tubeFrame.up) && p.tubeFrame.up.length === 3 && p.tubeFrame.up.every(finite))))) return false;
  return Array.isArray(data.foods) && data.foods.length <= 40 && data.foods.every(f => f && integer(f.id, 1, 100000) && integer(f.type, 0, 3) &&
    ['x', 'y', 'z'].every(k => finite(f[k])) && integer(f.level, 0, 2) && integer(f.expires, 0, 12000) && integer(f.readyAt, 0, 12000)) &&
    Array.isArray(data.events) && data.events.length <= 24 && data.events.every(e => e && integer(e.id, 1, data.eventSeq) && integer(e.tick, 0, data.tick) &&
      ['collect', 'eat', 'drink', 'dash', 'bump', 'squeak', 'bloom', 'wheel-bonus', 'wheel-busy'].includes(e.type) &&
      (e.slot === undefined || integer(e.slot, 0, count - 1)) && (e.target === undefined || integer(e.target, 0, count - 1)) &&
      (e.points === undefined || integer(e.points, 0, 250)) && (e.count === undefined || integer(e.count, 1, 5)) &&
      (e.level === undefined || integer(e.level, 0, 2)) && (e.foodType === undefined || integer(e.foodType, 0, 3)) &&
      (e.dropped === undefined || typeof e.dropped === 'boolean'));
}

/** Connection identity determines the hamster; packets contain only key intentions. */
export function acceptInput(arena, link, packet, now) {
  if (!packet || packet.kind !== 'input' || packet.id !== arena.id || packet.epoch !== arena.epoch ||
      !integer(packet.seq, 1, 1000000) || packet.seq <= link.seq || packet.seq > link.seq + 500 || !integer(packet.mask, 0, INPUT_MAX) ||
      !['playing', 'countdown'].includes(arena.phase)) return false;
  link.seq = packet.seq; link.mask = packet.mask; link.lastInput = now;
  arena.inputSeqs[link.slot] = packet.seq;
  return true;
}
