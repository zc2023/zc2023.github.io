import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cameraMatrix, calibratedProjection, imageCorners, imagePlaneGeometry, containedViewport, interpolateCameraPose } from './reconstruction-cameras.js';
import { createCameraTrajectory, TRAJECTORY_COLORS } from './reconstruction-trajectory.js';
import { createSmoothTimeline } from './reconstruction-timeline.js';

const host = document.querySelector('#viewer');
const stage = document.querySelector('.stage');
const status = document.querySelector('#load-state');
const statusText = document.querySelector('#load-text');
const base = document.querySelector('.experience').dataset.assets;
const modelPrefix = document.querySelector('.experience').dataset.modelPrefix || 'car';
const lightTheme = document.querySelector('.experience').dataset.theme === 'light';
const modeButtons = [...document.querySelectorAll('[data-mode]')];

function showError(error) {
  console.error(error);
  status.classList.remove('hidden');
  status.classList.add('error');
  statusText.textContent = 'The 3D view could not load. Please reload, or download the model using the links below.';
}

async function boot() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
  renderer.autoClear = false;
  let controls;
  const models = new Map();
  const loader = new GLTFLoader();
  let currentMode = 'points';
  let extent = 3;
  let sceneHeight = 1;
  let metadata;
  let homeDistance = 5;
  const homeDirection = new THREE.Vector3(1.25, .8, 1.5).normalize();
  let grid;
  const target = new THREE.Vector3();
  const referenceCenter = new THREE.Vector3();
  const cameraRig = new THREE.Group();
  scene.add(cameraRig);
  const cameraObjects = [];
  const cameraPlanes = [];
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const textureLoader = new THREE.TextureLoader();
  const showCameras = document.querySelector('#show-cameras');
  const showRGB = document.querySelector('#show-camera-rgb');
  const showTrajectory = document.querySelector('#show-trajectory');
  const timeline = document.querySelector('#trajectory-timeline');
  const timelineInput = document.querySelector('#trajectory-time');
  const timelineValue = document.querySelector('#trajectory-time-value');
  const timelineModeButtons = [...document.querySelectorAll('[data-timeline-mode]')];
  const timelinePlay = document.querySelector('#timeline-play');
  const cameraSelect = document.querySelector('#camera-select');
  const rgbCard = document.querySelector('#rgb-card');
  const rgbImage = document.querySelector('#camera-image');
  const cameraState = document.querySelector('#camera-state');
  const frameBorder = document.querySelector('#camera-frame');
  const tooltip = document.querySelector('#camera-tooltip');
  let selectedCamera = -1;
  let aligned = false;
  let cameraTransition;
  let orbitProjection = null;
  let zoomTarget = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let trajectory;
  let smoothTimeline;
  let timelineMode = 'frames';
  let timelineTime = null;
  let followingTimeline = false;
  let timelinePlaying = false;
  let playbackLastTime = null;
  let viewport = { x: 0, y: 0, width: 1, height: 1 };

  function configureOrbit(focus) {
    // OrbitControls caches its up-axis at construction. Recreate it after a
    // camera jump to preserve that frame's roll and discard residual damping.
    controls?.dispose();
    zoomTarget = null;
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = .075;
    controls.autoRotateSpeed = .65;
    controls.minDistance = extent * .015;
    controls.maxDistance = extent * 6;
    controls.target.copy(focus);
    controls.update();
    controls.addEventListener('change', leaveAlignedView);
    controls.addEventListener('start', () => { zoomTarget = null; });
    document.querySelector('#rotate').setAttribute('aria-pressed', 'false');
  }
  configureOrbit(target);

  function updateProjection() {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    const imageWidth = metadata?.image_width || 448, imageHeight = metadata?.image_height || 252;
    viewport = containedViewport(width, height, imageWidth, imageHeight);
    camera.aspect = imageWidth / imageHeight;
    if (cameraTransition) {
      const { fromProjection, toProjection: end, blend } = cameraTransition;
      camera.projectionMatrix.elements.forEach((_, i, elements) => {
        elements[i] = THREE.MathUtils.lerp(fromProjection.elements[i], end.elements[i], blend);
      });
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    } else if (orbitProjection) {
      // Free orbit changes the pose, not the calibrated lens. Retaining it avoids
      // a field-of-view/principal-point jump on the first wheel or drag event.
      camera.projectionMatrix.copy(orbitProjection);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    } else {
      camera.updateProjectionMatrix();
    }
    Object.assign(frameBorder.style, {
      left: `${viewport.x}px`, top: `${viewport.y}px`,
      width: `${viewport.width}px`, height: `${viewport.height}px`,
    });
    frameBorder.hidden = false;
    document.querySelector('#camera-frame-label').hidden = selectedCamera < 0;
  }

  function resize() {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height);
    updateProjection();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  function resetView() {
    if (!metadata) return;
    cameraTransition = null;
    orbitProjection = null;
    timelineTime = null;
    followingTimeline = false;
    timelinePlaying = false;
    playbackLastTime = null;
    selectedCamera = -1;
    aligned = false;
    rgbCard.hidden = true;
    cameraSelect.value = '';
    camera.up.set(0, 1, 0);
    camera.fov = 34;
    updateProjection();
    const fit = Math.max(extent / camera.aspect, sceneHeight, extent * .65);
    homeDistance = fit / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.28;
    camera.position.copy(target).addScaledVector(homeDirection, homeDistance);
    camera.near = extent / (metadata.representation === 'full_scene' ? 2000 : 200);
    camera.far = extent * 60;
    configureOrbit(target);
    updateProjection();
    updateCameraVisibility();
  }

  function frameName(index) {
    const view = metadata.views[index];
    return `Frame ${String(index + 1).padStart(2, '0')} / ${metadata.views.length} · ${view.time_seconds.toFixed(2)} s`;
  }

  function showReferenceFrame(index) {
    const view = metadata.views[index];
    cameraSelect.value = String(index);
    if (rgbImage.dataset.frameIndex !== String(index)) {
      rgbImage.src = base + view.image;
      rgbImage.alt = `Uncropped source RGB, ${frameName(index)}`;
      rgbImage.dataset.frameIndex = String(index);
      document.querySelector('#rgb-title').textContent = frameName(index);
    }
    rgbCard.hidden = false;
    document.querySelector('#previous-camera').disabled = index === 0;
    document.querySelector('#next-camera').disabled = index === metadata.views.length - 1;
  }

  function applySmoothTime(time) {
    const pose = smoothTimeline.sample(time);
    timelineMode = 'smooth';
    timelineTime = pose.time;
    selectedCamera = pose.nearestIndex;
    followingTimeline = true;
    aligned = false;
    zoomTarget = null;
    controls.enabled = false;
    controls.autoRotate = false;
    camera.position.copy(pose.position);
    camera.quaternion.copy(pose.quaternion);
    camera.up.set(0, 1, 0).applyQuaternion(pose.quaternion);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(smoothTimeline.fixedView.height / (2 * smoothTimeline.fixedView.intrinsics[1][1])));
    orbitProjection = calibratedProjection(smoothTimeline.fixedView, camera.near, camera.far);
    camera.updateMatrixWorld();
    updateProjection();
    showReferenceFrame(selectedCamera);
    cameraState.textContent = 'Interpolated path view · nearest captured RGB reference.';
    document.querySelector('#camera-frame-label').textContent = `SMOOTH PATH · ${pose.time.toFixed(2)} s · FIXED LENS`;
    document.querySelector('#rotate').setAttribute('aria-pressed', 'false');
    updateCameraVisibility();
  }

  function seekSmoothTime(time, { animate = false, play = false } = {}) {
    if (!smoothTimeline) return;
    const pose = smoothTimeline.sample(time);
    if (animate) {
      selectCamera(pose.nearestIndex, { animate: true, smoothTime: pose.time, play });
    } else {
      cameraTransition = null;
      timelinePlaying = play;
      playbackLastTime = play ? performance.now() : null;
      applySmoothTime(pose.time);
    }
  }

  function releaseTimeline() {
    if (!followingTimeline && !timelinePlaying) return;
    followingTimeline = false;
    timelinePlaying = false;
    playbackLastTime = null;
    const position = camera.position.clone(), quaternion = camera.quaternion.clone();
    const focusDistance = smoothTimeline.sample(timelineTime).focusDistance;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
    configureOrbit(position.clone().addScaledVector(forward, focusDistance));
    camera.position.copy(position);
    camera.quaternion.copy(quaternion);
    cameraState.textContent = 'Free orbit · Return to path to resume this timeline view.';
    document.querySelector('#camera-frame-label').textContent = `SMOOTH PATH · ${timelineTime.toFixed(2)} s · FREE ORBIT`;
    updateCameraVisibility();
  }

  function advanceTimeline(now) {
    if (!timelinePlaying) return;
    const elapsed = playbackLastTime === null ? 0 : Math.max(0, now - playbackLastTime) / 1000;
    playbackLastTime = now;
    const nextTime = Math.min(smoothTimeline.lastTime, timelineTime + elapsed);
    if (nextTime >= smoothTimeline.lastTime) { timelinePlaying = false; playbackLastTime = null; }
    applySmoothTime(nextTime);
  }

  function leaveAlignedView() {
    if (!aligned) return;
    aligned = false;
    updateProjection();
    updateCameraVisibility();
    cameraState.textContent = timelineMode === 'smooth' ? 'Free orbit · Return to path to resume this timeline view.' : 'Free orbit · Align view to match this RGB frame.';
    document.querySelector('#camera-frame-label').textContent = timelineMode === 'smooth' ? `SMOOTH PATH · ${timelineTime.toFixed(2)} s · FREE ORBIT` : `CAMERA ${String(selectedCamera + 1).padStart(2, '0')} · FREE ORBIT`;
  }

  function finishCameraTransition() {
    const { to, toProjection, kind, sampleTime, playAfter, focusDistance } = cameraTransition;
    cameraTransition = null;
    if (kind === 'smooth') {
      timelinePlaying = playAfter;
      playbackLastTime = playAfter ? performance.now() : null;
      applySmoothTime(sampleTime);
      return;
    }
    orbitProjection = toProjection.clone();
    camera.position.copy(to.position);
    camera.quaternion.copy(to.quaternion);
    camera.up.set(0, 1, 0).applyQuaternion(to.quaternion);
    camera.fov = to.fov;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(to.quaternion);
    configureOrbit(to.position.clone().addScaledVector(forward, focusDistance));
    camera.position.copy(to.position);
    camera.quaternion.copy(to.quaternion);
    camera.updateMatrixWorld();
    aligned = true;
    updateProjection();
    cameraState.textContent = 'Aligned to this frame’s pose and intrinsics.';
    document.querySelector('#camera-frame-label').textContent = `CAMERA ${String(selectedCamera + 1).padStart(2, '0')} · ALIGNED 16:9 VIEW`;
    updateCameraVisibility();
  }

  function stopCameraTransition() {
    if (!cameraTransition) return;
    orbitProjection = camera.projectionMatrix.clone();
    cameraTransition = null;
    timelinePlaying = false;
    followingTimeline = false;
    playbackLastTime = null;
    const position = camera.position.clone(), orientation = camera.quaternion.clone();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(orientation);
    configureOrbit(position.clone().addScaledVector(forward, metadata.views[selectedCamera].focus_distance));
    camera.position.copy(position);
    camera.quaternion.copy(orientation);
    aligned = false;
    updateProjection();
    updateCameraVisibility();
    cameraState.textContent = timelineMode === 'smooth' ? 'Free orbit · Return to path to resume this timeline view.' : 'Free orbit · Align view to match this RGB frame.';
    document.querySelector('#camera-frame-label').textContent = timelineMode === 'smooth' ? `SMOOTH PATH · ${timelineTime.toFixed(2)} s · FREE ORBIT` : `CAMERA ${String(selectedCamera + 1).padStart(2, '0')} · FREE ORBIT`;
  }

  function selectCamera(index, { animate = true, smoothTime = null, play = false } = {}) {
    if (!metadata?.views?.[index]) return;
    const smoothPose = smoothTime !== null ? smoothTimeline.sample(smoothTime) : null;
    if (smoothPose) index = smoothPose.nearestIndex;
    const view = smoothPose ? smoothTimeline.fixedView : metadata.views[index];
    const matrix = cameraMatrix(metadata.views[index], referenceCenter);
    cameraTransition = {
      from: { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov },
      to: {
        position: smoothPose?.position ?? new THREE.Vector3().setFromMatrixPosition(matrix),
        quaternion: smoothPose?.quaternion ?? new THREE.Quaternion().setFromRotationMatrix(matrix).normalize(),
        fov: THREE.MathUtils.radToDeg(2 * Math.atan(view.height / (2 * view.intrinsics[1][1]))),
      },
      fromIndex: aligned ? selectedCamera : cameraTransition?.fromIndex ?? -1,
      fromProjection: camera.projectionMatrix.clone(),
      toProjection: calibratedProjection(view, camera.near, camera.far),
      kind: smoothPose ? 'smooth' : 'frame',
      sampleTime: smoothPose?.time,
      focusDistance: smoothPose?.focusDistance ?? metadata.views[index].focus_distance,
      playAfter: play,
      startedAt: performance.now(),
      duration: 1000,
      blend: 0,
    };
    selectedCamera = index;
    timelineMode = smoothPose ? 'smooth' : 'frames';
    timelineTime = smoothPose?.time ?? null;
    followingTimeline = false;
    timelinePlaying = false;
    playbackLastTime = null;
    zoomTarget = null;
    aligned = false;
    controls.enabled = false;
    controls.autoRotate = false;
    document.querySelector('#rotate').setAttribute('aria-pressed', 'false');
    updateProjection();
    showReferenceFrame(index);
    document.querySelector('#camera-frame-label').textContent = smoothPose ? 'MOVING TO SMOOTH PATH' : `CAMERA ${String(index + 1).padStart(2, '0')} · MOVING TO VIEW`;
    cameraState.textContent = smoothPose ? 'Moving onto the continuous path…' : 'Moving smoothly to this camera…';
    tooltip.hidden = true;
    host.style.cursor = '';
    updateCameraVisibility();
    if (!animate || reducedMotion.matches) finishCameraTransition();
  }

  function updateCameraVisibility() {
    cameraRig.visible = showCameras.checked;
    showRGB.disabled = !showCameras.checked;
    cameraObjects.forEach((object, index) => {
      // Do not draw a camera's own image plane in front of its aligned view.
      object.group.visible = !((aligned || cameraTransition) && index === selectedCamera) && index !== cameraTransition?.fromIndex;
      object.plane.visible = showRGB.checked;
      const color = index === selectedCamera ? (lightTheme ? '#a57733' : '#f6db9a') : (lightTheme ? '#589380' : '#a9c4c1');
      object.lines.material.color.set(color);
      if (cameraRig.visible && showRGB.checked && !object.textureRequested) {
        object.textureRequested = true;
        textureLoader.load(base + metadata.views[index].image, texture => {
          texture.colorSpace = THREE.SRGBColorSpace;
          object.plane.material.map = texture;
          object.plane.material.needsUpdate = true;
        }, undefined, error => {
          object.textureRequested = false;
          console.warn('Camera RGB plane could not load', error);
        });
      }
    });
    if (!cameraRig.visible) { tooltip.hidden = true; host.style.cursor = ''; }
    updateFrustumProximity();
    updateTrajectory();
  }

  function updateFrustumProximity() {
    const closest = new THREE.Vector3();
    for (const object of cameraObjects) {
      const { planeDistance, worldEdges, imageTriangles, group, lines, plane } = object;
      // The whole camera stays unobtrusive near its origin, including when a
      // wheel gesture first leaves the aligned view. Individual edges then fade
      // independently when the viewer approaches any part of a frustum.
      const bodyFade = THREE.MathUtils.smootherstep(camera.position.distanceTo(group.position), planeDistance * .5, planeDistance * 1.6);
      const colors = lines.geometry.getAttribute('color');
      let maxAlpha = 0;
      worldEdges.forEach((edge, i) => {
        edge.closestPointToPoint(camera.position, true, closest);
        const alpha = bodyFade * THREE.MathUtils.smootherstep(camera.position.distanceTo(closest), planeDistance * .18, planeDistance * .7);
        colors.setW(i * 2, alpha);
        colors.setW(i * 2 + 1, alpha);
        maxAlpha = Math.max(maxAlpha, alpha);
      });
      colors.needsUpdate = true;
      lines.visible = maxAlpha > .001;
      const imageDistance = Math.min(...imageTriangles.map(triangle => {
        triangle.closestPointToPoint(camera.position, closest);
        return camera.position.distanceTo(closest);
      }));
      plane.material.opacity = .5 * bodyFade * THREE.MathUtils.smootherstep(imageDistance, planeDistance * .12, planeDistance * .5);
    }
  }

  function updateTrajectory() {
    if (!trajectory) return;
    trajectory.group.visible = showTrajectory.checked;
    trajectory.select(selectedCamera, !aligned && !cameraTransition && !followingTimeline);
    trajectory.updateProximity(camera.position);
    timeline.hidden = false;
    const sample = trajectory.samples.find(sample => sample.index === selectedCamera);
    const displayedTime = timelineMode === 'smooth' ? timelineTime : sample?.time;
    timelineInput.value = displayedTime ?? trajectory.firstTime;
    timelineValue.textContent = displayedTime != null ? `${displayedTime.toFixed(2)} s` : 'Overview';
    timelineInput.setAttribute('aria-valuetext', timelineMode === 'smooth' && displayedTime != null ? `Smooth path at ${displayedTime.toFixed(2)} seconds` : sample ? frameName(selectedCamera) : 'Scene overview. Move to select a capture time.');
    timelineModeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.timelineMode === timelineMode)));
    const playing = timelinePlaying || Boolean(cameraTransition?.playAfter);
    timelinePlay.hidden = timelineMode !== 'smooth';
    timelinePlay.setAttribute('aria-pressed', String(playing));
    timelinePlay.textContent = playing ? 'Pause path' : timelineTime >= trajectory.lastTime ? 'Replay path · 1×' : 'Play path · 1×';
    document.querySelector('#align-camera').textContent = timelineMode === 'smooth' ? 'Return to path' : 'Align view';
    document.querySelector('#trajectory-help').textContent = timelineMode === 'smooth'
      ? 'Drag or play to follow the fitted position and orientation with a fixed lens. RGB shows the nearest captured frame.'
      : 'Blue → red follows capture time. Drag to enter the nearest captured view.';
    timeline.classList.toggle('is-overview', !sample);
    timeline.querySelectorAll('.timeline-tick').forEach(tick => {
      tick.classList.toggle('selected', Number(tick.dataset.cameraIndex) === selectedCamera);
    });
  }

  function buildTrajectory() {
    if ((metadata.views?.length || 0) < 2) { showTrajectory.disabled = true; return; }
    trajectory = createCameraTrajectory(metadata.views, referenceCenter, extent * .0012);
    if (lightTheme) trajectory.highlight.material.color.set('#3d6855');
    smoothTimeline = createSmoothTimeline(metadata.views, trajectory, metadata.views.map(view => cameraMatrix(view, referenceCenter)));
    trajectory.setTimeMapping(smoothTimeline.timeAtArcLength);
    scene.add(trajectory.group);
    timelineInput.min = trajectory.firstTime;
    timelineInput.max = trajectory.lastTime;
    timelineInput.step = .001;
    timelineInput.style.background = `linear-gradient(to right, ${TRAJECTORY_COLORS.join(', ')})`;
    document.querySelector('#trajectory-start').textContent = `${trajectory.firstTime.toFixed(2)} s · Start`;
    document.querySelector('#trajectory-end').textContent = `${trajectory.lastTime.toFixed(2)} s · End`;
    const ticks = document.querySelector('#trajectory-ticks');
    trajectory.samples.forEach(sample => {
      const tick = document.createElement('span');
      tick.className = 'timeline-tick';
      tick.dataset.cameraIndex = sample.index;
      tick.style.left = `${sample.fraction * 100}%`;
      ticks.appendChild(tick);
    });
    updateTrajectory();
  }

  function buildCameras() {
    if (!metadata.views?.length) return;
    metadata.views.forEach((view, index) => {
      const group = new THREE.Group();
      const pose = cameraMatrix(view, referenceCenter);
      group.applyMatrix4(pose);
      const planeDistance = extent * .028;
      const corners = imageCorners(view, planeDistance);
      const segments = [];
      corners.forEach((corner, i) => {
        segments.push(0, 0, 0, ...corner.toArray(), ...corner.toArray(), ...corners[(i + 1) % 4].toArray());
      });
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
      lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(segments.length / 3 * 4).fill(1), 4));
      const worldEdges = [];
      for (let offset = 0; offset < segments.length; offset += 6) {
        worldEdges.push(new THREE.Line3(new THREE.Vector3().fromArray(segments, offset).applyMatrix4(pose), new THREE.Vector3().fromArray(segments, offset + 3).applyMatrix4(pose)));
      }
      const worldCorners = corners.map(corner => corner.clone().applyMatrix4(pose));
      const imageTriangles = [[0, 2, 1], [0, 3, 2]].map(indices => new THREE.Triangle(...indices.map(i => worldCorners[i])));
      const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ color: '#a9c4c1', vertexColors: true, transparent: true, opacity: .75, depthTest: false, depthWrite: false }));
      lines.renderOrder = 3;
      // The textured base is the click target. Render it with the frustum overlay
      // so scene points cannot obscure an image that can still be clicked.
      const plane = new THREE.Mesh(imagePlaneGeometry(view, planeDistance), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: .5, depthTest: false, depthWrite: false }));
      plane.userData.cameraIndex = index;
      plane.renderOrder = 2;
      plane.visible = false;
      group.add(lines, plane);
      cameraRig.add(group);
      cameraObjects.push({ group, lines, plane, planeDistance, worldEdges, imageTriangles, textureRequested: false });
      cameraPlanes.push(plane);
      cameraSelect.add(new Option(frameName(index), String(index)));
    });
    document.querySelector('#camera-controls').disabled = false;
    updateCameraVisibility();
  }

  function pickCamera(event) {
    if (!cameraRig.visible) return undefined;
    const rect = renderer.domElement.getBoundingClientRect();
    const x = event.clientX - rect.left - viewport.x;
    const y = event.clientY - rect.top - viewport.y;
    if (x < 0 || x > viewport.width || y < 0 || y > viewport.height) return undefined;
    pointer.set(x / viewport.width * 2 - 1, 1 - y / viewport.height * 2);
    camera.updateMatrixWorld();
    cameraRig.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(cameraPlanes.filter(plane => plane.visible && plane.parent.visible && plane.material.opacity > .05), false)[0]?.object.userData.cameraIndex;
  }

  let press;
  const activePointers = new Set();
  renderer.domElement.addEventListener('pointerdown', event => {
    activePointers.add(event.pointerId);
    // OrbitControls does not capture pointers while a camera flight disables it.
    if (!controls.enabled) renderer.domElement.setPointerCapture(event.pointerId);
    press = event.button === 0 && activePointers.size === 1 ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
    tooltip.hidden = true;
  });
  renderer.domElement.addEventListener('pointermove', event => {
    if (activePointers.size) {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) press = null;
      return;
    }
    const index = pickCamera(event);
    host.style.cursor = index === undefined ? '' : 'pointer';
    tooltip.hidden = index === undefined;
    if (index !== undefined) {
      tooltip.textContent = frameName(index);
      const rect = host.getBoundingClientRect();
      tooltip.style.left = `${Math.max(8, Math.min(event.clientX - rect.left + 14, rect.width - 195))}px`;
      tooltip.style.top = `${Math.max(8, Math.min(event.clientY - rect.top + 14, rect.height - 35))}px`;
    }
  });
  renderer.domElement.addEventListener('pointerup', event => {
    activePointers.delete(event.pointerId);
    if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 5) {
      const index = pickCamera(event);
      // Let OrbitControls finish its pointer-up handler before replacing it.
      if (index !== undefined) queueMicrotask(() => selectCamera(index));
    }
    press = null;
  });
  renderer.domElement.addEventListener('pointercancel', event => { activePointers.delete(event.pointerId); press = null; });
  renderer.domElement.addEventListener('pointerleave', () => { tooltip.hidden = true; host.style.cursor = ''; });
  showCameras.addEventListener('change', updateCameraVisibility);
  showRGB.addEventListener('change', updateCameraVisibility);
  showTrajectory.addEventListener('change', updateTrajectory);
  timelineModeButtons.forEach(button => button.addEventListener('click', () => {
    if (!smoothTimeline || button.dataset.timelineMode === timelineMode) return;
    if (button.dataset.timelineMode === 'smooth') {
      seekSmoothTime(timelineTime ?? metadata.views[selectedCamera]?.time_seconds ?? smoothTimeline.firstTime, { animate: true });
    } else selectCamera(Math.max(0, selectedCamera));
  }));
  timelinePlay.addEventListener('click', () => {
    if (!smoothTimeline) return;
    if (timelinePlaying || cameraTransition?.playAfter) {
      timelinePlaying = false;
      playbackLastTime = null;
      if (cameraTransition) cameraTransition.playAfter = false;
      updateTrajectory();
    } else if (followingTimeline && timelineTime < smoothTimeline.lastTime) {
      timelinePlaying = true;
      playbackLastTime = performance.now();
      updateTrajectory();
    } else {
      const time = timelineTime === null || timelineTime >= smoothTimeline.lastTime ? smoothTimeline.firstTime : timelineTime;
      seekSmoothTime(time, { animate: true, play: true });
    }
  });
  timelineInput.addEventListener('input', () => {
    if (!trajectory) return;
    const time = Number(timelineInput.value);
    if (timelineMode === 'smooth') { seekSmoothTime(time); return; }
    const nearest = trajectory.samples.reduce((closest, sample) => Math.abs(sample.time - time) < Math.abs(closest.time - time) ? sample : closest);
    if (nearest.index !== selectedCamera || !aligned) selectCamera(nearest.index, { animate: false });
  });
  timelineInput.addEventListener('change', updateTrajectory);
  timelineInput.addEventListener('keydown', event => {
    if (!trajectory || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (timelineMode === 'smooth') {
      const step = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 / 30 : -1 / 30;
      const time = event.key === 'Home' ? smoothTimeline.firstTime : event.key === 'End' ? smoothTimeline.lastTime : (timelineTime ?? smoothTimeline.firstTime) + step;
      seekSmoothTime(time);
      return;
    }
    const location = trajectory.samples.findIndex(sample => sample.index === selectedCamera);
    const step = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1;
    let next = THREE.MathUtils.clamp(location + step, 0, trajectory.samples.length - 1);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = trajectory.samples.length - 1;
    selectCamera(trajectory.samples[next].index);
  });
  cameraSelect.addEventListener('change', () => cameraSelect.value === '' ? resetView() : selectCamera(Number(cameraSelect.value)));
  document.querySelector('#close-camera').addEventListener('click', resetView);
  document.querySelector('#align-camera').addEventListener('click', () => timelineMode === 'smooth' ? seekSmoothTime(timelineTime, { animate: true }) : selectCamera(selectedCamera));
  function stepFrame(offset) {
    const index = selectedCamera + offset;
    if (!metadata.views[index]) return;
    if (timelineMode === 'smooth') seekSmoothTime(metadata.views[index].time_seconds, { animate: true });
    else selectCamera(index);
  }
  document.querySelector('#previous-camera').addEventListener('click', () => stepFrame(-1));
  document.querySelector('#next-camera').addEventListener('click', () => stepFrame(1));
  host.addEventListener('pointerdown', releaseTimeline, { capture: true });

  function updatePointSize() {
    if (!metadata) return;
    const size = Number(document.querySelector('#point-size').value) * (metadata.viewer_point_size || extent / 380);
    models.get('points')?.traverse(object => {
      if (object.isPoints) object.material.size = size;
    });
  }

  async function setMode(mode) {
    modeButtons.forEach(button => { button.disabled = true; });
    try {
      if (!models.has(mode)) {
        status.classList.remove('hidden', 'error');
        statusText.textContent = mode === 'points' ? 'Loading point cloud…' : 'Loading surface…';
        const gltf = await loader.loadAsync(base + `${modelPrefix}-${mode}.glb`, event => {
          if (event.total) statusText.textContent = `Loading ${mode === 'points' ? 'point cloud' : 'surface'}… ${Math.round(event.loaded / event.total * 100)}%`;
        });
        const object = gltf.scene;
        object.traverse(child => {
          if (child.isPoints) {
            child.material.dispose();
            child.material = new THREE.PointsMaterial({ vertexColors: true, sizeAttenuation: true, size: .008 });
          } else if (child.isMesh) {
            child.material.dispose();
            child.material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
          }
        });
        const bounds = new THREE.Box3().setFromObject(object);
        // Both representations share one coordinate frame from the export.
        object.position.sub(referenceCenter);
        models.set(mode, object);
        scene.add(object);
        if (!grid) {
          const size = bounds.getSize(new THREE.Vector3());
          extent = Math.max(size.x, size.y, size.z);
          sceneHeight = size.y;
          grid = new THREE.GridHelper(extent * 3, 30, lightTheme ? '#a3b69b' : '#4b5543', lightTheme ? '#cbd7c7' : '#3b4435');
          grid.position.y = metadata.bounds[0][1] - referenceCenter.y - extent * .015;
          grid.material.transparent = true;
          grid.material.opacity = .22;
          scene.add(grid);
          target.set(0, size.y * .04, 0);
          resetView();
        }
      }
      models.forEach((object, name) => { object.visible = name === mode; });
      currentMode = mode;
      updatePointSize();
      modeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
      document.querySelector('#mode-label').textContent = mode === 'points' ? 'COLORED POINT CLOUD' : 'OBSERVED SURFACE';
      document.querySelector('#point-controls').classList.toggle('hidden', mode !== 'points');
      document.querySelector('#download-glb').href = base + `${modelPrefix}-${mode}.glb`;
      status.classList.add('hidden');
    } catch (error) {
      showError(error);
    } finally {
      modeButtons.forEach(button => { button.disabled = false; });
    }
  }

  modeButtons.forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  document.querySelector('#point-size').addEventListener('input', updatePointSize);
  document.querySelector('#reset').addEventListener('click', resetView);
  document.querySelector('#rotate').addEventListener('click', event => {
    releaseTimeline();
    stopCameraTransition();
    leaveAlignedView();
    controls.autoRotate = !controls.autoRotate;
    event.currentTarget.setAttribute('aria-pressed', String(controls.autoRotate));
  });
  const fullscreenButton = document.querySelector('#fullscreen');
  if (!stage.requestFullscreen) fullscreenButton.hidden = true;
  fullscreenButton.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.requestFullscreen();
    } catch (error) { console.warn('Fullscreen unavailable', error); }
  });
  document.addEventListener('fullscreenchange', () => {
    fullscreenButton.setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen');
    resize();
  });
  host.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','r','R'].includes(event.key)) return;
    event.preventDefault();
    if (event.key.toLowerCase() === 'r') { resetView(); return; }
    releaseTimeline();
    stopCameraTransition();
    leaveAlignedView();
    const upToY = new THREE.Quaternion().setFromUnitVectors(camera.up, new THREE.Vector3(0, 1, 0));
    const offset = camera.position.clone().sub(controls.target);
    const sphere = new THREE.Spherical().setFromVector3(offset.applyQuaternion(upToY));
    if (event.key === 'ArrowLeft') sphere.theta -= .12;
    if (event.key === 'ArrowRight') sphere.theta += .12;
    if (event.key === 'ArrowUp') sphere.phi -= .10;
    if (event.key === 'ArrowDown') sphere.phi += .10;
    if (event.key === '+' || event.key === '=') sphere.radius *= .9;
    if (event.key === '-') sphere.radius *= 1.1;
    sphere.phi = THREE.MathUtils.clamp(sphere.phi,.05,controls.maxPolarAngle);
    sphere.radius = THREE.MathUtils.clamp(sphere.radius,controls.minDistance,controls.maxDistance);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sphere).applyQuaternion(upToY.invert()));
    controls.update();
  });
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault(); showError(new Error('WebGL context lost'));
  });
  function handleWheel(event) {
    if (!metadata || activePointers.size) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    releaseTimeline();
    stopCameraTransition();
    leaveAlignedView();
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
    const pixels = THREE.MathUtils.clamp(event.deltaY * units * (event.ctrlKey ? 10 : 1), -1000, 1000);
    const radius = zoomTarget ?? camera.position.distanceTo(controls.target);
    zoomTarget = THREE.MathUtils.clamp(radius * Math.pow(.95, -pixels * .01), controls.minDistance, controls.maxDistance);
  }
  renderer.domElement.addEventListener('wheel', handleWheel, { capture: true, passive: false });

  function updateSmoothZoom(delta) {
    if (zoomTarget === null) return;
    const offset = camera.position.clone().sub(controls.target);
    const radius = offset.length();
    const next = THREE.MathUtils.lerp(radius, zoomTarget, reducedMotion.matches ? 1 : 1 - Math.exp(-16 * delta));
    camera.position.copy(controls.target).add(offset.setLength(next));
    if (Math.abs(next - zoomTarget) < extent * .00001) zoomTarget = null;
  }
  const clock = new THREE.Clock();
  document.addEventListener('visibilitychange', () => { playbackLastTime = null; });
  renderer.setAnimationLoop(() => {
    const delta = Math.min(clock.getDelta(), .05);
    if (!document.hidden) {
      if (cameraTransition) {
        const progress = Math.min((performance.now() - cameraTransition.startedAt) / cameraTransition.duration, 1);
        cameraTransition.blend = interpolateCameraPose(camera, cameraTransition.from, cameraTransition.to, progress);
        updateProjection();
        if (progress === 1) finishCameraTransition();
      } else if (timelinePlaying) {
        advanceTimeline(performance.now());
      } else if (!aligned && !followingTimeline) {
        updateSmoothZoom(delta);
        controls.update(delta);
      }
      camera.updateMatrixWorld();
      updateFrustumProximity();
      trajectory?.updateProximity(camera.position);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, host.clientWidth, host.clientHeight);
      renderer.clear();
      renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
      renderer.setScissor(viewport.x, viewport.y, viewport.width, viewport.height);
      renderer.setScissorTest(true);
      renderer.render(scene, camera);
      renderer.setScissorTest(false);
    }
  });

  const response = await fetch(base + 'metadata.json');
  if (!response.ok) throw new Error('Reconstruction metadata missing');
  metadata = await response.json();
  referenceCenter.fromArray(metadata.bounds[0]).add(new THREE.Vector3().fromArray(metadata.bounds[1])).multiplyScalar(.5);
  document.querySelector('#point-count').textContent = `${Math.round(metadata.point_count / 1000)}k`;
  document.querySelector('#view-count').textContent = metadata.frames.length;
  await setMode(currentMode);
  buildCameras();
  buildTrajectory();
}

boot().catch(showError);
