/** A seeded, open road. Monotonic longitudinal coordinates prevent crossings. */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

export function makeTrack(seed) {
  const random = seededRandom(seed), points = [];
  const extent = 22000, targetLength = 24000 + random() * 5000;
  const waves = [
    { amplitude: 650 + random() * 500, cycles: 3 + random() * 2, phase: random() * 6.28 },
    { amplitude: 170 + random() * 200, cycles: 7 + random() * 3, phase: random() * 6.28 },
  ];
  const winding = t => waves.reduce((sum, w) => sum + w.amplitude * Math.sin(t * Math.PI * 2 * w.cycles + w.phase), 0);
  for (let i = 0; i <= 440; i++) {
    const t = i / 440, y = t * extent;
    const ramp = Math.min(1, y / 1300, (extent - y) / 1300);
    const smooth = ramp * ramp * (3 - 2 * ramp);
    points.push({ x: winding(t) * smooth, y: -y, s: 0 });
  }
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  const scale = targetLength / length;
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    points[i].x *= scale; points[i].y *= scale;
    if (i) s += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    points[i].s = s;
  }
  const track = { seed, points, length: s, halfWidth: 172, start: 260, finish: s - 380, obstacles: [] };
  track.gates = [];
  for (let distance = 1800; distance < track.finish - 500; distance += 1800) track.gates.push(distance);
  track.gates.push(track.finish);
  // Each cluster occupies one lateral band. Leave room to pass with a trailer
  // and to change sides between clusters; keep the starting grid and finish clear.
  let station = 0;
  for (let distance = 1150; distance < track.finish - 1000; distance += 850 + random() * 250, station++) {
    const side = random() < .5 ? -1 : 1, count = 4 + Math.floor(random() * 3);
    const offset = station % 3 === 0 ? (random() - .5) * 24 :
      side * (station % 3 === 1 ? 52 + random() * 22 : 124 + random() * 10);
    for (let n = 0; n < count; n++) {
      const p = pointAt(track, distance + n * 48), lateral = offset + (random() - .5) * 10;
      track.obstacles.push({ x: p.x + p.nx * lateral, y: p.y + p.ny * lateral,
        a: p.a + (random() - .5) * .25, w: 30 + random() * 10, h: 30 + random() * 12,
        kind: random() < .7 ? 'barrel' : 'crate', s: distance + n * 48 });
    }
  }
  track.bounds = { minX: Math.min(...points.map(p => p.x)) - 220, maxX: Math.max(...points.map(p => p.x)) + 220,
    minY: points.at(-1).y - 220, maxY: 220 };
  return track;
}

export function pointAt(track, distance) {
  const { points } = track;
  distance = Math.max(0, Math.min(track.length, distance));
  let low = 0, high = points.length - 1;
  while (high - low > 1) { const mid = (low + high) >> 1; if (points[mid].s <= distance) low = mid; else high = mid; }
  const p = points[low], q = points[high], length = q.s - p.s, t = (distance - p.s) / length;
  const tx = (q.x - p.x) / length, ty = (q.y - p.y) / length;
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, tx, ty, nx: -ty, ny: tx, a: Math.atan2(tx, -ty), s: distance };
}

/** Binary search by Y followed by nearby segments: constant-size collision work. */
export function project(track, x, y) {
  const points = track.points;
  let low = 0, high = points.length - 1;
  while (high - low > 1) { const mid = (low + high) >> 1; if (points[mid].y > y) low = mid; else high = mid; }
  let result, best = Infinity;
  for (let i = Math.max(0, low - 12); i < Math.min(points.length - 1, high + 12); i++) {
    const p = points[i], q = points[i + 1], dx = q.x - p.x, dy = q.y - p.y, length2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / length2));
    const px = p.x + dx * t, py = p.y + dy * t, distance2 = (x - px) ** 2 + (y - py) ** 2;
    if (distance2 < best) {
      best = distance2;
      const length = Math.sqrt(length2), nx = -dy / length, ny = dx / length;
      result = { x: px, y: py, s: p.s + t * length, nx, ny, tx: dx / length, ty: dy / length,
        lateral: (x - px) * nx + (y - py) * ny, distance: Math.sqrt(distance2), a: Math.atan2(dx, -dy) };
    }
  }
  return result;
}
