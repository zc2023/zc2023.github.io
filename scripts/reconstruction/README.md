# IMG_5064 video reconstruction

The local pipeline uses `facebook/map-anything` to reconstruct the full scene
in `map-anything/my_videos/IMG_5064.MOV`. It runs on Apple M4 / 16 GB using MPS.
The full-scene run uses all 24 selected, uncropped video frames at **448 × 252**
pixels, preserving the original 16:9 field of view. It uses FP32 for numerical
stability. Source footage,
weights, the Python environment and intermediate arrays remain in the ignored
`map-anything/` directory.

## Outputs

- `assets/spatial/img-5064/scene.ply`: every finite, positive-depth point
  accepted by the model's geometry-validity mask, including the table and room.
- `assets/spatial/img-5064/scene-points.glb`: spatially sampled full scene
  for browser display. Every occupied voxel retains a representative point.
- `assets/spatial/img-5064/scene-surface.glb`: full-scene per-view surfaces.
- `assets/spatial/img-5064/metadata.json`: exact inputs and processing notes.
- `assets/spatial/img-5064/rgb/`: the 24 uncropped RGB inference frames,
  JPEG encoded at 448 × 252, with per-frame intrinsics, poses and video timestamps
  in `metadata.json` under `views`.
- `assets/spatial/img-5064/preview-points.glb`: compact full-scene gallery preview.
- `/spatial-gallery/`: light gallery with autoplaying Smooth path cards.
- `/spatial-gallery/img-5064/`: interactive scene, linked from the gallery and
  Personal Posts. `/reconstruction/` remains a working alias.

Earlier car-only runs can export separately to the local paths below. These
assets are not used or published by Spatial Gallery:

- `assets/models/map-anything-car/car.ply`: filtered, colored observed points (sRGB).
- `assets/models/map-anything-car/car-points.glb`: point cloud for the website.
- `assets/models/map-anything-car/car-surface.glb`: per-view surface triangles.
- `assets/models/map-anything-car/metadata.json`: frame list, transforms, camera
  poses, counts, inference settings and processing notes.

The reconstruction contains residual misalignment and holes; the unobserved
underside is not filled. Scale is predicted, not calibrated against a measured
reference. The surface file is not a watertight or fused CAD model.

## Environment

Commands below run from the repository root. The environment created for this
run is `map-anything/.venv`, using Python 3.13 and the existing base PyTorch 2.12
installation through `--system-site-packages`. Other dependencies are installed
inside that virtual environment. macOS Vision provides foreground masks locally.
The model has no network dependencies during inference.

If recreating the environment, install an MPS-capable PyTorch and torchvision,
then install the local MapAnything package. A tested setup command on this Mac is:

```sh
/Users/czhang/miniconda3/bin/python -m venv --system-site-packages map-anything/.venv
map-anything/.venv/bin/python -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -e ./map-anything
```

Checkpoint SHA-256:
`981f060c64664dff3272b5f5a823d350abe71a2f144444db4cfc325f3ed5a3a0`.

## Reproduce the full scene

```sh
map-anything/.venv/bin/python scripts/reconstruction/prepare.py \
  map-anything/my_videos/IMG_5064.MOV map-anything/outputs/IMG_5064 --count 24

map-anything/.venv/bin/python scripts/reconstruction/infer.py \
  map-anything/outputs/IMG_5064/frames map-anything/outputs/IMG_5064/scene-result \
  --width 448 --height 252 --precision fp32

map-anything/.venv/bin/python scripts/reconstruction/export_scene.py \
  map-anything/outputs/IMG_5064/scene-result assets/spatial/img-5064

map-anything/.venv/bin/python scripts/reconstruction/render_preview.py \
  assets/spatial/img-5064/scene.ply assets/spatial/img-5064/preview.jpg

map-anything/.venv/bin/python scripts/reconstruction/prepare_gallery.py \
  assets/spatial/img-5064
```

This path does not call `crop.py`, `foreground.swift`, or the car-only exporter.
It does not read object annotations or segmentation masks. It keeps background
objects and geometry below the table, without a foreground support filter or
spatial bounding-box cutoff. Model validity filtering (uncertain pixels, depth
edges and low confidence) still applies. The PLY is not voxel-downsampled.
The display transform rotates/translates the scene without changing scale.

To add or refresh camera/RGB assets from an existing prediction without rerunning
inference or exporting the point cloud again:

```sh
map-anything/.venv/bin/python scripts/reconstruction/export_cameras.py \
  map-anything/outputs/IMG_5064/scene-result assets/spatial/img-5064
```

## VGGT-Omega version

The separate `/spatial-gallery/img-5064-vggt-omega/` scene (also available at
`/reconstruction-vggt-omega/`) uses the same 24 frames with
`weights/vggt_omega_1b_512.pt`. Its official `max_size` preprocessing at resolution
512 produces 512 × 288 inputs; the original scene uses MapAnything at 448 × 252.
This preserves the complete 16:9 frame and fits the local 16 GB MPS workflow.
`--resize-mode balanced` remains available for the 688 × 384 pixel-budget mode,
which is substantially slower on this Mac and was not used for these scene assets.
These are application demos, not a controlled benchmark comparison.

The local NumPy 2 compatible package is installed in `map-anything/.venv`.
Its packaging changes are recorded in
`map-anything/.deps/vggt-omega/LOCAL_COMPATIBILITY.txt`.

```sh
map-anything/.venv/bin/python scripts/reconstruction/infer_vggt_omega.py \
  map-anything/outputs/IMG_5064/frames map-anything/outputs/IMG_5064/vggt-omega-result

map-anything/.venv/bin/python scripts/reconstruction/export_scene.py \
  map-anything/outputs/IMG_5064/vggt-omega-result assets/spatial/img-5064-vggt-omega

map-anything/.venv/bin/python scripts/reconstruction/prepare_gallery.py \
  assets/spatial/img-5064-vggt-omega

cp assets/spatial/img-5064-vggt-omega/rgb/004.jpg \
  assets/spatial/img-5064-vggt-omega/source.jpg

map-anything/.venv/bin/python scripts/reconstruction/render_preview.py \
  assets/spatial/img-5064-vggt-omega/scene.ply assets/spatial/img-5064-vggt-omega/preview.jpg

node scripts/reconstruction/verify_cameras.mjs img-5064-vggt-omega
node scripts/reconstruction/verify_gallery.mjs img-5064-vggt-omega
node scripts/reconstruction/verify_viewer.mjs img-5064-vggt-omega 4
```

Inference uses all frames jointly in FP32 on MPS. Independent image encoding
and dense decoding use one frame at a time, and exact query-chunked attention
bounds temporary memory while retaining all keys for every query. K/V tensors
and query chunks are made contiguous. Each large attention chunk is synchronized
before the next is queued, allowing MPS to reuse temporary buffers on 16 GB
unified memory. A full 25,176-token attention check agreed with CPU FP32 to a
maximum absolute error of approximately 2e-7. The checkpoint
is loaded strictly. Metadata records its SHA-256, package/source revision, input
dimensions, filtering, timings and the largest logged live MPS allocation.
The export retains finite positive depth above the per-view 15th confidence
percentile and rejects intersecting depth/normal discontinuities. There is no
foreground segmentation. VGGT-Omega scale is relative, not physically calibrated.

The two pages and gallery cards share the same viewer, with model-specific
attribution and links between versions. Checkpoints under `weights/` are excluded
from the Jekyll build as well as Git.

The completed 24-view run took 76.3 seconds for inference, with a largest logged
live MPS allocation of 5.23 GB. It exported 2,963,230 valid dense points,
436,829 browser points and 1,433,327 per-view triangles. The gallery preview has
164,213 points. The page opens directly at calibrated frame 05 so that the car
is visible within the much larger reconstructed room; Reset view shows the
complete scene. The original MapAnything page still starts in overview.

VGGT-Omega checkpoint SHA-256:
`c02da418b18bb01d0392598d3f6147366bcde1bb70fd08a5e3bf7925b0667934`.

## Reproduce the car-only version

```sh
map-anything/.venv/bin/python scripts/reconstruction/prepare.py \
  map-anything/my_videos/IMG_5064.MOV map-anything/outputs/IMG_5064 --count 24

map-anything/.venv/bin/python scripts/reconstruction/crop.py \
  map-anything/outputs/IMG_5064 scripts/reconstruction/IMG_5064.json

swift scripts/reconstruction/foreground.swift \
  map-anything/outputs/IMG_5064/crops map-anything/outputs/IMG_5064/masks

map-anything/.venv/bin/python scripts/reconstruction/infer.py \
  map-anything/outputs/IMG_5064/crops map-anything/outputs/IMG_5064/full-result --width 392

map-anything/.venv/bin/python scripts/reconstruction/export.py \
  map-anything/outputs/IMG_5064 map-anything/outputs/IMG_5064/full-result \
  assets/models/map-anything-car

map-anything/.venv/bin/python scripts/reconstruction/render_preview.py \
  assets/models/map-anything-car/car.ply assets/models/map-anything-car/preview.jpg
```

`IMG_5064.json` contains manually reviewed bounds for this specific clip and frame
selection. Review the contact sheet and update these bounds when changing the
source or selection. Input images retain surrounding context for pose estimation;
foreground masking is applied to exported geometry.

## Memory and quality controls

The loader constructs the architecture on the meta device, restores shared
parameter aliases omitted by Safetensors, and requires a strict checkpoint match.
It uses the bundled DINOv2 implementation. `--precision fp32` keeps the entire
model in FP32 and disables autocast; this is used for the full scene. The original
car-only run uses FP16 encoder/attention matrices while normalization, geometric
fusion and prediction heads retain FP32.

Long attention sequences are split into 512-query blocks. Each block still
attends to all keys. Explicit FP32 scores and softmax avoid an observed MPS SDPA
failure with long, strided sequences. A strided-input numerical check against
CPU FP32 attention had a maximum absolute error of `0.00006103515625`.

The 24-view full-scene run took approximately 103 seconds including prediction
serialization. Its largest logged live MPS allocation was approximately 5.75 GB.
It produced 2,247,953 valid dense points; the web GLB retains 762,518 occupied
voxel representatives and the surface contains 1,083,305 triangles.

The car-only run took approximately 22 seconds including prediction serialization.
The largest logged live MPS allocation was approximately 3.4 GB; this is not a
measurement of total system memory or driver-cache peak.

The car-only exporter requires valid masks and finite geometry, then:

1. Applies reviewed foreground masks and erodes boundaries by one input pixel.
2. Retains points supported by at least two other foreground depth maps within
   2% camera-depth agreement.
3. Estimates the visible table plane to orient the car, retaining model scale.
4. Removes sparse outliers and merges small voxels for the point representation.
5. Builds triangles at every second pixel, rejecting long edges. Unseen geometry
   is not generated. glTF vertex colors are converted from sRGB to linear.

The original-frame predictions are saved in `scene-result/predictions.npz`;
`full-result/predictions.npz` contains the earlier car-cropped inference. The
latter cannot recover the original frame's entire field of view. Changing export
filters does not require running the model again, but changing input framing does.

## Website

The **Spatial Gallery** navigation entry is beside Gallery. Its cards follow the
same Smooth path positions, fitted orientations and fixed intrinsics as the
interactive viewer, at the video's original speed. The small preview is sampled
from the published full scene; opening a card loads the complete scene. A short
fade hides the loop reset. Previews pause when hidden or outside the viewport,
release unused WebGL contexts, and honor reduced motion. Static poster links
remain usable if WebGL is unavailable. Both gallery and scene pages use a light
palette.

Scene definitions live in `_spatial/`; Jekyll generates each detail page from the
shared `_layouts/spatial-scene.html`. All public files live in `assets/spatial/`,
so deployment needs none of the ignored MapAnything files. The asset directory's
README documents how to add another scene without modifying the gallery code.

The viewer shows camera frustums with an RGB image on each quadrilateral base by
default, without spheres at the camera origins. Click an RGB rectangle (from
either side) or choose a frame in the list to move to that capture pose and show
its RGB reference. Frustums and RGB planes can be toggled; hidden planes cannot
be clicked. Previous/next buttons step through the 24 frames. Dragging leaves
the aligned view; **Align view** restores it, and **Reset view** returns to the
scene overview. Both point-cloud and surface modes support these controls.

RGB camera planes use 50% opacity; the reference image card retains its original
appearance. Clicking a plane, selecting a camera, or stepping through frames
moves to the destination over 1 second with eased position, quaternion rotation
and projection interpolation. The final view still uses the exact
estimated pose and intrinsics. Repeated clicks retarget from the current pose;
reset, scrolling and keyboard navigation can interrupt the motion. Timeline
dragging stays immediate, and the system's reduced-motion preference is honored.

**Capture timeline** offers two camera modes:

- **Captured frames** retains the original nearest-frame selection and each
  frame's predicted intrinsics.
- **Smooth path** allows continuous scrubbing between captured frames and a
  **Play path · 1×** preview with pause/replay. The camera position follows the
  exact displayed curve. A monotone cubic maps video time to arc length, passing
  through each capture at its timestamp without reversing along the path.
  Orientation uses normalized cubic Hermite interpolation of sign-unwrapped
  quaternions, with time-weighted tangent derivatives, preserving roll and
  continuous angular velocity across the irregular capture intervals.

Smooth mode uses one fixed lens: the component-wise median of the normalized
predicted intrinsics, scaled back to 448 × 252. This is a robust shared estimate
under the fixed-camera-intrinsics assumption, not a physical calibration. For
this clip, fx ≈ 436.09, fy ≈ 471.74, cx ≈ 229.65 and cy ≈ 126.95 pixels.
The RGB card shows the nearest actual captured frame and is labeled as a
reference; intermediate images are not synthesized. Dragging or scrolling the
scene pauses path following and preserves the current pose/lens. **Return to
path** resumes the chosen timeline view. Clicking an RGB camera plane switches
back to captured-frame mode. Playback stops at the final timestamp and does not
jump ahead when returning from a background tab.

The outer scene window and rendered viewport retain the RGB's 16:9 aspect ratio.
Fullscreen contains that same viewport without changing the lens. Leaving an
aligned camera preserves its calibrated projection, and wheel zoom eases the
camera distance instead of switching projection modes. Frustum edges fade by
distance to each segment; nearby origins and RGB planes also fade to prevent
overlays from suddenly appearing while backing away. Fully faded images cannot
intercept clicks.

The independently switchable camera trajectory connects the capture positions
in timestamp order, with a blue-to-red gradient based on elapsed capture time.
It uses an open centripetal Catmull–Rom curve through the observed camera
positions. Color follows the same continuous time-to-arc-length mapping used by
Smooth path, even though the curve is sampled uniformly by arc length. The
original camera poses remain unchanged; intermediate viewpoints are evaluated
only for smooth navigation. Nearby parts of the curve fade smoothly by distance from
the viewer, while distant parts remain visible. The contrasting selection highlight
follows the same curve and uses the same local fade. The color timeline shows
the frame timestamps; dragging it selects the nearest captured view or a
continuous path view, according to the chosen mode. In free orbit, a contrasting
line highlights the trajectory segments adjacent to the selected frame. Camera
origins have no sphere markers.

Camera metadata uses OpenCV camera-to-world axes (+X right, +Y down, +Z forward)
after the same display-world transform as the geometry. The viewer applies its
shared scene recentering and converts camera axes to Three.js (+Y up, -Z forward).
An off-center projection preserves each frame's fx, fy and principal point. The
viewport keeps the RGB aspect ratio in overview, orbit and camera modes;
the RGB reference is not stretched. Poses and intrinsics are model estimates,
so residual reconstruction errors can still appear against the source image.

Run `node scripts/reconstruction/verify_cameras.mjs` to check all 24 camera poses,
pixel projections, RGB asset paths, picking rays, image-plane orientation,
OrbitControls compatibility and portrait/landscape viewport proportions.
Run `node scripts/reconstruction/verify_viewer.mjs` for the viewer controller
regressions: one-second transitions, wheel handoff without changing intrinsics,
smooth zoom, 16:9 resizing, retargeting, per-edge distance fading, continuous
timeline interpolation, a fixed lens, playback/pause/replay and manual handoff. This check
uses the real Three.js math/controls with a mocked DOM and renderer; it does not
perform browser visual QA.
Run `node scripts/reconstruction/verify_gallery.mjs` for actual preview GLB
parsing, camera/path parity, autoplay, pause/resume, reduced motion and renderer
lifecycle checks. This also uses a mocked DOM/renderer rather than browser visual QA.

Three.js 0.165.0 and its loader/controls are vendored with their MIT license so
the viewer does not depend on a third-party CDN. Model attribution is in the page.
The model card lists CC BY-NC 4.0 for this checkpoint.

`_config.yml` excludes `map-anything/` and `scripts/` from Jekyll output, preventing
local weights, source video and the virtual environment from entering the site.
Only exported assets are published with the page. No Git push or deployment is
performed by this pipeline.
