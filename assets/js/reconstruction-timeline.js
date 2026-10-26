import * as THREE from 'three';

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function interval(times, time) {
  let low = 0, high = times.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (times[middle] <= time) low = middle;
    else high = middle;
  }
  return low;
}

function hermite(a, b, derivativeA, derivativeB, u, duration) {
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * duration * derivativeA
    + (-2 * u3 + 3 * u2) * b + (u3 - u2) * duration * derivativeB;
}

// Monotone cubic time -> arc-length interpolation preserves capture times and
// keeps motion moving forward, with continuous speed at the captured frames.
function monotoneSlopes(times, values) {
  const durations = times.slice(1).map((time, i) => time - times[i]);
  const slopes = values.slice(1).map((value, i) => (value - values[i]) / durations[i]);
  return values.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === values.length - 1) return slopes.at(-1);
    if (slopes[i - 1] * slopes[i] <= 0) return 0;
    const w1 = 2 * durations[i] + durations[i - 1], w2 = durations[i] + 2 * durations[i - 1];
    return (w1 + w2) / (w1 / slopes[i - 1] + w2 / slopes[i]);
  });
}

export function createSmoothTimeline(views, trajectory, poseMatrices) {
  const samples = trajectory.samples;
  const times = samples.map(sample => sample.time);
  const firstTime = times[0], lastTime = times.at(-1);
  const width = views[0].width, height = views[0].height;
  const fixedView = {
    width, height,
    intrinsics: [
      [median(views.map(view => view.intrinsics[0][0] / view.width)) * width,
        median(views.map(view => view.intrinsics[0][1] / view.width)) * width,
        median(views.map(view => view.intrinsics[0][2] / view.width)) * width],
      [0, median(views.map(view => view.intrinsics[1][1] / view.height)) * height,
        median(views.map(view => view.intrinsics[1][2] / view.height)) * height],
      [0, 0, 1],
    ],
  };
  const quaternions = samples.map(sample => new THREE.Quaternion().setFromRotationMatrix(poseMatrices[sample.index]).normalize());
  for (let i = 1; i < quaternions.length; i++) {
    if (quaternions[i - 1].dot(quaternions[i]) < 0) quaternions[i].set(...quaternions[i].toArray().map(value => -value));
  }
  const components = quaternions.map(quaternion => quaternion.toArray());
  const derivatives = components.map((q, i) => {
    const before = Math.max(0, i - 1), after = Math.min(components.length - 1, i + 1);
    const h0 = times[i] - times[before], h1 = times[after] - times[i];
    const derivative = q.map((value, axis) => {
      if (i === 0) return (components[after][axis] - value) / h1;
      if (i === components.length - 1) return (value - components[before][axis]) / h0;
      return ((value - components[before][axis]) / h0 * h1 + (components[after][axis] - value) / h1 * h0) / (h0 + h1);
    });
    const radial = derivative.reduce((sum, value, axis) => sum + value * q[axis], 0);
    return derivative.map((value, axis) => value - radial * q[axis]);
  });

  const curve = trajectory.curve;
  const lengths = curve.getLengths();
  const totalLength = lengths.at(-1);
  const arcs = samples.map((_, i) => {
    const position = i / (samples.length - 1) * (lengths.length - 1);
    const lower = Math.floor(position), upper = Math.min(lower + 1, lengths.length - 1);
    return THREE.MathUtils.lerp(lengths[lower], lengths[upper], position - lower) / totalLength;
  });
  const arcSlopes = monotoneSlopes(times, arcs);

  function arcAtTime(time) {
    time = THREE.MathUtils.clamp(time, firstTime, lastTime);
    const i = interval(times, time), duration = times[i + 1] - times[i];
    return THREE.MathUtils.clamp(hermite(arcs[i], arcs[i + 1], arcSlopes[i], arcSlopes[i + 1], (time - times[i]) / duration, duration), arcs[i], arcs[i + 1]);
  }

  function timeAtArcLength(arc) {
    let low = firstTime, high = lastTime;
    for (let iteration = 0; iteration < 36; iteration++) {
      const middle = (low + high) / 2;
      if (arcAtTime(middle) < arc) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  }

  function sample(time) {
    time = THREE.MathUtils.clamp(time, firstTime, lastTime);
    const i = interval(times, time), duration = times[i + 1] - times[i], u = (time - times[i]) / duration;
    const quaternion = new THREE.Quaternion().fromArray(components[i].map((value, axis) =>
      hermite(value, components[i + 1][axis], derivatives[i][axis], derivatives[i + 1][axis], u, duration))).normalize();
    const arc = arcAtTime(time);
    return {
      time, arc, position: curve.getPointAt(arc), quaternion,
      nearestIndex: samples[u < .5 ? i : i + 1].index,
      focusDistance: THREE.MathUtils.lerp(views[samples[i].index].focus_distance, views[samples[i + 1].index].focus_distance, u),
    };
  }

  return { firstTime, lastTime, fixedView, sample, arcAtTime, timeAtArcLength };
}
