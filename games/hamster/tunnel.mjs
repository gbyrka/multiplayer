// Shared, arc-length sampled paths: the renderer and movement use the same tube.
export const tunnelRadius = 0.72;
const junction = [15, 0, 0];
const controls = [
  [
    [9, 6, -4],
    [13, 6, -4],
    [17, 6, -5],
    [17, 4, -3],
  ],
  [[9, 0, -7], [16, 0, -7], [15, 0, -3], junction],
  [[9, 0, 7], [16, 0, 7], [15, 0, 3], junction],
];
function bezier(c, t) {
  const u = 1 - t;
  return c[0].map(
    (_, k) =>
      u ** 3 * c[0][k] +
      3 * u * u * t * c[1][k] +
      3 * u * t * t * c[2][k] +
      t ** 3 * c[3][k]
  );
}
export const tunnelPaths = controls.map((c, index) => {
  const curves =
    index === 0 ? [c, [c[3], [17, 2, -1], [17, 0, 0], junction]] : [c];
  const points = [];
  let length = 0;
  for (const curve of curves)
    for (let i = points.length ? 1 : 0; i <= 100; i++) {
      const [x, y, z] = bezier(curve, i / 100);
      const prev = points.at(-1);
      if (prev) length += Math.hypot(x - prev.x, y - prev.y, z - prev.z);
      points.push({ x, y, z, s: length });
    }
  return { points, length };
});
export function tunnelPose(branch, s, direction = 1) {
  return pathPose(tunnelPaths[branch], s, direction);
}
function pathPose(path, s, direction = 1) {
  s = Math.max(0, Math.min(path.length, s));
  const i = Math.max(
    1,
    path.points.findIndex((p) => p.s >= s)
  );
  const a = path.points[i - 1],
    b = path.points[i];
  const t = (s - a.s) / (b.s - a.s);
  const dx = (b.x - a.x) * direction,
    dy = (b.y - a.y) * direction,
    dz = (b.z - a.z) * direction;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    angle: Math.atan2(-dx, -dz),
    pitch: Math.atan2(dy, Math.hypot(dx, dz)),
  };
}
export function tunnelEntry(x, y, z, angle) {
  return tunnelPaths.findIndex((path, branch) => {
    const p = tunnelPose(branch, 0);
    return (
      Math.hypot(x - p.x, z - p.z) < 0.55 &&
      Math.abs(y - p.y) < 0.25 &&
      Math.cos(angle - p.angle) > 0.7
    );
  });
}
export function nearTunnel(x, y, z, clearance = 1) {
  return tunnelPaths.some((path) =>
    path.points.some(
      (p) => Math.abs(y - p.y) < 1 && Math.hypot(x - p.x, z - p.z) < clearance
    )
  );
}
export function tunnelBranch(branch, steer) {
  const incoming = tunnelPose(branch, tunnelPaths[branch].length).angle;
  const options = tunnelPaths
    .map((p, i) => ({ branch: i, angle: tunnelPose(i, p.length, -1).angle }))
    .filter((p) => p.branch !== branch)
    .map((p) => ({
      ...p,
      turn: Math.atan2(
        Math.sin(p.angle - incoming),
        Math.cos(p.angle - incoming)
      ),
    }))
    .sort((a, b) => a.turn - b.turn);
  return options[steer < 0 ? 1 : 0].branch;
}
// Round the fork inside the overlapping tubes, with tangents matching both arms.
const forkInset = 0.8;
function createFork(branch, target) {
  const start = tunnelPaths[branch].length - forkInset;
  const end = tunnelPaths[target].length - forkInset;
  const a = tunnelPose(branch, start), b = tunnelPose(target, end, -1);
  const tangent = (p) => [
    -Math.sin(p.angle) * Math.cos(p.pitch), Math.sin(p.pitch),
    -Math.cos(p.angle) * Math.cos(p.pitch),
  ];
  const av = tangent(a), bv = tangent(b);
  const from = [a.x, a.y, a.z], to = [b.x, b.y, b.z];
  const handle = Math.hypot(...from.map((v, i) => to[i] - v)) * 0.4;
  const curve = [from, from.map((v, i) => v + av[i] * handle),
    to.map((v, i) => v - bv[i] * handle), to];
  const points = [];
  let length = 0;
  for (let i = 0; i <= 100; i++) {
    const [x, y, z] = bezier(curve, i / 100), prev = points.at(-1);
    if (prev) length += Math.hypot(x - prev.x, y - prev.y, z - prev.z);
    points.push({ x, y, z, s: length });
  }
  return { branch, target, start, end, points, length, s: 0 };
}
export function tunnelTravelPose(tube, direction = tube.direction) {
  return tube.fork
    ? pathPose(tube.fork, tube.fork.s, direction)
    : tunnelPose(tube.branch, tube.s, direction);
}
function advanceTunnel(tube, distance) {
  if (!tube.fork) {
    tube.s += distance * tube.direction;
    const start = tunnelPaths[tube.branch].length - forkInset;
    if (tube.direction < 0 || tube.s < start) return;
    tube.fork = createFork(tube.branch, tunnelBranch(tube.branch, tube.choice || 1));
    distance = tube.s - start;
    tube.s = start;
    tube.choice = 0;
  }
  const fork = tube.fork;
  fork.s += distance * tube.direction;
  if (fork.s >= fork.length) {
    tube.branch = fork.target;
    tube.s = fork.end - (fork.s - fork.length);
    tube.direction = -1;
    tube.fork = null;
  } else if (fork.s < 0) {
    tube.branch = fork.branch;
    tube.s = fork.start + fork.s;
    tube.direction = -1;
    tube.fork = null;
  }
}
// One press starts one turn. Shortening follows the angle throughout the pivot.
export function stepTunnel(tube, dt, forward, steer, walk = false) {
  if (steer) tube.choice = steer;
  if (forward < 0 && !tube.reverseHeld && !tube.turn)
    tube.turn = {
      elapsed: 0,
      angle: tunnelTravelPose(tube).angle,
    };
  tube.reverseHeld = forward < 0;
  let curl = 0,
    speed = 0,
    turnAngle;
  if (tube.turn) {
    tube.turn.elapsed += dt;
    const t = Math.min(1, tube.turn.elapsed / 1.15);
    const pivot = t * t * (3 - 2 * t);
    curl = Math.sin(Math.PI * pivot);
    turnAngle = tube.turn.angle + Math.PI * pivot;
    if (t >= 1) {
      tube.direction *= -1;
      tube.turn = null;
    }
  } else if (forward > 0) {
    speed = walk ? 1.35 : 2.5;
    advanceTunnel(tube, speed * dt);
  }
  const pose = tunnelTravelPose(tube);
  if (turnAngle !== undefined) pose.angle = turnAngle;
  return { ...pose, curl, speed, exited: tube.s < 0 };
}

// Yaw around the tube's own floor normal, including midway through a U-turn.
// Composition: world yaw * tube slope * local turn. Reversing never flips up.
export function tunnelOrientation(branch, s, angle, base = tunnelPose(branch, s)) {
  const turn = angle - base.angle;
  const cy = Math.cos(base.angle / 2),
    sy = Math.sin(base.angle / 2);
  const cp = Math.cos(base.pitch / 2),
    sp = Math.sin(base.pitch / 2);
  const ct = Math.cos(turn / 2),
    st = Math.sin(turn / 2);
  return {
    quaternion: [
      sp * (cy * ct + sy * st),
      cp * (sy * ct + cy * st),
      sp * (cy * st - sy * ct),
      cp * (cy * ct - sy * st),
    ],
    up: [
      Math.sin(base.angle) * Math.sin(base.pitch),
      Math.cos(base.pitch),
      Math.cos(base.angle) * Math.sin(base.pitch),
    ],
  };
}

// Three paws support the body while one repositions along the turning arc.
// Anchors are fixed in the tube floor frame during stance, preventing skating.
export function tunnelTurnPaw(index, progress) {
  const p = Math.max(0, Math.min(1, progress));
  const slot = [0, 2, 3, 1][index]; // front-left, rear-right, front-right, rear-left
  const anchorAt = (t) => {
    const angle = Math.PI * t;
    const x = (index % 2 ? 1 : -1) * 0.32;
    const z = (index < 2 ? -0.36 : 0.46) * (1 - Math.sin(angle) * 0.5) - 0.055;
    return {
      x: Math.cos(angle) * x + Math.sin(angle) * z,
      z: -Math.sin(angle) * x + Math.cos(angle) * z,
      angle,
    };
  };
  let anchor = anchorAt(0),
    lift = 0;
  for (let cycle = 0; cycle < 3; cycle++) {
    const start = (cycle * 4 + slot) / 12,
      end = start + 1 / 12;
    if (p <= start) break;
    // Land a little ahead of the body; the last steps settle into the final stance.
    const target = anchorAt(cycle === 2 ? 1 : Math.min(1, end + 0.125));
    if (p >= end) {
      anchor = target;
      continue;
    }
    const t = (p - start) / (end - start),
      ease = t * t * (3 - 2 * t);
    anchor = {
      x: anchor.x + (target.x - anchor.x) * ease,
      z: anchor.z + (target.z - anchor.z) * ease,
      angle: anchor.angle + (target.angle - anchor.angle) * ease,
    };
    lift = Math.sin(Math.PI * t) ** 2 * 0.11;
    break;
  }
  const angle = Math.PI * p;
  return {
    x: Math.cos(angle) * anchor.x - Math.sin(angle) * anchor.z,
    y: 0.125 + lift,
    z: Math.sin(angle) * anchor.x + Math.cos(angle) * anchor.z,
    yaw: anchor.angle - angle,
    lift,
  };
}
