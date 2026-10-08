import { moveTo, waterFixture } from './world.mjs';
import { tunnelEntry, tunnelPose, tunnelBodyGap, stepTunnel } from './tunnel.mjs';
import { createWheelTransition, advanceWheelTransition } from './wheel-transition.mjs';

export const STEP = 1 / 60;
export const INPUT = Object.freeze({ UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, WALK: 16, EAT: 32, DASH: 64, WHEEL: 128, SQUEAK: 256 });
export const INPUT_MAX = 511;
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const damp = (a, b, speed, dt) => a + (b - a) * (1 - Math.exp(-speed * dt));
export const onGround = p => !p.tube && !p.wheel && !p.wheelTransition && p.fallSpeed === 0;

export function makeHamster(slot) {
  return { x: (slot - 1.5) * 1.65, y: 0, z: 5.5, angle: 0, speed: 0, fallSpeed: 0,
    energy: 100, score: 0, pouch: [], eat: 0, drink: 0, drinkCooldown: 0, drinks: 0, eaten: 0,
    tube: null, wheel: false, wheelTransition: null, wheelProgress: 0, bonuses: 0,
    curl: 0, pitch: 0, standingTurn: null, gait: 0,
    dash: 0, dashCooldown: 0, shield: 0, bumpX: 0, bumpZ: 0, lastMask: 0,
    squeakCooldown: 0, bumpCount: 0 };
}

export function nearWater(p) {
  if (!onGround(p) || p.y > .2) return false;
  const [x, , z] = waterFixture.spout;
  return Math.hypot(p.x - Math.sin(p.angle) * .85 - x, p.z - Math.cos(p.angle) * .85 - z) < .32 && -Math.sin(p.angle) > .7;
}

/** Original HAMSTER movement, ramps, falling, tube turns and wheel approach. */
export function stepHamster(p, mask, dt = STEP, { wheelAvailable = true, tunnelBlockers = [], event = () => {}, slot = 0, score = true } = {}) {
  const previousMask = p.lastMask;
  const pressed = bit => !!(mask & bit), tapped = bit => pressed(bit) && !(previousMask & bit);
  const forward = Number(pressed(INPUT.UP)) - Number(pressed(INPUT.DOWN));
  const steer = Number(pressed(INPUT.RIGHT)) - Number(pressed(INPUT.LEFT));
  const walking = pressed(INPUT.WALK), previousAngle = p.angle;
  let forwardBlocked = false;
  for (const field of ['drinkCooldown', 'dashCooldown', 'dash', 'shield', 'squeakCooldown']) p[field] = Math.max(0, p[field] - dt);
  if (tapped(INPUT.SQUEAK) && !p.squeakCooldown) { p.squeakCooldown = 1.5; event({ type: 'squeak', slot }); }
  if (tapped(INPUT.WHEEL) && !p.tube && !p.wheelTransition && (p.wheel || (onGround(p) && p.y < .5 && Math.hypot(p.x - 6, p.z - 3.65) < 1.8))) {
    if (p.wheel || wheelAvailable) {
      p.wheelTransition = createWheelTransition(p, !p.wheel);
      p.speed = p.eat = p.drink = p.dash = 0; p.standingTurn = null;
    } else event({ type: 'wheel-busy', slot });
  }
  p.lastMask = mask;
  if (p.wheelTransition) {
    const transition = p.wheelTransition, next = advanceWheelTransition(transition, dt);
    for (const key of ['x', 'y', 'z', 'angle', 'speed', 'pitch']) p[key] = next[key];
    p.fallSpeed = 0; p.gait += dt * p.speed * 7;
    if (next.turning && Math.abs(next.turnDelta) > .000001) {
      const direction = Math.sign(next.turnDelta);
      if (p.standingTurn?.direction !== direction) p.standingTurn = { angle: 0, direction, settle: 0 };
      p.standingTurn.angle += Math.abs(next.turnDelta);
    } else p.standingTurn = null;
    if (next.finished) { p.wheel = transition.entering; p.wheelTransition = null; p.wheelProgress = 0; p.speed = p.pitch = 0; p.standingTurn = null; }
    return;
  }
  const atWater = nearWater(p), drinking = pressed(INPUT.EAT) && atWater && !p.drinkCooldown;
  const eating = pressed(INPUT.EAT) && p.pouch.length > 0 && !p.wheel && !p.tube?.turn && !atWater && !p.dash;
  if (!drinking) p.drink = 0;
  if (tapped(INPUT.DASH) && onGround(p) && !p.dashCooldown && p.energy >= 12 && !pressed(INPUT.EAT)) {
    p.dash = .32; p.dashCooldown = 4; p.energy -= 12;
    event({ type: 'dash', slot });
  }
  if (!p.tube && !p.wheel && forward > 0 && !p.dash) {
    const branch = tunnelEntry(p.x, p.y, p.z, p.angle);
    if (branch >= 0) {
      const entry = tunnelPose(branch, 0);
      if (tunnelBlockers.every(other => Math.hypot(entry.x - other.x, entry.y - other.y, entry.z - other.z) >= tunnelBodyGap)) {
        p.tube = { branch, s: 0, direction: 1, choice: 0, reverseHeld: false };
      } else forwardBlocked = true;
    }
  }
  if (p.tube) {
    const next = stepTunnel(p.tube, dt, eating ? 0 : forward, eating ? 0 : steer, walking, tunnelBlockers);
    for (const key of ['x', 'y', 'z', 'angle', 'pitch', 'curl', 'speed']) p[key] = next[key];
    p.fallSpeed = 0; p.dash = 0; p.energy = Math.min(100, p.energy + dt * 5);
    if (next.exited) {
      p.x -= Math.sin(p.angle) * .6; p.z -= Math.cos(p.angle) * .6;
      p.tube = null; p.curl = p.pitch = 0; p.shield = Math.max(p.shield, 1);
    }
  } else if (p.wheel) {
    p.speed = forward * (walking ? 1.6 : 3.2); p.eat = 0;
    if (forward) {
      p.energy = Math.min(100, p.energy + dt * 15);
      if (p.bonuses < 3) {
        p.wheelProgress += dt;
        if (p.wheelProgress >= 5) {
          p.wheelProgress -= 5; p.bonuses++;
          if (score) p.score += 10;
          event({ type: 'wheel-bonus', slot, points: 10 });
        }
      }
    }
  } else {
    const running = !walking && p.energy > 3 && forward > 0 && !eating && !drinking && !forwardBlocked;
    if (!drinking) p.angle -= steer * dt * (p.dash ? 1.2 : 2.2);
    const target = p.dash ? 8.5 : eating || drinking || forwardBlocked ? 0 : forward * (running ? 4.5 : 2.4);
    p.speed = damp(p.speed, target, p.dash ? 24 : 10, dt);
    if (eating || drinking || forwardBlocked) p.speed = 0;
    const next = moveTo(p.x - Math.sin(p.angle) * p.speed * dt + p.bumpX * dt,
      p.z - Math.cos(p.angle) * p.speed * dt + p.bumpZ * dt, p.y, p.angle);
    p.x = next.x; p.z = next.z;
    if (next.y >= p.y - .12) { p.y = next.y; p.fallSpeed = 0; }
    else { p.fallSpeed += dt * 16; p.y = Math.max(next.y, p.y - p.fallSpeed * dt); }
    p.bumpX *= Math.exp(-dt * 9); p.bumpZ *= Math.exp(-dt * 9);
    p.energy = clamp(p.energy + dt * (running ? -19 : 7), 0, 100);
    if (drinking) {
      const [x, , z] = waterFixture.spout;
      p.x = damp(p.x, x - .85, 12, dt); p.z = damp(p.z, z, 12, dt);
      p.drink += dt;
      if (p.drink >= 1.2) {
        p.drink = 0; p.drinks++; if (score) p.score += 2;
        p.energy = Math.min(100, p.energy + 8); p.drinkCooldown = 5;
        event({ type: 'drink', slot, points: 2 });
      }
    }
  }
  if (eating) {
    p.eat += dt;
    if (p.eat >= .85 && score) {
      const meal = p.pouch.splice(0), points = meal.reduce((sum, type) => sum + [10, 20, 30, 50][type], 0);
      p.eat = 0; p.score += points; p.eaten += meal.length; p.energy = Math.min(100, p.energy + 12 * meal.length);
      event({ type: 'eat', slot, points, count: meal.length });
    }
  } else p.eat = 0;
  const planted = onGround(p) && !forward && Math.abs(p.speed) < .12 && !eating && !drinking;
  if (planted && steer) {
    const direction = -steer;
    if (p.standingTurn?.direction !== direction) p.standingTurn = { angle: 0, direction, settle: 0 };
    p.standingTurn.angle += Math.abs(p.angle - previousAngle); p.standingTurn.settle = 0;
  } else if (planted && p.standingTurn) {
    p.standingTurn.settle += dt; if (p.standingTurn.settle >= .14) p.standingTurn = null;
  } else p.standingTurn = null;
  p.gait += dt * p.speed * 7;
}
