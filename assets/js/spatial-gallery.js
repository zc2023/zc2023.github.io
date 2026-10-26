import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cameraMatrix, calibratedProjection, containedViewport } from './reconstruction-cameras.js';
import { createCameraPath } from './reconstruction-trajectory.js';
import { createSmoothTimeline } from './reconstruction-timeline.js';

const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
const toggle = document.querySelector('.spatial-motion-toggle');
let paused = motion.matches;

class ScenePreview {
  constructor(card) {
    this.card = card;
    this.host = card.querySelector('.spatial-card__viewport');
    this.status = card.querySelector('.spatial-card__status');
    this.visible = false;
    this.elapsed = 0;
    this.lastTime = null;
    this.frame = null;
    this.renderer = null;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
  }

  async load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const base = this.card.dataset.assets;
      this.status.textContent = 'Loading 3D preview…';
      const [response, gltf] = await Promise.all([
        fetch(base + 'metadata.json'),
        new GLTFLoader().loadAsync(base + this.card.dataset.previewModel),
      ]);
      if (!response.ok) throw new Error('Scene metadata unavailable');
      const metadata = await response.json();
      const center = new THREE.Vector3().fromArray(metadata.bounds[0]).add(new THREE.Vector3().fromArray(metadata.bounds[1])).multiplyScalar(.5);
      const path = createCameraPath(metadata.views, center);
      this.timeline = createSmoothTimeline(metadata.views, path, metadata.views.map(view => cameraMatrix(view, center)));
      this.scene = new THREE.Scene();
      gltf.scene.traverse(object => {
        if (object.isPoints) {
          object.material.dispose();
          object.material = new THREE.PointsMaterial({ vertexColors: true, sizeAttenuation: true, size: (metadata.gallery_preview?.point_size || metadata.viewer_point_size) * 1.2 });
        }
      });
      gltf.scene.position.sub(center);
      this.scene.add(gltf.scene);
      const extent = new THREE.Vector3().fromArray(metadata.bounds[1]).sub(new THREE.Vector3().fromArray(metadata.bounds[0])).length();
      this.camera = new THREE.PerspectiveCamera(34, 16 / 9, extent / 2000, extent * 60);
      this.camera.projectionMatrix.copy(calibratedProjection(this.timeline.fixedView, this.camera.near, this.camera.far));
      this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    })();
    return this.loading;
  }

  resize() {
    if (!this.renderer) return;
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height);
    this.viewport = containedViewport(width, height, this.timeline.fixedView.width, this.timeline.fixedView.height);
  }

  stop() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.lastTime = null;
  }

  release() {
    this.stop();
    const renderer = this.renderer;
    this.renderer = null;
    if (!renderer) return;
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }

  async refresh() {
    if (!this.visible || paused || document.hidden) {
      this.stop();
      if (!this.visible || document.hidden) this.release();
      if (paused && !this.failed) this.status.textContent = 'Preview paused · open scene';
      return;
    }
    if (this.failed) return;
    try {
      await this.load();
      if (!this.visible || paused || document.hidden || this.frame !== null) return;
      if (!this.renderer) {
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.setClearColor('#f3f6f2', 1);
        renderer.autoClear = false;
        renderer.domElement.setAttribute('aria-hidden', 'true');
        renderer.domElement.addEventListener('webglcontextlost', event => {
          event.preventDefault();
          if (this.renderer !== renderer) return;
          this.failed = true;
          this.release();
          this.status.textContent = 'Open 3D scene';
        });
        this.renderer = renderer;
        this.host.appendChild(renderer.domElement);
        this.resize();
      }
      this.status.textContent = 'Smooth path · 1×';
      this.frame = requestAnimationFrame(time => this.render(time));
    } catch (error) {
      this.failed = true;
      this.release();
      this.status.textContent = 'Open 3D scene';
      console.warn('Spatial preview unavailable', error);
    }
  }

  render(time) {
    this.frame = null;
    if (!this.renderer || !this.visible || paused || document.hidden) return;
    if (this.lastTime !== null) this.elapsed += (time - this.lastTime) / 1000;
    this.lastTime = time;
    const duration = this.timeline.lastTime - this.timeline.firstTime;
    const offset = this.elapsed % duration;
    const pose = this.timeline.sample(this.timeline.firstTime + offset);
    this.camera.position.copy(pose.position);
    this.camera.quaternion.copy(pose.quaternion);
    this.camera.up.set(0, 1, 0).applyQuaternion(pose.quaternion);
    this.camera.updateMatrixWorld();
    // Fade the loop boundary instead of visibly teleporting back to the start.
    const fade = Math.min(1, offset / .4, (duration - offset) / .4);
    this.renderer.domElement.style.opacity = String(fade);
    const viewport = this.viewport;
    if (!viewport) {
      this.frame = requestAnimationFrame(next => this.render(next));
      return;
    }
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.host.clientWidth, this.host.clientHeight);
    this.renderer.clear();
    this.renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
    this.renderer.setScissor(viewport.x, viewport.y, viewport.width, viewport.height);
    this.renderer.setScissorTest(true);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setScissorTest(false);
    this.frame = requestAnimationFrame(next => this.render(next));
  }
}

const previews = [...document.querySelectorAll('.spatial-card')].map(card => new ScenePreview(card));
const byElement = new Map(previews.map(preview => [preview.card, preview]));
function refreshMotion() {
  toggle.textContent = paused ? 'Play previews' : 'Pause previews';
  toggle.setAttribute('aria-pressed', String(paused));
  previews.forEach(preview => preview.refresh());
}
toggle.addEventListener('click', () => { paused = !paused; refreshMotion(); });
motion.addEventListener('change', () => { paused = motion.matches; refreshMotion(); });
document.addEventListener('visibilitychange', refreshMotion);
window.addEventListener('pagehide', () => previews.forEach(preview => preview.release()));
window.addEventListener('pageshow', refreshMotion);
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    const preview = byElement.get(entry.target);
    preview.visible = entry.isIntersecting;
    preview.refresh();
  });
}, { threshold: .05 });
previews.forEach(preview => observer.observe(preview.card));
refreshMotion();
