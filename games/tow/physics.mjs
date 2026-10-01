import { pointAt, project } from './track.mjs';

export const STEP = 1 / 120;
export const INPUT = Object.freeze({ UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, BRAKE: 16 });
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const cross = (x, y, u, v) => x * v - y * u;
const approach = (value, target, amount) => value + clamp(target - value, -amount, amount);

function body(x, y, a, w, h, mass) {
  return { x, y, a, w, h, vx: 0, vy: 0, omega: 0, im: 1 / mass, ii: 12 / (mass * (w * w + h * h)), steer: 0, speed: 0, braking: false };
}

export function makeRig(track, slot, distance = track.start, players = 2) {
  const spacing = players === 2 ? 112 : players === 3 ? 88 : 74;
  const p = pointAt(track, distance), offset = (slot - (players - 1) / 2) * spacing;
  const car = body(p.x + p.nx * offset, p.y + p.ny * offset, p.a, 34, 64, 1200);
  const trailer = body(car.x - Math.sin(p.a) * 94, car.y + Math.cos(p.a) * 94, p.a, 32, 58, 450);
  return { car, trailer };
}

export function cloneRig(rig) { return { car: { ...rig.car }, trailer: { ...rig.trailer } }; }
export function hitch(car) { return { x: car.x - Math.sin(car.a) * 40, y: car.y + Math.cos(car.a) * 40 }; }
export function corners(b) {
  const cos = Math.cos(b.a), sin = Math.sin(b.a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({ x: b.x + x * b.w / 2 * cos - y * b.h / 2 * sin, y: b.y + x * b.w / 2 * sin + y * b.h / 2 * cos }));
}

/** SAT plus the intersection polygon gives a contact with the correct lever arm. */
export function contact(a, b) {
  if (Math.hypot(a.x - b.x, a.y - b.y) > (a.w + a.h + b.w + b.h) / 2) return null;
  const pa = corners(a), pb = corners(b);
  let depth = Infinity, nx = 0, ny = 0;
  for (const shape of [pa, pb]) for (let i = 0; i < 2; i++) {
    const p = shape[i], q = shape[i + 1], length = Math.hypot(q.x - p.x, q.y - p.y);
    let ax = (p.y - q.y) / length, ay = (q.x - p.x) / length;
    if ((b.x - a.x) * ax + (b.y - a.y) * ay < 0) { ax = -ax; ay = -ay; }
    const ad = pa.map(v => v.x * ax + v.y * ay), bd = pb.map(v => v.x * ax + v.y * ay);
    const overlap = Math.min(Math.max(...ad), Math.max(...bd)) - Math.max(Math.min(...ad), Math.min(...bd));
    if (overlap <= 0) return null;
    if (overlap < depth) { depth = overlap; nx = ax; ny = ay; }
  }
  let polygon = pa;
  for (let i = 0; i < 4 && polygon.length; i++) {
    const p = pb[i], q = pb[(i + 1) % 4], ex = q.x - p.x, ey = q.y - p.y;
    const side = v => cross(ex, ey, v.x - p.x, v.y - p.y);
    const output = [];
    for (let j = 0; j < polygon.length; j++) {
      const u = polygon[j], v = polygon[(j + 1) % polygon.length], du = side(u), dv = side(v);
      if (du >= 0) output.push(u);
      if ((du >= 0) !== (dv >= 0)) { const t = du / (du - dv); output.push({ x: u.x + t * (v.x - u.x), y: u.y + t * (v.y - u.y) }); }
    }
    polygon = output;
  }
  const x = polygon.length ? polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length : (a.x + b.x) / 2;
  const y = polygon.length ? polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length : (a.y + b.y) / 2;
  return { nx, ny, depth, x, y };
}

function applyImpulse(b, x, y, ix, iy) {
  b.vx += ix * b.im; b.vy += iy * b.im;
  b.omega += cross(x - b.x, y - b.y, ix, iy) * b.ii;
}

function resolve(a, b, c) {
  const raX = c.x - a.x, raY = c.y - a.y, rbX = c.x - b.x, rbY = c.y - b.y;
  const dx = b.vx - b.omega * rbY - a.vx + a.omega * raY;
  const dy = b.vy + b.omega * rbX - a.vy - a.omega * raX;
  const vn = dx * c.nx + dy * c.ny;
  const armA = cross(raX, raY, c.nx, c.ny), armB = cross(rbX, rbY, c.nx, c.ny);
  const effective = a.im + b.im + armA * armA * a.ii + armB * armB * b.ii;
  if (vn < 0 && effective > 0) {
    const impulse = -(1.12 * vn) / effective;
    applyImpulse(a, c.x, c.y, -impulse * c.nx, -impulse * c.ny);
    applyImpulse(b, c.x, c.y, impulse * c.nx, impulse * c.ny);
    const tx = -c.ny, ty = c.nx, tA = cross(raX, raY, tx, ty), tB = cross(rbX, rbY, tx, ty);
    const friction = clamp(-(dx * tx + dy * ty) / (a.im + b.im + tA * tA * a.ii + tB * tB * b.ii), -impulse * .3, impulse * .3);
    applyImpulse(a, c.x, c.y, -friction * tx, -friction * ty);
    applyImpulse(b, c.x, c.y, friction * tx, friction * ty);
  }
  const correction = Math.max(0, c.depth - .025) * .65 / (a.im + b.im);
  a.x -= c.nx * correction * a.im; a.y -= c.ny * correction * a.im;
  b.x += c.nx * correction * b.im; b.y += c.ny * correction * b.im;
  return Math.max(0, -vn);
}

const staticBody = b => ({ ...b, vx: 0, vy: 0, omega: 0, im: 0, ii: 0 });

function anchors(rig) {
  const a = rig.car, b = rig.trailer;
  return { a, b, ax: -Math.sin(a.a) * 40, ay: Math.cos(a.a) * 40, bx: Math.sin(b.a) * 54, by: -Math.cos(b.a) * 54 };
}

function jointVelocity(rig) {
  const { a, b, ax, ay, bx, by } = anchors(rig);
  const vx = b.vx - b.omega * by - a.vx + a.omega * ay, vy = b.vy + b.omega * bx - a.vy - a.omega * ax;
  const kxx = a.im + b.im + ay * ay * a.ii + by * by * b.ii;
  const kyy = a.im + b.im + ax * ax * a.ii + bx * bx * b.ii;
  const kxy = -ax * ay * a.ii - bx * by * b.ii, determinant = kxx * kyy - kxy * kxy;
  const ix = (-kyy * vx + kxy * vy) / determinant, iy = (kxy * vx - kxx * vy) / determinant;
  applyImpulse(a, a.x + ax, a.y + ay, -ix, -iy); applyImpulse(b, b.x + bx, b.y + by, ix, iy);
}

function jointPosition(rig) {
  const { a, b, ax, ay, bx, by } = anchors(rig);
  const dx = b.x + bx - a.x - ax, dy = b.y + by - a.y - ay;
  const kxx = a.im + b.im + ay * ay * a.ii + by * by * b.ii;
  const kyy = a.im + b.im + ax * ax * a.ii + bx * bx * b.ii;
  const kxy = -ax * ay * a.ii - bx * by * b.ii, determinant = kxx * kyy - kxy * kxy;
  const ix = (-kyy * dx + kxy * dy) / determinant * .8, iy = (kxy * dx - kxx * dy) / determinant * .8;
  a.x -= ix * a.im; a.y -= iy * a.im; a.a -= cross(ax, ay, ix, iy) * a.ii;
  b.x += ix * b.im; b.y += iy * b.im; b.a += cross(bx, by, ix, iy) * b.ii;
  const relative = wrap(b.a - a.a), excess = relative - clamp(relative, -1.4, 1.4);
  a.a += excess * .2; b.a -= excess * .8;
}

function drive(rig, mask, dt) {
  const car = rig.car, fx = Math.sin(car.a), fy = -Math.cos(car.a), rx = Math.cos(car.a), ry = Math.sin(car.a);
  const speed = car.vx * fx + car.vy * fy, sideways = car.vx * rx + car.vy * ry;
  const up = !!(mask & INPUT.UP), down = !!(mask & INPUT.DOWN), throttle = Number(up) - Number(down);
  car.braking = !!(mask & INPUT.BRAKE) || (up && down) || (throttle !== 0 && speed * throttle < -1);
  let acceleration = throttle * (throttle > 0 ? 325 : 185);
  if (car.braking) acceleration = (approach(speed, 0, 640 * dt) - speed) / dt;
  if ((speed >= 455 && acceleration > 0) || (speed <= -85 && acceleration < 0)) acceleration = 0;
  const resistance = 10 + Math.abs(speed) * .075 + speed * speed * .00012;
  acceleration += (approach(speed, 0, resistance * dt) - speed) / dt;
  const lateral = (Math.exp(-9 * dt) - 1) * sideways / dt;
  car.vx += (fx * acceleration + rx * lateral) * dt; car.vy += (fy * acceleration + ry * lateral) * dt;
  const steering = Number(!!(mask & INPUT.RIGHT)) - Number(!!(mask & INPUT.LEFT));
  car.steer = approach(car.steer, steering * (.61 / (1 + Math.abs(speed) / 360)), (steering ? 2.3 : 2.9) * dt);
  const wantedOmega = speed / 43 * Math.tan(car.steer);
  car.omega += (wantedOmega - car.omega) * (1 - Math.exp(-8 * dt));
  const trailer = rig.trailer, tx = Math.cos(trailer.a), ty = Math.sin(trailer.a);
  const slip = trailer.vx * tx + trailer.vy * ty, damping = 1 - Math.exp(-11 * dt);
  trailer.vx -= tx * slip * damping; trailer.vy -= ty * slip * damping;
  trailer.vx *= Math.exp(-.07 * dt); trailer.vy *= Math.exp(-.07 * dt);
  trailer.omega *= Math.exp(-.35 * dt);
}

function roadCollision(b, track, report, slot) {
  let deepest;
  for (const p of corners(b)) {
    const road = project(track, p.x, p.y), depth = road.distance - track.halfWidth;
    if (depth > 0 && (!deepest || depth > deepest.depth)) {
      deepest = { x: p.x, y: p.y, nx: (p.x - road.x) / road.distance, ny: (p.y - road.y) / road.distance, depth };
    }
  }
  if (deepest) {
    const speed = resolve(b, staticBody({ x: deepest.x, y: deepest.y }), deepest);
    if (report && speed > 18) report({ x: deepest.x, y: deepest.y, speed, slots: [slot], kind: 'curb' });
  }
  for (const obstacle of track.obstacles) {
    if (Math.abs(obstacle.y - b.y) > 100 || Math.abs(obstacle.x - b.x) > 100) continue;
    const c = contact(b, obstacle);
    if (c) {
      const speed = resolve(b, staticBody(obstacle), c);
      if (report && speed > 18) report({ x: c.x, y: c.y, speed, slots: [slot], kind: 'obstacle' });
    }
  }
}

/** Shared fixed-step simulation: joint, tyre grip, linear/angular collision impulses. */
export function stepWorld(rigs, masks, track, dt = STEP, ghosts = [], report = null) {
  rigs.forEach((rig, i) => drive(rig, masks[i] ?? 0, dt));
  for (let iteration = 0; iteration < 5; iteration++) rigs.forEach(jointVelocity);
  for (const rig of rigs) for (const b of [rig.car, rig.trailer]) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.a = wrap(b.a + b.omega * dt);
  }
  for (let iteration = 0; iteration < 5; iteration++) {
    for (let slot = 0; slot < rigs.length; slot++) {
      const rig = rigs[slot];
      jointPosition(rig);
      roadCollision(rig.car, track, report, slot); roadCollision(rig.trailer, track, report, slot);
      const c = contact(rig.car, rig.trailer);
      if (c) {
        const speed = resolve(rig.car, rig.trailer, c);
        if (report && speed > 18) report({ x: c.x, y: c.y, speed, slots: [slot], kind: 'trailer' });
      }
    }
    for (let i = 0; i < rigs.length; i++) for (let j = i + 1; j < rigs.length; j++) {
      if (ghosts[i] || ghosts[j]) continue;
      for (const a of [rigs[i].car, rigs[i].trailer]) for (const b of [rigs[j].car, rigs[j].trailer]) {
        const c = contact(a, b);
        if (c) {
          const speed = resolve(a, b, c);
          if (report && speed > 18) report({ x: c.x, y: c.y, speed, slots: [i, j], kind: 'vehicle' });
        }
      }
    }
    rigs.forEach(jointVelocity);
  }
  for (const rig of rigs) for (const b of [rig.car, rig.trailer]) {
    b.a = wrap(b.a); b.omega = clamp(b.omega, -8, 8);
    const speed = Math.hypot(b.vx, b.vy);
    if (speed > 700) { b.vx *= 700 / speed; b.vy *= 700 / speed; }
    b.speed = b.vx * Math.sin(b.a) - b.vy * Math.cos(b.a);
  }
}

export function hitchError(rig) {
  const h = hitch(rig.car), b = rig.trailer;
  return Math.hypot(h.x - b.x - Math.sin(b.a) * 54, h.y - b.y + Math.cos(b.a) * 54);
}

export function serializeRig(rig) {
  return [rig.car, rig.trailer].map(b => [b.x, b.y, b.a, b.vx, b.vy, b.omega, b.steer, b.braking ? 1 : 0]);
}
export function deserializeRig(data, track, slot, players = 2) {
  const rig = makeRig(track, slot, track.start, players);
  [rig.car, rig.trailer].forEach((b, i) => {
    [b.x, b.y, b.a, b.vx, b.vy, b.omega, b.steer] = data[i]; b.braking = data[i][7] === 1;
    b.speed = b.vx * Math.sin(b.a) - b.vy * Math.cos(b.a);
  });
  return rig;
}
