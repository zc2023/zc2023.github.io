// Run from the repository root: node scripts/reconstruction/verify_viewer.mjs [scene-id] [initial-camera]
// Executes the production viewer/controller with real Three.js and OrbitControls.
// DOM, renderer and model loading are mocked; this does not replace browser visual QA.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const core = pathToFileURL(root + '/assets/js/vendor/three/build/three.module.js').href;
const RealThree = await import(core);
async function moduleAt(path) {
 const text = (await readFile(path, 'utf8')).replaceAll("from 'three'", `from '${core}'`);
 return import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'));
}
const helpers = await moduleAt('assets/js/reconstruction-cameras.js');
const trajectory = await moduleAt('assets/js/reconstruction-trajectory.js');
const timelineMath = await moduleAt('assets/js/reconstruction-timeline.js');
const { OrbitControls } = await moduleAt('assets/js/vendor/three/examples/jsm/controls/OrbitControls.js');
const directory = `assets/spatial/${process.argv[2] || 'img-5064'}/`;
const metadata = JSON.parse(await readFile(directory + 'metadata.json', 'utf8'));
class Element {
 constructor() { this.style={}; this.dataset={}; this.listeners={}; this.children=[]; this.value=''; this.checked=true; this.clientWidth=1000; this.clientHeight=850; this.classList={add(){},remove(){},toggle(){}}; }
 addEventListener(name,fn) { (this.listeners[name]??=[]).push(fn); }
 removeEventListener(name,fn) { this.listeners[name]=(this.listeners[name]??[]).filter(f=>f!==fn); }
 setAttribute(name,value) { this[name]=value; }
 appendChild(node) { this.children.push(node); }
 add(node) { this.children.push(node); }
 querySelectorAll() { return this.children; }
 getRootNode() { return doc; }
 getBoundingClientRect() { return {left:0,top:0,width:this.clientWidth,height:this.clientHeight}; }
 setPointerCapture() {}
 fire(name) { for(const fn of this.listeners[name]??[])fn({currentTarget:this,preventDefault(){}}); }
}
const elements=new Map();
const doc = new Element();
doc.hidden=false;
doc.querySelector=key=>{if(!elements.has(key))elements.set(key,new Element());return elements.get(key);};
const modeButtons=['points','surface'].map(mode=>{const button=new Element();button.dataset.mode=mode;return button;});
const timelineModeButtons=['frames','smooth'].map(mode=>{const button=new Element();button.dataset.timelineMode=mode;return button;});
doc.querySelectorAll=selector=>selector.includes('data-timeline-mode') ? timelineModeButtons : modeButtons;
doc.createElement=()=>new Element();
doc.querySelector('.experience').dataset={assets:'/'+directory,modelPrefix:'scene',initialCamera:process.argv[3]};
doc.querySelector('#point-size').value='1.2';
let loop, now=0, reduceMotion=false;
class Renderer {
 constructor(){this.domElement=new Element();}
 setPixelRatio(){} setSize(){} setScissorTest(){} setViewport(){} clear(){} setScissor(){}
 setAnimationLoop(callback){loop=callback;}
 render(scene,camera){scene.updateMatrixWorld(true);camera.updateMatrixWorld();}
}
class TextureLoader{load(path,done){done(new RealThree.Texture());}}
class Loader {
 async loadAsync(){
  const size=new RealThree.Vector3().fromArray(metadata.bounds[1]).sub(new RealThree.Vector3().fromArray(metadata.bounds[0]));
  const center=new RealThree.Vector3().fromArray(metadata.bounds[0]).add(new RealThree.Vector3().fromArray(metadata.bounds[1])).multiplyScalar(.5);
  const mesh=new RealThree.Mesh(new RealThree.BoxGeometry(size.x,size.y,size.z),new RealThree.MeshBasicMaterial());
  mesh.position.copy(center); const scene=new RealThree.Group();scene.add(mesh);return {scene};
 }
}
let source=await readFile('assets/js/reconstruction.js','utf8');
source=source.replace(/^import .*;\n/gm,'');
source=source.replace('  // Viewer ready.\n}',`  // Viewer ready.\n  return { camera, selectCamera, resetView, resize, stopCameraTransition, handleWheel, updateSmoothZoom, updateFrustumProximity, leaveAlignedView, cameraObjects, seekSmoothTime, advanceTimeline, releaseTimeline, get state() { return { aligned, selectedCamera, cameraTransition, viewport, controls, orbitProjection, zoomTarget, smoothTimeline, trajectory, timelineTime, timelineMode, timelinePlaying, followingTimeline }; } };\n}`);
source=source.replace('boot().catch(showError);','return await boot();');
const env={THREE:{...RealThree,WebGLRenderer:Renderer,TextureLoader},OrbitControls,GLTFLoader:Loader,...helpers,...trajectory,...timelineMath,document:doc,window:{devicePixelRatio:1,matchMedia:()=>({get matches(){return reduceMotion;}})},ResizeObserver:class{observe(){}},Option:class{constructor(text,value){this.text=text;this.value=value;}},fetch:async()=>({ok:true,json:async()=>metadata}),performance:{now:()=>now}};
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const api=await new AsyncFunction(...Object.keys(env),source)(...Object.values(env));
assert.equal(api.cameraObjects.length,24);
if (process.argv[3] !== undefined) {
 assert.equal(api.state.selectedCamera, Number(process.argv[3]));
 assert(api.state.aligned && !api.state.cameraTransition && api.state.controls.enabled);
 assert.equal(api.cameraObjects[Number(process.argv[3])].group.visible, false);
 console.log('PASS: configured initial camera opens directly at its calibrated pose.');
 api.resetView();
}
assert(api.cameraObjects.every(o=>o.plane.material.opacity===.5));
const start=api.camera.position.clone();
api.selectCamera(0);
assert(!api.state.aligned && !api.state.controls.enabled && api.state.cameraTransition);
assert(api.camera.position.distanceTo(start)<1e-10);
now=500;loop();
assert(api.camera.position.distanceTo(start)>.001);
assert(Number.isFinite(api.camera.projectionMatrix.determinant()) && api.camera.projectionMatrix.determinant()!==0);
const middle=api.camera.position.clone(), projection=api.camera.projectionMatrix.clone();
api.selectCamera(1);
assert(api.camera.position.distanceTo(middle)<1e-10);
assert(api.camera.projectionMatrix.elements.every((v,i)=>Math.abs(v-projection.elements[i])<1e-10));
now+=1000;loop();
assert(api.state.aligned && api.state.controls.enabled && !api.state.cameraTransition);
const center=new RealThree.Vector3().fromArray(metadata.bounds[0]).add(new RealThree.Vector3().fromArray(metadata.bounds[1])).multiplyScalar(.5);
const expected=helpers.cameraMatrix(metadata.views[1],center);
assert(api.camera.position.distanceTo(new RealThree.Vector3().setFromMatrixPosition(expected))<1e-10);
assert(api.camera.projectionMatrix.equals(helpers.calibratedProjection(metadata.views[1],api.camera.near,api.camera.far)));
api.selectCamera(5); now+=200;loop();api.resetView();assert(!api.state.cameraTransition && api.state.selectedCamera===-1 && api.state.controls.enabled);
api.selectCamera(4);now+=200;loop();const beforeStop=api.camera.position.clone();api.stopCameraTransition();assert(!api.state.cameraTransition && api.state.controls.enabled && api.camera.position.distanceTo(beforeStop)<1e-10);
api.selectCamera(8);doc.querySelector('#viewer').clientWidth=390;doc.querySelector('#viewer').clientHeight=600;api.resize();now+=1000;loop();assert(Math.abs(api.state.viewport.width/api.state.viewport.height-16/9)<1e-10);assert(api.state.aligned);
api.selectCamera(9);const time=doc.querySelector('#trajectory-time');time.value=metadata.views[13].time_seconds;time.fire('input');assert(api.state.aligned && !api.state.cameraTransition && api.state.selectedCamera===13);
reduceMotion=true;api.selectCamera(19);assert(api.state.aligned && !api.state.cameraTransition && api.state.selectedCamera===19);
console.log('PASS: viewer controller with real Three.js/OrbitControls and a mocked renderer: 50% opacity, animated movement, continuous retargeting, exact final calibration, reset/scroll cancellation, resize, immediate timeline scrubbing and reduced motion.');
reduceMotion=false;
for (let index=0;index<metadata.views.length;index++) {
 api.selectCamera(index,{animate:false});
 const projection=api.camera.projectionMatrix.clone();
 const position=api.camera.position.clone();
 const viewport={...api.state.viewport};
 const radius=api.camera.position.distanceTo(api.state.controls.target);
 let prevented=false,stopped=false;
 api.handleWheel({deltaY:100,deltaMode:0,ctrlKey:false,preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
 assert(prevented&&stopped);
 assert(!api.state.aligned);
 assert(api.camera.position.distanceTo(position)<1e-10,'Wheel event must not jump the camera immediately');
 assert(api.camera.projectionMatrix.equals(projection),'Leaving alignment changed intrinsics');
 assert.deepEqual(api.state.viewport,viewport,'Leaving alignment changed viewport');
 assert.equal(api.cameraObjects[index].plane.material.opacity,0,'Near-camera image popped in after leaving alignment');
 assert.equal(api.cameraObjects[index].lines.visible,false,'Near-camera edges popped in after leaving alignment');
 const targetRadius=api.state.zoomTarget;
 api.updateSmoothZoom(1/60);api.state.controls.update();api.updateFrustumProximity();
 const firstRadius=api.camera.position.distanceTo(api.state.controls.target);
 assert(firstRadius>radius && firstRadius<targetRadius,'Wheel zoom did not ease over several frames');
 for(let frame=0;frame<90;frame++){api.updateSmoothZoom(1/60);api.state.controls.update();}
 assert.equal(api.state.zoomTarget,null);
 assert(Math.abs(api.camera.position.distanceTo(api.state.controls.target)-targetRadius)<.001);
 assert(api.camera.projectionMatrix.equals(projection),'Zoom changed calibrated lens');
 const object=api.cameraObjects[index];
 for(const edgeIndex of [0,2,4,6]){
  const edge=object.worldEdges[edgeIndex];
  const midpoint=edge.start.clone().lerp(edge.end,.5);
  api.camera.position.copy(midpoint);api.updateFrustumProximity();
  assert.equal(object.lines.geometry.attributes.color.getW(edgeIndex*2),0,'A nearby frustum side edge did not disappear');
  const perpendicular=edge.end.clone().sub(edge.start).cross(new RealThree.Vector3(0,1,0)).normalize();
  let previousAlpha=0;
  const alphas=[];
  for(const distance of [0,.2,.4,.6,.8,1,2]){
   api.camera.position.copy(midpoint).addScaledVector(perpendicular,distance*object.planeDistance);
   api.updateFrustumProximity();
   const alpha=object.lines.geometry.attributes.color.getW(edgeIndex*2);
   assert(alpha>=previousAlpha-1e-6 && alpha>=0 && alpha<=1,'Edge fading is not continuous with distance');
   alphas.push(alpha);previousAlpha=alpha;
  }
  assert(alphas.some(alpha=>alpha>0&&alpha<1),'Edge should fade rather than toggle abruptly');
 }
 api.camera.position.copy(object.group.position).addScalar(object.planeDistance*10);api.updateFrustumProximity();
 assert.equal(object.plane.material.opacity,.5);
 for(let vertex=0;vertex<object.lines.geometry.attributes.color.count;vertex++)assert.equal(object.lines.geometry.attributes.color.getW(vertex),1);
}
api.resetView();assert(Math.abs(api.state.viewport.width/api.state.viewport.height-16/9)<1e-10);
api.selectCamera(3);assert.equal(api.state.cameraTransition.duration,1000);
now+=999;loop();assert(api.state.cameraTransition,'Flight ended before one second');
now+=1;loop();assert(!api.state.cameraTransition && api.state.aligned);
const midLens=api.camera.projectionMatrix.clone();
doc.querySelector('#viewer').clientWidth=1700;doc.querySelector('#viewer').clientHeight=650;api.resize();
assert(api.camera.projectionMatrix.equals(midLens));assert(Math.abs(api.state.viewport.width/api.state.viewport.height-16/9)<1e-10);
console.log('PASS: all 24 wheel handoffs preserve intrinsics and viewport, eased wheel zoom, no near-origin overlay pop, 96 side-edge fade checks, restored distant opacity, fixed 16:9 resize, exact 1000ms transition.');

const radius=.024;
const route=trajectory.createCameraTrajectory(metadata.views,center,radius);
assert.equal(route.curve.closed,false);
const centerline=route.highlight.geometry.getAttribute('position');
const pathColors=route.pathMesh.geometry.getAttribute('color');
const highlightColors=route.highlight.geometry.getAttribute('color');
const ringSize=pathColors.count/centerline.count;
assert.equal(pathColors.itemSize,4);
assert.equal(new RealThree.Color().fromBufferAttribute(pathColors,0).getHexString(),'5591ff');
assert.equal(new RealThree.Color().fromBufferAttribute(pathColors,pathColors.count-1).getHexString(),'fb7867');
for(let index=0;index<route.samples.length;index++){
 const sample=route.samples[index];
 const t=index/(route.samples.length-1);
 assert(route.curve.getPoint(t).distanceTo(sample.position)<1e-10,'Smoothed path must pass through every camera pose');
 assert.equal(sample.time,metadata.views[index].time_seconds);
 if(index>0&&index<route.samples.length-1){
  const angle=route.curve.getTangent(t-1e-6).angleTo(route.curve.getTangent(t+1e-6));
  assert(angle<.02,'Camera trajectory has a sharp tangent change');
 }
 route.select(index,true);route.updateProximity(sample.position);
 let nearest=0,minDistance=Infinity;
 const point=new RealThree.Vector3();
 for(let ring=0;ring<centerline.count;ring++){
  point.fromBufferAttribute(centerline,ring);
  const distance=point.distanceTo(sample.position);
  if(distance<minDistance){minDistance=distance;nearest=ring;}
  assert.equal(pathColors.getW(ring*ringSize),highlightColors.getW(ring),'Highlight and colored path must fade together');
 }
 assert.equal(pathColors.getW(nearest*ringSize),0,'Trajectory near the viewer must disappear');
 assert(route.highlight.geometry.drawRange.start<=nearest && route.highlight.geometry.drawRange.start+route.highlight.geometry.drawRange.count>nearest);
 assert(Array.from({length:centerline.count},(_,ring)=>pathColors.getW(ring*ringSize)).some(alpha=>alpha===1),'Distant parts of the path should stay visible');
}
const probeRing=Math.floor(centerline.count/2);
const probe=new RealThree.Vector3().fromBufferAttribute(centerline,probeRing);
let previousAlpha=0,hasPartialFade=false;
for(const distance of [0,8,12,20,29,40]){
 route.updateProximity(probe.clone().add(new RealThree.Vector3(0,0,distance*radius)));
 const alpha=pathColors.getW(probeRing*ringSize);
 assert(alpha>=previousAlpha && alpha>=0 && alpha<=1);
 hasPartialFade ||= alpha>0 && alpha<1;
 previousAlpha=alpha;
}
assert(hasPartialFade);
assert.equal(previousAlpha,1);
for(const mesh of [route.pathMesh,route.highlight])for(const attribute of Object.values(mesh.geometry.attributes))assert([...attribute.array].every(Number.isFinite));
console.log('PASS: smooth open trajectory through all 24 poses, continuous bends, timestamp colors, local near-camera fading with distant portions retained, synchronized curved highlight and opacity restoration.');

const timelineModel=timelineMath.createSmoothTimeline(metadata.views,route,metadata.views.map(view=>helpers.cameraMatrix(view,center)));
let maxPositionKnotError=0,maxVelocityJump=0,maxAngularVelocityJump=0;
function angularVelocity(a,b,dt){
 const relative=a.clone().invert().multiply(b).normalize();
 if(relative.w<0)relative.set(-relative.x,-relative.y,-relative.z,-relative.w);
 const vector=new RealThree.Vector3(relative.x,relative.y,relative.z);
 const length=vector.length();
 return length<1e-12 ? vector.set(0,0,0) : vector.multiplyScalar(2*Math.atan2(length,relative.w)/length/dt);
}
for(let index=0;index<metadata.views.length;index++){
 const time=metadata.views[index].time_seconds;
 const pose=timelineModel.sample(time);
 const matrix=helpers.cameraMatrix(metadata.views[index],center);
 const expectedQuaternion=new RealThree.Quaternion().setFromRotationMatrix(matrix).normalize();
 maxPositionKnotError=Math.max(maxPositionKnotError,pose.position.distanceTo(new RealThree.Vector3().setFromMatrixPosition(matrix)));
 assert(pose.quaternion.angleTo(expectedQuaternion)<1e-7,'Fitted orientation must pass through capture orientations');
 assert(Math.abs(timelineModel.timeAtArcLength(pose.arc)-time)<1e-7);
 if(index>0&&index<metadata.views.length-1){
  const epsilon=.0001;
  const before=timelineModel.sample(time-epsilon),after=timelineModel.sample(time+epsilon);
  const incoming=pose.position.clone().sub(before.position).divideScalar(epsilon);
  const outgoing=after.position.clone().sub(pose.position).divideScalar(epsilon);
  maxVelocityJump=Math.max(maxVelocityJump,incoming.distanceTo(outgoing));
  maxAngularVelocityJump=Math.max(maxAngularVelocityJump,angularVelocity(before.quaternion,pose.quaternion,epsilon).distanceTo(angularVelocity(pose.quaternion,after.quaternion,epsilon)));
 }
}
assert(maxPositionKnotError<1e-6,'Time mapping must hit captured positions on the displayed curve');
assert(maxVelocityJump<.02,'Fitted speed is discontinuous at a capture timestamp');
assert(maxAngularVelocityJump<.002,'Fitted angular velocity is discontinuous at a capture timestamp');
let previousArc=-1,previousQuaternion;
for(let i=0;i<=1000;i++){
 const time=timelineModel.firstTime+(timelineModel.lastTime-timelineModel.firstTime)*i/1000;
 const pose=timelineModel.sample(time);
 assert(pose.arc>=previousArc && pose.arc>=0 && pose.arc<=1,'Continuous timeline must not reverse along the path');
 assert(pose.position.distanceTo(route.curve.getPointAt(pose.arc))<1e-10);
 assert(Math.abs(pose.quaternion.length()-1)<1e-10);
 if(previousQuaternion)assert(previousQuaternion.dot(pose.quaternion)>0,'Quaternion interpolation flipped');
 previousArc=pose.arc;previousQuaternion=pose.quaternion;
}
const middleTime=(metadata.views[8].time_seconds+metadata.views[9].time_seconds)/2+.02;
timelineModeButtons[1].fire('click');
assert.equal(api.state.cameraTransition.kind,'smooth');
now+=1000;loop();
assert(api.state.followingTimeline && !api.state.aligned && api.state.timelineMode==='smooth');
const input=doc.querySelector('#trajectory-time');input.value=middleTime;input.fire('input');input.fire('change');
assert(Math.abs(api.state.timelineTime-middleTime)<1e-9 && Number(input.value)===middleTime,'Smooth timeline must not snap to a captured frame');
const modelPose=api.state.smoothTimeline.sample(middleTime);
assert(api.camera.position.distanceTo(modelPose.position)<1e-10);
assert(api.camera.quaternion.angleTo(modelPose.quaternion)<1e-7);
assert.equal(doc.querySelector('#camera-image').dataset.frameIndex,String(modelPose.nearestIndex));
const fixedProjection=api.camera.projectionMatrix.clone();
for(const view of metadata.views){api.seekSmoothTime(view.time_seconds);assert(api.camera.projectionMatrix.equals(fixedProjection),'Smooth mode changed intrinsics along the video');}
api.seekSmoothTime(middleTime);
doc.querySelector('#timeline-play').fire('click');assert(api.state.timelinePlaying);
now+=1250;loop();assert(Math.abs(api.state.timelineTime-middleTime-1.25)<1e-9,'Playback must use video time at 1x');
doc.querySelector('#timeline-play').fire('click');const pausedPosition=api.camera.position.clone(),pausedTime=api.state.timelineTime;
now+=2000;loop();assert(!api.state.timelinePlaying && api.state.timelineTime===pausedTime && api.camera.position.distanceTo(pausedPosition)<1e-10);
doc.querySelector('#timeline-play').fire('click');doc.fire('visibilitychange');now+=10000;loop();assert.equal(api.state.timelineTime,pausedTime,'Returning from a hidden tab jumped the timeline');
api.seekSmoothTime(timelineModel.lastTime-.1,{play:true});now+=1000;loop();
assert(!api.state.timelinePlaying && api.state.followingTimeline && api.state.timelineTime===timelineModel.lastTime,'Playback must stop at the final timestamp');
doc.querySelector('#timeline-play').fire('click');assert(api.state.cameraTransition.playAfter);
now+=1000;loop();assert(api.state.timelinePlaying && api.state.timelineTime===timelineModel.firstTime);
now+=500;loop();assert(Math.abs(api.state.timelineTime-timelineModel.firstTime-.5)<1e-9);
const beforeRelease=api.camera.position.clone(),lensBeforeRelease=api.camera.projectionMatrix.clone();
doc.querySelector('#viewer').fire('pointerdown');
assert(!api.state.followingTimeline&&!api.state.timelinePlaying&&api.state.controls.enabled);
assert(api.camera.position.distanceTo(beforeRelease)<1e-10&&api.camera.projectionMatrix.equals(lensBeforeRelease),'Manual orbit handoff jumped the pose or lens');
api.seekSmoothTime(middleTime,{play:true});api.handleWheel({deltaY:100,deltaMode:0,preventDefault(){},stopImmediatePropagation(){}});
assert(!api.state.timelinePlaying&&!api.state.followingTimeline&&api.camera.projectionMatrix.equals(fixedProjection));
timelineModeButtons[0].fire('click');now+=1000;loop();
assert(api.state.timelineMode==='frames'&&api.state.aligned&&api.state.controls.enabled);
assert(api.camera.projectionMatrix.equals(helpers.calibratedProjection(metadata.views[api.state.selectedCamera],api.camera.near,api.camera.far)));
console.log('PASS: continuous fixed-lens timeline, exact curve/orientation knots, monotone time mapping, no quaternion flips, playback/pause/replay, continuous scrubbing, nearest-RGB labeling and seamless manual handoff.',{maxPositionKnotError,maxVelocityJump,maxAngularVelocityJump});
