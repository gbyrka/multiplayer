import { clamp, INPUT, wrap } from './physics.mjs';
import { COUNTDOWN_TICKS } from './race.mjs';

/** Mix around the driver's car, matching the fixed world orientation of the view. */
export function spatialMix(source, listener, own = false) {
  if (own) return { gain: 1, pan: 0, doppler: 1 };
  const dx = source.x - listener.x, dy = source.y - listener.y, distance = Math.hypot(dx, dy);
  const radial = distance ? (((source.vx ?? 0) - (listener.vx ?? 0)) * dx + ((source.vy ?? 0) - (listener.vy ?? 0)) * dy) / distance * 4.5 / 64 : 0;
  return { gain: Math.max(0, 1 - distance / 2200) / (1 + (distance / 320) ** 2),
    pan: clamp(dx / Math.max(180, distance), -.9, .9), doppler: clamp(343 / (343 + radial), .9, 1.1) };
}

const SHIFTS = [0, 95, 180, 280, 385, Infinity];
export function engineGear(speed, previous = 1) {
  if (speed < -2) return 0;
  let gear = Math.max(1, previous);
  while (gear < 5 && speed > SHIFTS[gear] + 9) gear++;
  while (gear > 1 && speed < SHIFTS[gear - 1] - 18) gear--;
  return gear;
}

export function vehicleSound(rig, mask, gear) {
  const car = rig.car, trailer = rig.trailer, speed = Math.abs(car.speed);
  const braking = car.braking || !!(mask & INPUT.BRAKE);
  const throttle = !braking && ((car.speed >= -2 && !!(mask & INPUT.UP)) || (car.speed < -2 && !!(mask & INPUT.DOWN))) ? 1 : 0;
  const ratio = gear === 0 ? 39 : [0, 32, 19, 13, 10, 8.3][gear];
  const rpm = clamp(900 + speed * ratio + throttle * 370, 850, 6200);
  const slip = Math.abs(car.vx * Math.cos(car.a) + car.vy * Math.sin(car.a));
  const tailSlip = Math.abs(trailer.vx * Math.cos(trailer.a) + trailer.vy * Math.sin(trailer.a));
  const rolling = clamp(speed / 455, 0, 1);
  const skid = Math.max(clamp((speed * Math.abs(car.omega) - 210) / 680, 0, 1), clamp((slip + tailSlip * .4 - 12) / 70, 0, 1),
    braking ? clamp((speed - 130) / 400, 0, .5) : 0) * clamp((speed - 35) / 100, 0, 1);
  const rattle = clamp((Math.abs(wrap(trailer.a - car.a)) * .35 + Math.abs(trailer.omega - car.omega) * .2) * rolling, 0, 1);
  return { rpm, throttle, rolling, skid, rattle, reversing: car.speed < -9 };
}

/** Advance even when muted/hidden, so old effects never play on returning. */
export class SoundTimeline {
  receive(state) {
    const fresh = state.id !== this.id;
    if (!fresh && (state.tick < this.tick || state.audioSeq < this.sequence)) return [];
    if (fresh) {
      this.id = state.id; this.sequence = 0; this.tick = state.tick; this.count = 0; this.go = state.tick >= COUNTDOWN_TICKS;
      this.finished = state.finished.map(() => null); this.gates = [...state.nextGate]; this.resets = [...state.lastReset];
    }
    const events = [];
    if (state.phase === 'countdown') {
      const count = Math.max(1, Math.ceil((COUNTDOWN_TICKS - state.tick) / 120));
      if (count !== this.count && count <= 3) { events.push({ type: 'countdown', count }); this.count = count; }
    }
    if (state.phase === 'racing' && !this.go) { events.push({ type: 'go' }); this.go = true; }
    for (const event of state.audioEvents) if (event.id > this.sequence && state.tick - event.tick <= 90) events.push(event);
    for (let slot = 0; slot < state.rigs.length; slot++) {
      if (state.finished[slot] !== null && this.finished[slot] === null) events.push({ type: 'finish', slot });
      else if (state.nextGate[slot] > this.gates[slot]) events.push({ type: 'checkpoint', slot });
      if (state.lastReset[slot] > this.resets[slot]) events.push({ type: 'reset', slot });
    }
    this.sequence = state.audioSeq; this.tick = state.tick;
    this.finished = [...state.finished]; this.gates = [...state.nextGate]; this.resets = [...state.lastReset];
    return events;
  }
}
