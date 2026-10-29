import * as THREE from '../hamster/vendor/three.mjs';

// Metres in the renderer: the 34-unit car is 1.70 m wide. X points right,
// Y up and -Z forwards. The eye and wheel share the LEFT seat's centreline.
export const DRIVER_EYE = new THREE.Vector3(-.43, 1.30, .10);
export const STEERING_CENTRE = new THREE.Vector3(-.43, .86, -.53);
export const MIRROR_CENTRE = new THREE.Vector3(-1.04, 1.10, -.55);
export const MIRROR_WIDTH = .28;
export const MIRROR_HEIGHT = .17;
export const HORIZONTAL_FOV = 98;
const viewRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.12, -.055, 0, 'YXZ'));
const up = new THREE.Vector3(0, 1, 0);

export function reflectPoint(point, centre, normal) {
  return point.clone().addScaledVector(normal, -2 * point.clone().sub(centre).dot(normal));
}

/** One plane, adjusted like a real side mirror: a sliver of car at its inner edge. */
export function makeMirrorFrame() {
  const centre = MIRROR_CENTRE.clone();
  const toEye = DRIVER_EYE.clone().sub(centre).normalize();
  const rearward = new THREE.Vector3(-.025, -.025, 1).normalize();
  // The normal bisects the eye and reflected sight line (equal incidence angles).
  const normal = toEye.add(rearward).normalize();
  const right = up.clone().cross(normal).normalize(), vertical = normal.clone().cross(right);
  const corner = (x, y) => centre.clone().addScaledVector(right, x * MIRROR_WIDTH / 2).addScaledVector(vertical, y * MIRROR_HEIGHT / 2);
  return { centre, normal, right, up: vertical,
    bottomLeft: corner(-1, -1), bottomRight: corner(1, -1), topLeft: corner(-1, 1), topRight: corner(1, 1) };
}

export function positionDriverCamera(camera, carMatrix, aspect) {
  camera.position.copy(DRIVER_EYE).applyMatrix4(carMatrix);
  camera.quaternion.setFromRotationMatrix(carMatrix).multiply(viewRotation);
  // Preserve the horizontal view on narrow windows; do not move the eye to
  // the middle of the cabin or move the mirror into the windshield on resize.
  camera.aspect = aspect;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(HORIZONTAL_FOV / 2)) / aspect));
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
}

/** Reflect the actual eye through the mirror, then crop to its four corners.
 * A symmetric rear-facing camera cannot reproduce this finite mirror aperture.
 * The camera's horizontal basis is reversed; the glass's UVs undo that reversal.
 */
export function positionMirrorCamera(camera, eye, frame, carMatrix, far = 200) {
  const centre = frame.centre.clone().applyMatrix4(carMatrix), normal = frame.normal.clone().transformDirection(carMatrix);
  const right = frame.right.clone().transformDirection(carMatrix).negate(), vertical = frame.up.clone().transformDirection(carMatrix);
  const back = normal.clone().negate();
  const reflectedEye = reflectPoint(eye, centre, normal);
  camera.position.copy(reflectedEye);
  camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, vertical, back));
  const pa = frame.bottomRight.clone().applyMatrix4(carMatrix).sub(reflectedEye);
  const pb = frame.bottomLeft.clone().applyMatrix4(carMatrix).sub(reflectedEye);
  const pc = frame.topRight.clone().applyMatrix4(carMatrix).sub(reflectedEye);
  const distance = -pa.dot(back), near = distance + .001;
  // The mirror plane itself clips geometry between the virtual eye and glass.
  camera.near = near; camera.far = far;
  camera.projectionMatrix.makePerspective(right.dot(pa) * near / distance, right.dot(pb) * near / distance,
    vertical.dot(pc) * near / distance, vertical.dot(pa) * near / distance, near, far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert(); camera.updateMatrixWorld(true);
}

export function projectedMirror(frame, carMatrix, camera, width, height) {
  return ['bottomLeft', 'bottomRight', 'topRight', 'topLeft'].map(name => {
    const p = frame[name].clone().applyMatrix4(carMatrix).project(camera);
    return { x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 };
  });
}
