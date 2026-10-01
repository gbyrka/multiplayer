import { makeTrack } from './track.mjs';
import { STEP, INPUT, cloneRig, deserializeRig, stepWorld, wrap, clamp } from './physics.mjs';
import { COUNTDOWN_TICKS } from './race.mjs';

export function interpolateRig(a, b, fraction) {
  const result = cloneRig(b);
  for (const name of ['car', 'trailer']) {
    for (const key of ['x', 'y', 'vx', 'vy', 'omega', 'steer', 'speed']) result[name][key] = a[name][key] + (b[name][key] - a[name][key]) * fraction;
    result[name].a = a[name].a + wrap(b[name].a - a[name].a) * fraction;
  }
  return result;
}

/** Future tick inputs, authoritative replay, visual correction, remote interpolation. */
export class Prediction {
  constructor(slot) { this.slot = slot; this.frames = new Map(); this.buffer = []; this.correction = null; }
  receive(state, at, rtt = 0, mask = 0) {
    const fresh = this.latest?.id !== state.id;
    if (!fresh && (state.tick < this.latest.tick || state.epoch < this.latest.epoch || state.audioSeq < this.latest.audioSeq)) return false;
    if (!fresh && state.tick === this.latest.tick && state.epoch === this.latest.epoch && state.audioSeq === this.latest.audioSeq && state.phase === this.latest.phase &&
      state.lastReset.every((value, i) => value === this.latest.lastReset[i])) return false;
    const old = this.rigs ? cloneRig(this.rigs[this.slot]) : null;
    if (fresh) {
      this.track = makeTrack(state.seed); this.frames.clear(); this.buffer = []; this.correction = null;
      this.tick = state.tick; this.accumulator = 0;
    }
    if (!fresh && state.epoch !== this.latest.epoch) { this.frames.clear(); this.tick = state.tick; this.accumulator = 0; }
    this.latest = state; this.receivedAt = at;
    const base = state.rigs.map((data, i) => deserializeRig(data, this.track, i));
    this.buffer.push({ tick: state.tick, rigs: base });
    if (this.buffer.length > 40) this.buffer.shift();
    for (const tick of this.frames.keys()) if (tick <= state.tick) this.frames.delete(tick);
    const lead = Math.ceil(clamp(rtt + 75, 75, 600) / (STEP * 1000));
    const target = ['countdown', 'racing'].includes(state.phase) ? Math.max(this.tick, state.tick + lead) : state.tick;
    this.rigs = base.map(cloneRig); this.tick = state.tick;
    while (this.tick < Math.min(target, state.tick + 120)) this.advance(this.frames.get(this.tick + 1) ?? mask);
    if (old && !fresh) {
      this.correction = {};
      for (const name of ['car', 'trailer']) {
        const previous = old[name], current = this.rigs[this.slot][name], existing = this.visualCorrection?.[name];
        const dx = previous.x + (existing?.x ?? 0) - current.x, dy = previous.y + (existing?.y ?? 0) - current.y;
        this.correction[name] = Math.hypot(dx, dy) > 200 ? { x: 0, y: 0, a: 0 } : { x: dx, y: dy, a: wrap(previous.a + (existing?.a ?? 0) - current.a) };
      }
      this.visualCorrection = this.correction;
    }
    return true;
  }

  advance(mask) {
    this.tick++;
    this.frames.set(this.tick, mask);
    if (this.tick < COUNTDOWN_TICKS || !['countdown', 'racing'].includes(this.latest.phase)) return;
    const masks = [...this.latest.masks]; masks[this.slot] = mask;
    for (let i = 0; i < 2; i++) if (this.latest.finished[i] !== null) masks[i] = INPUT.BRAKE;
    stepWorld(this.rigs, masks, this.track, STEP, this.latest.finished.map(time => time !== null));
  }

  update(dt, mask) {
    if (!this.latest || !['countdown', 'racing'].includes(this.latest.phase)) return;
    this.accumulator += Math.min(dt, .1);
    while (this.accumulator >= STEP) {
      if (this.tick < this.latest.tick + 120) this.advance(mask);
      this.accumulator -= STEP;
    }
    if (this.visualCorrection) for (const c of Object.values(this.visualCorrection)) {
      c.x *= Math.exp(-16 * dt); c.y *= Math.exp(-16 * dt); c.a *= Math.exp(-16 * dt);
    }
  }

  packet() {
    return { kind: 'input', id: this.latest.id, epoch: this.latest.epoch, frames: [...this.frames].filter(([tick]) => tick > this.latest.tick).slice(0, 64) };
  }

  display(now) {
    const rigs = this.rigs.map(cloneRig);
    const target = this.latest.tick + (now - this.receivedAt - 110) / (STEP * 1000);
    const b = this.buffer.find(entry => entry.tick >= target) ?? this.buffer.at(-1);
    const index = this.buffer.indexOf(b), a = this.buffer[Math.max(0, index - 1)];
    const fraction = b.tick === a.tick ? 1 : clamp((target - a.tick) / (b.tick - a.tick), 0, 1);
    rigs[1 - this.slot] = interpolateRig(a.rigs[1 - this.slot], b.rigs[1 - this.slot], fraction);
    if (this.visualCorrection) for (const name of ['car', 'trailer']) {
      const c = this.visualCorrection[name]; rigs[this.slot][name].x += c.x; rigs[this.slot][name].y += c.y; rigs[this.slot][name].a += c.a;
    }
    return rigs;
  }
}
