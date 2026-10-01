/** Test driver: plan passes from obstacle geometry, then use ordinary controls. */
import { pointAt, project } from '../games/tow/track.mjs';
import { wrap, INPUT } from '../games/tow/physics.mjs';

export function drivingLine(track) {
  const groups = [];
  for (const obstacle of track.obstacles) {
    if (!groups.length || obstacle.s - groups.at(-1).at(-1).s > 250) groups.push([]);
    groups.at(-1).push(obstacle);
  }
  const line = [{ s: track.start, offset: 0 }];
  for (const group of groups) {
    const lateral = group.reduce((sum, obstacle) => sum + project(track, obstacle.x, obstacle.y).lateral, 0) / group.length;
    const offset = lateral >= 0 ? -85 : 85;
    line.push({ s: group[0].s - 230, offset }, { s: group.at(-1).s + 150, offset });
  }
  line.push({ s: track.finish + 250, offset: line.at(-1).offset });
  return line;
}

export function drivingTarget(track, line, distance) {
  const next = line.findIndex(point => point.s >= distance), b = line[next < 0 ? line.length - 1 : next], a = line[Math.max(0, next - 1)];
  const t = Math.max(0, Math.min(1, (distance - a.s) / Math.max(1, b.s - a.s)));
  const offset = a.offset + (b.offset - a.offset) * t * t * (3 - 2 * t), p = pointAt(track, distance);
  return { x: p.x + p.nx * offset, y: p.y + p.ny * offset };
}

export function drivingMask(track, line, car) {
  const p = project(track, car.x, car.y), speed = Math.hypot(car.vx, car.vy);
  const target = drivingTarget(track, line, p.s + Math.max(80, speed * .42));
  const error = wrap(Math.atan2(target.x - car.x, -(target.y - car.y)) - car.a);
  return (Math.abs(error) > .4 && speed > 230 ? INPUT.BRAKE : INPUT.UP) |
    (error > .018 ? INPUT.RIGHT : error < -.018 ? INPUT.LEFT : 0);
}
