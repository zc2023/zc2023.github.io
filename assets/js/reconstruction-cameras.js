import * as THREE from 'three';

// Exported poses use OpenCV axes. Three.js looks down -Z with +Y up.
// Both models and cameras receive the same display-world recentering.
export function cameraMatrix(view, center) {
  const matrix = new THREE.Matrix4().set(...view.camera_to_world.flat());
  matrix.multiply(new THREE.Matrix4().makeScale(1, -1, -1));
  matrix.elements[12] -= center.x;
  matrix.elements[13] -= center.y;
  matrix.elements[14] -= center.z;
  return matrix;
}

export function calibratedProjection(view, near, far) {
  const [[fx, skew, cx], [, fy, cy]] = view.intrinsics;
  const matrix = new THREE.Matrix4().makePerspective(
    -cx * near / fx, (view.width - cx) * near / fx,
    cy * near / fy, -(view.height - cy) * near / fy, near, far,
  );
  matrix.elements[4] = -2 * skew / view.width;
  return matrix;
}

// TL, TR, BR, BL on the camera's image plane, in Three.js camera coordinates.
export function imageCorners(view, distance) {
  const [[fx, skew, cx], [, fy, cy]] = view.intrinsics;
  return [[0, 0], [view.width, 0], [view.width, view.height], [0, view.height]].map(([u, v]) => {
    const y = (v - cy) * distance / fy;
    const x = ((u - cx) * distance - skew * y) / fx;
    return new THREE.Vector3(x, -y, -distance);
  });
}

export function imagePlaneGeometry(view, distance) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(imageCorners(view, distance).flatMap(corner => corner.toArray()), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  return geometry;
}

export function containedViewport(width, height, imageWidth, imageHeight) {
  const scale = Math.min(width / imageWidth, height / imageHeight);
  const w = imageWidth * scale, h = imageHeight * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

export function interpolateCameraPose(camera, from, to, progress) {
  const blend = THREE.MathUtils.smootherstep(progress, 0, 1);
  camera.position.lerpVectors(from.position, to.position, blend);
  camera.quaternion.slerpQuaternions(from.quaternion, to.quaternion, blend);
  camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  camera.fov = THREE.MathUtils.lerp(from.fov, to.fov, blend);
  return blend;
}
