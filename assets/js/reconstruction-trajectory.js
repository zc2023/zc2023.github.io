import * as THREE from 'three';

export const TRAJECTORY_COLORS = ['#5591ff', '#38d5df', '#6cdb88', '#f5d65e', '#fb7867'];

function timeColor(fraction) {
  const scaled = THREE.MathUtils.clamp(fraction, 0, 1) * (TRAJECTORY_COLORS.length - 1);
  const index = Math.min(Math.floor(scaled), TRAJECTORY_COLORS.length - 2);
  return new THREE.Color(TRAJECTORY_COLORS[index]).lerp(new THREE.Color(TRAJECTORY_COLORS[index + 1]), scaled - index);
}

export function createCameraPath(views, center) {
  const samples = views.map((view, index) => ({
    index,
    time: view.time_seconds,
    position: new THREE.Vector3(...view.camera_to_world.slice(0, 3).map(row => row[3])).sub(center),
  })).sort((a, b) => a.time - b.time);
  const firstTime = samples[0].time, lastTime = samples.at(-1).time;
  samples.forEach(sample => {
    sample.fraction = (sample.time - firstTime) / (lastTime - firstTime || 1);
    sample.color = timeColor(sample.fraction);
  });
  // Centripetal Catmull–Rom passes through the capture positions with smooth
  // bends. Keep the path open, even when the video returns near its beginning.
  const curve = new THREE.CatmullRomCurve3(samples.map(sample => sample.position), false, 'centripetal');
  const tubularSegments = Math.max(256, (samples.length - 1) * 32);
  curve.arcLengthDivisions = tubularSegments * 32;
  curve.updateArcLengths();
  return { samples, firstTime, lastTime, curve, tubularSegments };
}

export function createCameraTrajectory(views, center, radius) {
  const { samples, firstTime, lastTime, curve, tubularSegments } = createCameraPath(views, center);
  const group = new THREE.Group();
  const radialSegments = 8;
  const ringSize = radialSegments + 1;
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
  const colors = new Float32Array(geometry.getAttribute('position').count * 4);
  const centerPositions = new Float32Array((tubularSegments + 1) * 3);
  const highlightColors = new Float32Array((tubularSegments + 1) * 4).fill(1);
  const centers = [];
  const parameters = [];
  for (let ring = 0; ring <= tubularSegments; ring++) {
    const u = ring / tubularSegments;
    const point = curve.getPointAt(u);
    centers.push(point);
    point.toArray(centerPositions, ring * 3);
    // Tube rings are spaced by arc length. Map them back to the source frame
    // intervals so the colors still represent elapsed time rather than distance.
    const parameter = curve.getUtoTmapping(u);
    parameters.push(parameter);
    const framePosition = parameter * (samples.length - 1);
    const frame = Math.min(Math.floor(framePosition), samples.length - 2);
    const time = THREE.MathUtils.lerp(samples[frame].time, samples[frame + 1].time, framePosition - frame);
    const color = timeColor((time - firstTime) / (lastTime - firstTime || 1));
    for (let radial = 0; radial < ringSize; radial++) {
      const offset = (ring * ringSize + radial) * 4;
      color.toArray(colors, offset);
      colors[offset + 3] = 1;
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .95, depthTest: false, depthWrite: false });
  const pathMesh = new THREE.Mesh(geometry, material);
  pathMesh.renderOrder = 1;
  group.add(pathMesh);
  const highlightGeometry = new THREE.BufferGeometry();
  highlightGeometry.setAttribute('position', new THREE.BufferAttribute(centerPositions, 3));
  highlightGeometry.setAttribute('color', new THREE.BufferAttribute(highlightColors, 4).setUsage(THREE.DynamicDrawUsage));
  const highlight = new THREE.Line(highlightGeometry, new THREE.LineBasicMaterial({ color: '#ffffff', vertexColors: true, transparent: true, opacity: .95, depthTest: false, depthWrite: false }));
  highlight.renderOrder = 1.5;
  highlight.visible = false;
  group.add(highlight);

  function select(index, visible) {
    const location = samples.findIndex(sample => sample.index === index);
    highlight.visible = location >= 0 && visible;
    if (!highlight.visible) return;
    const start = Math.max(0, location - 1) / (samples.length - 1);
    const end = Math.min(samples.length - 1, location + 1) / (samples.length - 1);
    const firstRing = Math.max(0, parameters.findIndex(parameter => parameter >= start) - 1);
    const endRing = parameters.findIndex(parameter => parameter > end);
    highlightGeometry.setDrawRange(firstRing, (endRing < 0 ? parameters.length : endRing + 1) - firstRing);
  }

  const previousCameraPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  function setTimeMapping(timeAtArcLength) {
    const pathColors = geometry.getAttribute('color');
    for (let ring = 0; ring <= tubularSegments; ring++) {
      const color = timeColor((timeAtArcLength(ring / tubularSegments) - firstTime) / (lastTime - firstTime || 1));
      for (let radial = 0; radial < ringSize; radial++) pathColors.setXYZ(ring * ringSize + radial, color.r, color.g, color.b);
    }
    pathColors.needsUpdate = true;
  }
  function updateProximity(cameraPosition) {
    if (!group.visible || previousCameraPosition.distanceToSquared(cameraPosition) < 1e-12) return;
    previousCameraPosition.copy(cameraPosition);
    const pathColors = geometry.getAttribute('color');
    const lineColors = highlightGeometry.getAttribute('color');
    for (let ring = 0; ring < centers.length; ring++) {
      const surfaceDistance = Math.max(0, cameraPosition.distanceTo(centers[ring]) - radius);
      const alpha = THREE.MathUtils.smootherstep(surfaceDistance, radius * 8, radius * 28);
      for (let radial = 0; radial < ringSize; radial++) pathColors.setW(ring * ringSize + radial, alpha);
      lineColors.setW(ring, alpha);
    }
    pathColors.needsUpdate = true;
    lineColors.needsUpdate = true;
  }

  return { group, samples, firstTime, lastTime, curve, pathMesh, highlight, select, updateProximity, setTimeMapping };
}
