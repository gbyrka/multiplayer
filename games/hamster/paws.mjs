// Continuous pivot steps on open ground. Each paw stays planted for three
// beats while the fourth paw lifts and lands ahead of the rotating body.
export function standingTurnPaw(index, angle, direction = 1) {
  const mirroredIndex = direction < 0 ? index ^ 1 : index;
  const slot = [0, 2, 3, 1][mirroredIndex];
  const beat = Math.PI / 12;
  const cycle = Math.floor((angle - slot * beat) / (4 * beat));
  const anchorAt = (a) => {
    const x = (mirroredIndex % 2 ? 1 : -1) * 0.32;
    const z = (mirroredIndex < 2 ? -0.36 : 0.46) - 0.055;
    return {
      x: Math.cos(a) * x + Math.sin(a) * z,
      z: -Math.sin(a) * x + Math.cos(a) * z,
      yaw: a,
    };
  };
  let anchor = anchorAt(0),
    lift = 0;
  if (cycle >= 0) {
    const start = (cycle * 4 + slot) * beat;
    const target = anchorAt(start + 2.5 * beat);
    const t = Math.min(1, Math.max(0, (angle - start) / beat));
    if (t < 1) {
      const previous = anchorAt(cycle === 0 ? 0 : start - 1.5 * beat);
      const ease = t * t * (3 - 2 * t);
      anchor = {
        x: previous.x + (target.x - previous.x) * ease,
        z: previous.z + (target.z - previous.z) * ease,
        yaw: previous.yaw + (target.yaw - previous.yaw) * ease,
      };
      lift = Math.sin(Math.PI * t) ** 2 * 0.11;
    } else anchor = target;
  }
  return {
    x: direction * (Math.cos(angle) * anchor.x - Math.sin(angle) * anchor.z),
    y: 0.125 + lift,
    z: Math.sin(angle) * anchor.x + Math.cos(angle) * anchor.z,
    yaw: direction * (anchor.yaw - angle),
    lift,
  };
}
