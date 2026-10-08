import { nearTunnel, tunnelPaths, tunnelRadius } from "./tunnel.mjs";
// Shared geometry for rendering, food placement, and walkable surfaces.
export const decks = [
  { x1: -10, x2: -3, z1: -8, z2: 1, y: 3 },
  { x1: 4, x2: 10, z1: -8, z2: -2, y: 6 },
];
export const ramps = [
  { x1: -8, x2: -5, z1: 1, z2: 7, axis: "z", low: 0, high: 3, reverse: true },
  {
    x1: -3,
    x2: 4,
    z1: -7.5,
    z2: -4.5,
    axis: "x",
    low: 3,
    high: 6,
    reverse: false,
  },
];
export const obstacles = [
  { x: 9.3, z: 5.8, r: 0.5 },
  { x: 6, z: 1.5, r: 2.1 },
];
// These dimensions also drive the visible fixtures in game.js.
export const supports = decks.flatMap(d =>
  [d.x1 + 0.25, d.x2 - 0.25].flatMap(x =>
    [d.z1 + 0.25, d.z2 - 0.25].map(z => ({
      from: [x, 0, z], to: [x, d.y, z], radius: 0.12,
    }))));
export const waterFixture = {
  bottle: { from: [10.55, 1.275, 5.8], to: [10.55, 3.05, 5.8], radius: 0.42 },
  spout: [8.65, 0.62, 5.8],
  nozzle: [
    { from: [10.55, 1.25, 5.8], to: [9.05, 0.76, 5.8], radius: 0.065 },
    { from: [9.05, 0.76, 5.8], to: [8.65, 0.62, 5.8], radius: 0.055 },
  ],
};
// Two open-ended side walls follow each tube. Never put a solid cap across a mouth.
export const tubeWalls = tunnelPaths.flatMap(path => {
  const walls = [];
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i];
    if (Math.min(a.x, b.x) > 12) continue; // only the part reachable from the cage
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const nx = -(b.z - a.z) / length, nz = (b.x - a.x) / length;
    for (const side of [-1, 1]) walls.push({
      from: [a.x + nx * tunnelRadius * side, a.y, a.z + nz * tunnelRadius * side],
      to: [b.x + nx * tunnelRadius * side, b.y, b.z + nz * tunnelRadius * side],
      radius: 0.065,
      bottom: Math.min(a.y, b.y), top: Math.max(a.y, b.y) + tunnelRadius * 2,
    });
  }
  return walls;
});
export const fixtureColliders = [...supports, waterFixture.bottle, ...waterFixture.nozzle, ...tubeWalls];

// Clip rods to the hamster's height before resolving their horizontal capsule.
// This leaves clear space below high fixtures and above platform supports.
function resolveFixture(x, z, y, fixture, radius) {
  const { from: a, to: b, radius: r } = fixture;
  const reach = radius + r;
  if (x < Math.min(a[0], b[0]) - reach || x > Math.max(a[0], b[0]) + reach ||
      z < Math.min(a[2], b[2]) - reach || z > Math.max(a[2], b[2]) + reach) return { x, z };
  let low = 0, high = 1;
  if (fixture.bottom !== undefined) {
    if (y >= fixture.top || y + 1.08 <= fixture.bottom) return { x, z };
  } else {
    const min = y + 0.08 - r, max = y + 1.08 + r, dy = b[1] - a[1];
    if (Math.abs(dy) < 1e-8) {
      if (a[1] < min || a[1] > max) return { x, z };
    } else {
      low = Math.max(0, Math.min((min - a[1]) / dy, (max - a[1]) / dy));
      high = Math.min(1, Math.max((min - a[1]) / dy, (max - a[1]) / dy));
      if (low > high) return { x, z };
    }
    // Flat tops do not protrude through the deck they support.
    if (y >= Math.max(a[1], b[1])) return { x, z };
  }
  const dx = b[0] - a[0], dz = b[2] - a[2];
  const squared = dx * dx + dz * dz;
  const t = squared ? Math.max(low, Math.min(high, ((x - a[0]) * dx + (z - a[2]) * dz) / squared)) : 0;
  const cx = a[0] + dx * t, cz = a[2] + dz * t;
  const distance = Math.hypot(x - cx, z - cz), limit = radius + r;
  if (distance >= limit) return { x, z };
  // Also recover deterministically when a body is exactly on a rod's centreline.
  const nx = distance ? (x - cx) / distance : squared ? -dz / Math.sqrt(squared) : 1;
  const nz = distance ? (z - cz) / distance : squared ? dx / Math.sqrt(squared) : 0;
  return { x: cx + nx * limit, z: cz + nz * limit };
}
// Open-front hut: the doorway is clear, while each timber wall is solid.
export const house = {
  x1: -2.45,
  x2: 0.45,
  z1: -7.15,
  z2: -4.85,
  y: 1.8,
  doorX: -1,
  doorWidth: 1.6,
  thickness: 0.16,
};
export const houseWalls = [
  { x1: house.x1, x2: house.x1 + house.thickness, z1: house.z1, z2: house.z2 },
  { x1: house.x2 - house.thickness, x2: house.x2, z1: house.z1, z2: house.z2 },
  { x1: house.x1, x2: house.x2, z1: house.z1, z2: house.z1 + house.thickness },
  {
    x1: house.x1,
    x2: house.doorX - house.doorWidth / 2,
    z1: house.z2 - house.thickness,
    z2: house.z2,
  },
  {
    x1: house.doorX + house.doorWidth / 2,
    x2: house.x2,
    z1: house.z2 - house.thickness,
    z2: house.z2,
  },
];
export function inHouse(x, z, y = 0) {
  return y < house.y && inside(house, x, z);
}
function resolveWall(x, z, wall, radius) {
  const closestX = Math.max(wall.x1, Math.min(wall.x2, x));
  const closestZ = Math.max(wall.z1, Math.min(wall.z2, z));
  const dx = x - closestX,
    dz = z - closestZ,
    distance = Math.hypot(dx, dz);
  if (distance >= radius) return { x, z };
  if (distance > 0)
    return {
      x: closestX + (dx / distance) * radius,
      z: closestZ + (dz / distance) * radius,
    };
  const exits = [
    { d: x - wall.x1, x: wall.x1 - radius, z },
    { d: wall.x2 - x, x: wall.x2 + radius, z },
    { d: z - wall.z1, x, z: wall.z1 - radius },
    { d: wall.z2 - z, x, z: wall.z2 + radius },
  ];
  return exits.reduce((a, b) => (a.d < b.d ? a : b));
}
export function rampHeight(r, x, z) {
  let t =
    r.axis === "x" ? (x - r.x1) / (r.x2 - r.x1) : (z - r.z1) / (r.z2 - r.z1);
  if (r.reverse) t = 1 - t;
  return r.low + (r.high - r.low) * Math.max(0, Math.min(1, t));
}
export function inside(s, x, z, pad = 0) {
  return (
    x >= s.x1 - pad && x <= s.x2 + pad && z >= s.z1 - pad && z <= s.z2 + pad
  );
}
export function floorAt(x, z, currentY) {
  let y = 0;
  for (const s of decks)
    if (inside(s, x, z) && s.y <= currentY + 0.32) y = Math.max(y, s.y);
  for (const r of ramps) {
    const h = rampHeight(r, x, z);
    if (inside(r, x, z) && h <= currentY + 0.32) y = Math.max(y, h);
  }
  return y;
}
// Only the surface supporting the hamster sets its tilt, never a ramp overhead.
export function surfaceNormal(x, z, y) {
  const floor = floorAt(x, z, y);
  const ramp = ramps.find(
    (r) =>
      inside(r, x, z) &&
      Math.abs(rampHeight(r, x, z) - floor) < 0.001 &&
      Math.abs(y - floor) < 0.05
  );
  if (!ramp) return { x: 0, y: 1, z: 0 };
  const span = ramp.axis === "x" ? ramp.x2 - ramp.x1 : ramp.z2 - ramp.z1;
  const slope = ((ramp.high - ramp.low) / span) * (ramp.reverse ? -1 : 1);
  const length = Math.hypot(slope, 1);
  return {
    x: ramp.axis === "x" ? -slope / length : 0,
    y: 1 / length,
    z: ramp.axis === "z" ? -slope / length : 0,
  };
}
export function moveTo(x, z, y, angle = 0) {
  x = Math.max(-10.5, Math.min(10.5, x));
  z = Math.max(-8.5, Math.min(8.5, z));
  const bodyY = Math.max(y, floorAt(x, z, y));
  const sin = Math.sin(angle), cos = Math.cos(angle);
  // Resolve neighbouring objects together so one contact cannot push through another.
  for (let pass = 0; pass < 6; pass++) {
    if (y < 1) for (const o of obstacles) {
      const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), limit = o.r + 0.38;
      if (d < limit) {
        x = o.x + (d ? dx / d : 1) * limit;
        z = o.z + (d ? dz / d : 0) * limit;
      }
    }
    if (y < house.y) for (const wall of houseWalls) {
      for (const offset of [-0.28, 0.36]) {
        const ox = -sin * offset, oz = -cos * offset;
        const resolved = resolveWall(x + ox, z + oz, wall, 0.48);
        x = resolved.x - ox; z = resolved.z - oz;
      }
    }
    for (const fixture of fixtureColliders) {
      // Overlapping circles cover the head and rump, including while turning.
      for (const offset of [-0.35, 0.3]) {
        const ox = -sin * offset, oz = -cos * offset;
        const resolved = resolveFixture(x + ox, z + oz, bodyY, fixture, 0.48);
        x = resolved.x - ox; z = resolved.z - oz;
      }
    }
    x = Math.max(-10.5, Math.min(10.5, x));
    z = Math.max(-8.5, Math.min(8.5, z));
  }
  return { x, z, y: floorAt(x, z, y) };
}

export function foodSpot(level, random = Math.random) {
  for (let n = 0; n < 100; n++) {
    const d = level
      ? decks[level - 1]
      : { x1: -9.7, x2: 9.7, z1: -7.7, z2: 7.7, y: 0 };
    const x = d.x1 + 0.5 + random() * (d.x2 - d.x1 - 1),
      z = d.z1 + 0.5 + random() * (d.z2 - d.z1 - 1);
    if (nearTunnel(x, d.y, z, 1.15)) continue;
    if (
      !level &&
      (inside(house, x, z, 0.7) ||
        obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 1) ||
        decks.some((s) => inside(s, x, z, 0.5)) ||
        ramps.some((s) => inside(s, x, z, 0.5)))
    )
      continue;
    return { x, z, y: d.y };
  }
  return level
    ? {
        x: decks[level - 1].x1 + 1,
        z: decks[level - 1].z1 + 1,
        y: decks[level - 1].y,
      }
    : { x: 0, z: 5, y: 0 };
}
