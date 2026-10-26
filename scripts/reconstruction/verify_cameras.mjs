// Run with: node scripts/reconstruction/verify_cameras.mjs
// Exercises the shipped camera math and OrbitControls without requiring WebGL.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../../assets/js/vendor/three/build/three.module.js';

const root = new URL('../../', import.meta.url);
const core = new URL('assets/js/vendor/three/build/three.module.js', root).href;
async function browserModule(path) {
  const source = (await readFile(new URL(path, root), 'utf8')).replaceAll("from 'three'", `from '${core}'`);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const { cameraMatrix, calibratedProjection, imageCorners, imagePlaneGeometry, containedViewport, interpolateCameraPose } = await browserModule('assets/js/reconstruction-cameras.js');
const { OrbitControls } = await browserModule('assets/js/vendor/three/examples/jsm/controls/OrbitControls.js');
const metadata = JSON.parse(await readFile(new URL('assets/spatial/img-5064/metadata.json', root), 'utf8'));
const center = new THREE.Vector3().fromArray(metadata.bounds[0]).add(new THREE.Vector3().fromArray(metadata.bounds[1])).multiplyScalar(.5);
const fakeDocument = { addEventListener() {}, removeEventListener() {} };
const fakeCanvas = { ...fakeDocument, style: {}, getRootNode: () => fakeDocument };
let worstPixelError = 0;

for (const [index, view] of metadata.views.entries()) {
  const matrix = cameraMatrix(view, center);
  const camera = new THREE.PerspectiveCamera();
  const orientation = new THREE.Quaternion().setFromRotationMatrix(matrix).normalize();
  const expectedPosition = new THREE.Vector3(...view.camera_to_world.slice(0, 3).map(row => row[3])).sub(center);
  camera.position.setFromMatrixPosition(matrix);
  assert.ok(camera.position.distanceTo(expectedPosition) < 1e-10, 'Camera and scene must share the recentering');
  camera.up.set(0, 1, 0).applyQuaternion(orientation);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(orientation);
  const focus = camera.position.clone().addScaledVector(forward, view.focus_distance);
  const controls = new OrbitControls(camera, fakeCanvas);
  controls.target.copy(focus);
  controls.update();
  assert.ok(camera.position.distanceTo(expectedPosition) < 1e-8, 'OrbitControls moved the capture position');
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).distanceTo(forward) < 1e-6, 'OrbitControls lost camera roll/direction');
  controls.dispose();
  camera.quaternion.copy(orientation);
  camera.updateMatrixWorld();
  camera.projectionMatrix.copy(calibratedProjection(view, .01, 1000));
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  const [[fx, skew, cx], [, fy, cy]] = view.intrinsics;
  for (const [u, v] of [[0, 0], [448, 0], [448, 252], [0, 252], [cx, cy], [73, 188]]) {
    // Independently place a known pixel ray in exported OpenCV world space.
    const z = view.focus_distance, y = (v - cy) * z / fy, x = ((u - cx) * z - skew * y) / fx;
    const world = new THREE.Vector3(...view.camera_to_world.slice(0, 3).map(row => row[0] * x + row[1] * y + row[2] * z + row[3])).sub(center);
    const ndc = world.clone().project(camera);
    const error = Math.hypot((ndc.x + 1) * view.width / 2 - u, (1 - ndc.y) * view.height / 2 - v);
    worstPixelError = Math.max(worstPixelError, error);
    assert.ok(error < .001, `Frame ${index}: projection mismatch ${error} px`);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
    assert.ok(ray.ray.distanceToPoint(world) < 1e-6, 'Picking ray does not match the displayed pixel');
  }
  for (const [i, corner] of imageCorners(view, .5).entries()) {
    const ndc = corner.applyMatrix4(camera.projectionMatrix);
    const expected = [[-1, 1], [1, 1], [1, -1], [-1, -1]][i];
    assert.ok(Math.hypot(ndc.x - expected[0], ndc.y - expected[1]) < 1e-10, 'RGB plane is flipped or stretched');
  }
  // The full textured quadrilateral, on either side, must be a clickable target.
  const plane = new THREE.Mesh(imagePlaneGeometry(view, .5), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  plane.applyMatrix4(matrix);
  plane.updateMatrixWorld(true);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
  for (const [u, v] of [[.1, .1], [.9, .1], [.9, .9], [.1, .9], [.5, .5]]) {
    const z = .5, y = (v * view.height - cy) * z / fy;
    const x = ((u * view.width - cx) * z - skew * y) / fx;
    const point = new THREE.Vector3(x, -y, -z).applyMatrix4(matrix);
    for (const side of [-1, 1]) {
      const ray = new THREE.Raycaster(point.clone().addScaledVector(normal, side), normal.clone().multiplyScalar(-side));
      const hit = ray.intersectObject(plane, false)[0];
      assert.ok(hit, `Frame ${index}: RGB rectangle must be clickable from both sides`);
      assert.ok(Math.hypot(hit.uv.x - u, hit.uv.y - (1 - v)) < 1e-6, 'Clicked RGB pixel has the wrong texture orientation');
    }
  }
  plane.geometry.dispose();
  plane.material.dispose();
  assert.equal(view.frame, metadata.frames[index]);
  assert.ok((await readFile(new URL(`assets/spatial/img-5064/${view.image}`, root))).length > 1000);
  const from = { position: expectedPosition.clone().add(new THREE.Vector3(3, 1, -2)), quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .9), fov: 34 };
  const to = { position: expectedPosition, quaternion: orientation, fov: THREE.MathUtils.radToDeg(2 * Math.atan(view.height / (2 * fy))) };
  let lastDistance = Infinity, lastAngle = Infinity;
  for (const progress of [0, .01, .25, .5, .75, .99, 1]) {
    interpolateCameraPose(camera, from, to, progress);
    const distance = camera.position.distanceTo(to.position), angle = camera.quaternion.angleTo(to.quaternion);
    assert.ok(distance <= lastDistance + 1e-8 && angle <= lastAngle + 1e-7, 'Camera flight overshoots or turns the long way');
    assert.ok(Math.abs(camera.quaternion.length() - 1) < 1e-10, 'Interpolated orientation must remain normalized');
    lastDistance = distance; lastAngle = angle;
  }
  assert.ok(camera.position.distanceTo(to.position) < 1e-10 && camera.quaternion.angleTo(to.quaternion) < 1e-7, 'Flight must finish at the calibrated pose');
  assert.equal(camera.fov, to.fov);
  // A new destination starts from the current interpolated pose without jumping.
  interpolateCameraPose(camera, from, to, .4);
  const interrupted = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov };
  interpolateCameraPose(camera, interrupted, from, 0);
  assert.ok(camera.position.distanceTo(interrupted.position) < 1e-10 && camera.quaternion.angleTo(interrupted.quaternion) < 1e-7, 'Retargeting must preserve the current pose');
}

// Portrait, landscape and fullscreen layouts must preserve 16:9 and center it.
for (const [width, height] of [[390, 600], [1200, 800], [1920, 1080]]) {
  const vp = containedViewport(width, height, 448, 252);
  assert.ok(Math.abs(vp.width / vp.height - 16 / 9) < 1e-12);
  assert.ok(vp.width <= width && vp.height <= height);
  assert.equal(vp.x * 2 + vp.width, width);
  assert.equal(vp.y * 2 + vp.height, height);
}
assert.equal(metadata.views.length, 24);
console.log(`PASS: ${metadata.views.length} poses, RGB assets, pixel projections, 240 double-sided RGB-plane hits, smooth flights and retargeting, OrbitControls and responsive viewports. Maximum projection error: ${worstPixelError.toExponential(3)} px.`);
