// Real Three.js, GLB decoding and timeline math; only DOM/GPU rendering is mocked.
// Run from the repository root. This does not replace browser visual QA.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const core = pathToFileURL(process.cwd() + '/assets/js/vendor/three/build/three.module.js').href;
const THREE = await import(core);
const asModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
async function moduleSource(path) {
  return (await readFile(path, 'utf8')).replaceAll("from 'three'", `from '${core}'`);
}
const cameras = await import(asModule(await moduleSource('assets/js/reconstruction-cameras.js')));
const paths = await import(asModule(await moduleSource('assets/js/reconstruction-trajectory.js')));
const timelines = await import(asModule(await moduleSource('assets/js/reconstruction-timeline.js')));
const utils = asModule(await moduleSource('assets/js/vendor/three/examples/jsm/utils/BufferGeometryUtils.js'));
const loaderSource = (await moduleSource('assets/js/vendor/three/examples/jsm/loaders/GLTFLoader.js')).replace('../utils/BufferGeometryUtils.js', utils);
const { GLTFLoader } = await import(asModule(loaderSource));
const directory = 'assets/spatial/img-5064/';
const metadata = JSON.parse(await readFile(directory + 'metadata.json', 'utf8'));
async function parseGLB(name) {
  const bytes = await readFile(directory + name);
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
const previewGLB = await parseGLB(metadata.gallery_preview.file);
const fullGLB = await parseGLB('scene-points.glb');
let count = 0;
previewGLB.scene.traverse(object => { if (object.isPoints) count += object.geometry.attributes.position.count; });
assert.equal(count, metadata.gallery_preview.point_count);
assert(count < metadata.point_count && count > 0);
const previewBounds = new THREE.Box3().setFromObject(previewGLB.scene);
const fullBounds = new THREE.Box3().setFromObject(fullGLB.scene);
const previewSize = previewBounds.getSize(new THREE.Vector3());
const fullSize = fullBounds.getSize(new THREE.Vector3());
for (const axis of ['x', 'y', 'z']) assert(previewSize[axis] > fullSize[axis] * .95, 'Preview lost full-scene coverage');
console.log(`PASS: actual preview GLB decodes with ${count} points and retains full-scene bounds.`);

class Element {
  constructor() { this.listeners = {}; this.style = {}; this.children = []; this.dataset = {}; this.clientWidth = 320; this.clientHeight = 180; }
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  fire(name, event = {}) { for (const fn of this.listeners[name] || []) fn({ preventDefault() {}, ...event }); }
  setAttribute(name, value) { this[name] = value; }
  appendChild(child) { child.parent = this; this.children.push(child); }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
}
const renderers = [];
class Renderer {
  constructor() { this.domElement = new Element(); renderers.push(this); }
  setPixelRatio() {} setSize() {} setScissorTest() {} setViewport() {} clear() {} setScissor() {}
  setClearColor(color, alpha) { this.clearAlpha = alpha; }
  render(scene, camera) { this.lastCamera = camera; this.renderCount = (this.renderCount || 0) + 1; }
  dispose() { this.disposed = true; }
  forceContextLoss() { this.lost = true; this.domElement.fire('webglcontextlost'); }
}
const source = (await readFile('assets/js/spatial-gallery.js', 'utf8')).replace(/^import .*;\n/gm, '') + '\nreturn { previews };';
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
async function setup(reduced = false, failure = false) {
  const doc = new Element(), win = new Element(), motion = new Element();
  const toggle = new Element(), card = new Element(), host = new Element(), status = new Element();
  motion.matches = reduced; doc.hidden = false; win.devicePixelRatio = 2;
  win.matchMedia = () => motion;
  card.dataset = { assets: '/assets/spatial/img-5064/', previewModel: metadata.gallery_preview.file };
  card.querySelector = selector => selector.endsWith('viewport') ? host : status;
  doc.querySelector = () => toggle;
  doc.querySelectorAll = () => [card];
  const frames = new Map(); let id = 0, intersection, loads = 0;
  const env = {
    THREE: { ...THREE, WebGLRenderer: Renderer }, ...cameras, ...paths, ...timelines,
    GLTFLoader: class { async loadAsync(url) { loads++; assert(url.endsWith(metadata.gallery_preview.file)); if (failure) throw Error('Expected unavailable GLB'); return { scene: previewGLB.scene.clone(true) }; } },
    document: doc, window: win,
    console: { warn() {} },
    fetch: async () => ({ ok: true, json: async () => metadata }),
    ResizeObserver: class { observe() {} },
    IntersectionObserver: class { constructor(callback) { intersection = callback; } observe() {} },
    requestAnimationFrame: callback => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: key => frames.delete(key),
  };
  const api = await new AsyncFunction(...Object.keys(env), source)(...Object.values(env));
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return {
    ...api, doc, win, motion, toggle, host, status, frames, get loads() { return loads; },
    async visible(value) { intersection([{ target: card, isIntersecting: value }]); await flush(); },
    async fire(element, name) { element.fire(name); await flush(); },
    tick(time) { const next = frames.entries().next().value; assert(next, 'Expected animation frame'); frames.delete(next[0]); next[1](time); },
  };
}

const run = await setup();
assert.equal(run.loads, 0, 'Do not load offscreen previews');
await run.visible(true);
const preview = run.previews[0];
assert.equal(run.loads, 1);
assert.equal(preview.renderer.clearAlpha, 1, 'Moving geometry must not show the static RGB through holes');
assert.equal(run.frames.size, 1);
run.tick(0); run.tick(500);
assert.equal(preview.renderer.domElement.style.opacity, '1');
const center = new THREE.Vector3().fromArray(metadata.bounds[0]).add(new THREE.Vector3().fromArray(metadata.bounds[1])).multiplyScalar(.5);
const trajectory = paths.createCameraTrajectory(metadata.views, center, .024);
const timeline = timelines.createSmoothTimeline(metadata.views, trajectory, metadata.views.map(view => cameras.cameraMatrix(view, center)));
const lens = cameras.calibratedProjection(timeline.fixedView, preview.camera.near, preview.camera.far);
for (let step = 1; step <= 200; step++) {
  run.tick(500 + step * 100);
  const pose = timeline.sample(timeline.firstTime + preview.elapsed);
  assert(preview.camera.position.distanceTo(pose.position) < 1e-10);
  assert(preview.camera.quaternion.angleTo(pose.quaternion) < 1e-7);
  assert(preview.camera.projectionMatrix.equals(lens));
}
await run.fire(run.toggle, 'click');
assert.equal(run.frames.size, 0);
assert.equal(run.toggle.textContent, 'Play previews');
const pausedAt = preview.elapsed;
await run.fire(run.toggle, 'click'); run.tick(90000);
assert.equal(preview.elapsed, pausedAt, 'Resume must not jump over paused time');
run.tick(90100); assert(Math.abs(preview.elapsed - pausedAt - .1) < 1e-10);
const renderer = preview.renderer;
await run.visible(false);
assert(renderer.disposed && renderer.lost);
assert.equal(run.host.children.length, 0);
assert(!preview.failed, 'Intentional context release must not be treated as an error');
await run.visible(true); run.tick(100000);
assert.equal(run.loads, 1, 'Reuse decoded assets on scroll back');
assert.equal(run.host.children.length, 1);
run.doc.hidden = true; await run.fire(run.doc, 'visibilitychange');
assert.equal(run.frames.size, 0); assert.equal(preview.renderer, null);
run.doc.hidden = false; await run.fire(run.doc, 'visibilitychange'); run.tick(200000);
assert(Math.abs(preview.elapsed - pausedAt - .1) < 1e-10);
const duration = timeline.lastTime - timeline.firstTime;
preview.elapsed = duration - .1; preview.lastTime = null; run.tick(201000);
assert(+preview.renderer.domElement.style.opacity < .26);
run.tick(201200); assert(+preview.renderer.domElement.style.opacity < .26);
assert(preview.camera.position.distanceTo(timeline.sample(timeline.firstTime + .1).position) < 1e-8);
await run.fire(run.win, 'pagehide'); assert.equal(run.frames.size, 0);
await run.fire(run.win, 'pageshow'); assert.equal(run.frames.size, 1);
preview.renderer.domElement.fire('webglcontextlost');
assert(preview.failed && preview.renderer === null);
assert.equal(run.status.textContent, 'Open 3D scene');

const reduced = await setup(true);
await reduced.visible(true); assert.equal(reduced.loads, 0); assert.equal(reduced.frames.size, 0);
await reduced.fire(reduced.toggle, 'click'); assert.equal(reduced.loads, 1); assert.equal(reduced.frames.size, 1);
reduced.motion.matches = true; await reduced.fire(reduced.motion, 'change'); assert.equal(reduced.frames.size, 0);
await reduced.visible(false);
const failed = await setup(false, true);
await failed.visible(true); assert.equal(failed.status.textContent, 'Open 3D scene'); assert.equal(failed.frames.size, 0);
const markup = await readFile('_pages/spatial-gallery.html', 'utf8');
assert(markup.includes('class="spatial-card__link" href="{{ scene.url | relative_url }}"'));
assert(!markup.includes('gallery-card__link'), 'Scene links must not trigger the existing photo lightbox');
console.log('PASS: preview/viewer pose and lens parity over 200 samples, autoplay, pause/resume, hidden/offscreen lifecycle, loop fade, reduced motion and failure fallback.');
