import { STEP, stepHamster } from './physics.mjs';

const copy = value => structuredClone(value);
const angleLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/** Local ground prediction; special tube/wheel paths follow authoritative poses. */
export class Prediction {
  constructor(slot) { this.slot = slot; this.seq = 0; this.offset = { x: 0, y: 0, z: 0 }; }
  receive(state, at, rtt, mask) {
    if (this.state?.id === state.id && (state.epoch < this.state.epoch || (state.epoch === this.state.epoch && state.tick <= this.state.tick))) return false;
    const old = this.local, fresh = this.state?.id !== state.id || this.state?.epoch !== state.epoch;
    this.previous = fresh ? state : this.state;
    this.state = state; this.receivedAt = at; this.local = copy(state.hamsters[this.slot]);
    this.accumulator = 0;
    if (state.phase === 'playing' && !this.local.tube && !this.local.wheel && !this.local.wheelTransition) {
      for (let t = 0; t < Math.min(.12, rtt / 2000); t += STEP) stepHamster(this.local, mask, STEP, { score: false });
    }
    if (!fresh && old && Math.hypot(old.x - this.local.x, old.z - this.local.z) < 1) {
      this.offset.x += old.x - this.local.x; this.offset.y += old.y - this.local.y; this.offset.z += old.z - this.local.z;
    } else this.offset = { x: 0, y: 0, z: 0 };
    if (fresh) this.local.lastMask = mask;
    return true;
  }
  update(dt, mask) {
    if (!this.state || this.state.phase !== 'playing' || performance.now() - this.receivedAt > 350) return;
    this.accumulator = Math.min(.1, this.accumulator + dt);
    while (this.accumulator >= STEP) {
      if (!this.local.tube && !this.local.wheel && !this.local.wheelTransition) stepHamster(this.local, mask, STEP, { score: false });
      this.accumulator -= STEP;
    }
    for (const key of ['x', 'y', 'z']) this.offset[key] *= Math.exp(-dt * 16);
  }
  packet(mask) { return { kind: 'input', id: this.state.id, epoch: this.state.epoch, seq: ++this.seq, mask }; }
  display(now) {
    const state = this.state;
    if (state.phase !== 'playing') return state.hamsters;
    const t = Math.min(1, Math.max(0, (now - this.receivedAt) / 50));
    return state.hamsters.map((p, slot) => {
      if (slot === this.slot && !p.tube && !p.wheel && !p.wheelTransition) return { ...p, x: this.local.x + this.offset.x,
        y: this.local.y + this.offset.y, z: this.local.z + this.offset.z, angle: this.local.angle, speed: this.local.speed,
        standingTurn: this.local.standingTurn, gait: this.local.gait };
      const old = this.previous.hamsters[slot];
      return { ...p, x: old.x + (p.x - old.x) * t, y: old.y + (p.y - old.y) * t, z: old.z + (p.z - old.z) * t,
        angle: angleLerp(old.angle, p.angle, t), gait: old.gait + (p.gait - old.gait) * t };
    });
  }
}
