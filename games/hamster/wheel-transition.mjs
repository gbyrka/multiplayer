const smooth = (t) => t * t * (3 - 2 * t);
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const heading = (a, b) => Math.atan2(a.x - b.x, a.z - b.z);
const point = (x, y, z) => ({ x, y, z });

export function createWheelTransition(pose, entering) {
  const stages = [];
  let current = { x: pose.x, y: pose.y, z: pose.z, angle: pose.angle };
  const turn = (target) => {
    const delta = angleDelta(current.angle, target);
    if (Math.abs(delta) < 0.015) return;
    stages.push({
      kind: "turn",
      from: { ...current },
      delta,
      duration: Math.max(0.18, Math.abs(delta) / 2.7),
    });
    current.angle += delta;
  };
  const walk = (points) => {
    const samples = points.map((p, i) => ({ ...p, s: 0 }));
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1],
        b = samples[i];
      b.s = a.s + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    const length = samples.at(-1).s;
    if (length < 0.015) return;
    turn(heading(samples[0], samples[1]));
    stages.push({
      kind: "walk",
      samples,
      length,
      duration: Math.max(0.3, length / 1.65),
      from: { ...current },
    });
    const last = samples.at(-1);
    current = { ...last, angle: heading(samples.at(-2), last) };
  };
  if (entering && (Math.abs(pose.x - 6) > 0.15 || pose.z < 3.8)) {
    // Approach around the wheel's outside, then align with its open front.
    const a = Math.atan2(pose.x - 6, pose.z - 1.5);
    const radius = Math.hypot(pose.x - 6, pose.z - 1.5);
    const points = Array.from({ length: 49 }, (_, i) => {
      const t = i / 48,
        r = radius + (2.8 - radius) * smooth(t);
      return point(
        6 + Math.sin(a * (1 - t)) * r,
        pose.y * (1 - smooth(t)),
        1.5 + Math.cos(a * (1 - t)) * r
      );
    });
    points[0] = point(pose.x, pose.y, pose.z);
    walk(points);
  }
  const from = { ...current },
    destination = entering ? point(6, 0.27, 1.6) : point(6, 0, 4.3);
  const points = Array.from({ length: 65 }, (_, i) => {
    const t = i / 64;
    // Curve into the running direction before reaching the rear of the wheel.
    const z = entering
      ? destination.z + (from.z - destination.z) * (1 - t) ** 2
      : from.z + (destination.z - from.z) * t;
    const x =
      from.x +
      (destination.x - from.x) * t +
      (entering ? 1.2 * t * t * (1 - t) : 0);
    const tread = 0.27 * smooth(Math.max(0, Math.min(1, (2.9 - z) / 0.7)));
    const curveRise =
      entering && z < 2.2 ? 2.05 - Math.sqrt(2.05 ** 2 - (x - 6) ** 2) : 0;
    return point(x, tread + curveRise, z);
  });
  points[0] = point(from.x, from.y, from.z);
  walk(points);
  turn(entering ? Math.PI / 2 : Math.PI);
  return {
    entering,
    stages,
    index: 0,
    elapsed: 0,
    pose: { ...pose },
    finished: false,
  };
}

export function advanceWheelTransition(transition, dt) {
  let remaining = dt,
    turning = false,
    pitch = 0,
    turnDelta = 0;
  const previous = transition.pose;
  while (remaining > 1e-9 && transition.index < transition.stages.length) {
    const stage = transition.stages[transition.index];
    const used = Math.min(remaining, stage.duration - transition.elapsed);
    transition.elapsed += used;
    remaining -= used;
    const t = smooth(Math.min(1, transition.elapsed / stage.duration));
    let pose;
    if (stage.kind === "turn") {
      pose = { ...stage.from, angle: stage.from.angle + stage.delta * t };
      turning = true;
      turnDelta += angleDelta(transition.pose.angle, pose.angle);
      pitch = 0;
    } else {
      const distance = t * stage.length;
      let i = stage.samples.findIndex((p) => p.s >= distance);
      i = Math.max(1, i);
      const a = stage.samples[i - 1],
        b = stage.samples[i];
      const u = (distance - a.s) / (b.s - a.s);
      const entryHeading = heading(stage.samples[Math.max(0, i - 2)], b);
      const exitHeading = heading(
        a,
        stage.samples[Math.min(stage.samples.length - 1, i + 1)]
      );
      const angle = entryHeading + angleDelta(entryHeading, exitHeading) * u;
      pose = {
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        z: a.z + (b.z - a.z) * u,
        angle,
      };
      pitch = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
      turning = false;
    }
    transition.pose = pose;
    if (transition.elapsed >= stage.duration - 1e-9) {
      transition.index++;
      transition.elapsed = 0;
    }
  }
  transition.finished = transition.index >= transition.stages.length;
  const p = transition.pose;
  return {
    x: p.x,
    y: p.y,
    z: p.z,
    angle: p.angle,
    pitch,
    turning,
    turnDelta,
    speed:
      dt > 0
        ? Math.hypot(p.x - previous.x, p.y - previous.y, p.z - previous.z) / dt
        : 0,
    finished: transition.finished,
  };
}
