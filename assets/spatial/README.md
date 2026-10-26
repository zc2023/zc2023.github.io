# Spatial Gallery assets

This directory is part of the website repository. Everything needed by a public
3D scene lives here; the site never reads the ignored `map-anything/` directory.
Keep model weights, videos and intermediate prediction arrays outside this directory.

The first scene is `img-5064/`, a full-scene reconstruction of IMG_5064.MOV:

- `scene-points.glb`: full browser point cloud, used in the interactive viewer.
- `scene-surface.glb`: alternate surface representation.
- `scene.ply`: downloadable dense point cloud.
- `preview-points.glb`: smaller spatial sample for gallery autoplay, preserving
  the entire scene rather than isolating an object.
- `metadata.json`: bounds, point size, camera intrinsics, poses, timestamps and
  paths to the RGB frames. `gallery_preview` describes the lightweight GLB.
- `rgb/`: captured RGB frames referenced by `metadata.views`.
- `source.jpg`: static fallback while the preview loads or motion is disabled.
- `preview.jpg`: scene overview thumbnail used in Personal Posts.

## Add a scene

1. Create `assets/spatial/<scene-id>/` with the same export format. Poses and
   geometry must use the same display-world coordinates. Include at least two
   views with distinct timestamps. RGB image paths are relative to this folder.
2. Generate the small gallery GLB using Python with NumPy and trimesh installed:
   `python scripts/reconstruction/prepare_gallery.py assets/spatial/<scene-id>`.
3. Copy `_spatial/img-5064.html` to `_spatial/<scene-id>.html` and update its ID,
   title, description, category, order, asset paths, frame count and capture note.
   For this export format, keep `model_prefix: scene` and
   `preview_model: preview-points.glb`.
4. Build Jekyll. The collection generates `/spatial-gallery/<scene-id>/` and
   adds the scene's card to `/spatial-gallery/` automatically.

Gallery cards and the full viewer share `reconstruction-trajectory.js` and
`reconstruction-timeline.js`: the same open camera spline, fitted orientation,
timestamps and fixed estimated intrinsics. Cards loop at 1× with a brief fade
at the loop boundary. Offscreen/hidden cards release their WebGL context;
reduced-motion users see the static image until they choose Play previews.

The original `/reconstruction/` address still opens the `img-5064` scene.
See `scripts/reconstruction/README.md` for export commands and validation.
