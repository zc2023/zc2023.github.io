"""Attach calibrated cameras and the actual inference RGB frames to a scene export."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


def export_cameras(result, output, metadata, frames_manifest=None):
    manifest = frames_manifest or result.parent / 'frames.json'
    source_frames = {
        frame['file']: frame
        for frame in json.loads(manifest.read_text())['frames']
    }
    rgb_dir = output / 'rgb'
    rgb_dir.mkdir(parents=True, exist_ok=True)
    with np.load(result / 'predictions.npz') as pred:
        images = pred['img_no_norm']
        intrinsics = pred['intrinsics']
        poses = np.asarray(metadata['world_to_display'])[None] @ pred['camera_poses']
        masks = pred['mask'][..., 0] > 0
        depths = pred['depth_z'][..., 0]
        if len(images) != len(metadata['frames']):
            raise ValueError('Camera and RGB frame counts differ')
        if not np.isfinite(poses).all() or not np.isfinite(intrinsics).all():
            raise ValueError('Nonfinite camera calibration')
        views = []
        for index, filename in enumerate(metadata['frames']):
            source = source_frames[filename]
            height, width = images[index].shape[:2]
            if (width, height) != (metadata['image_width'], metadata['image_height']):
                raise ValueError('RGB dimensions differ from camera calibration')
            rgb = np.round(np.clip(images[index], 0, 1) * 255).astype(np.uint8)
            image_path = f'rgb/{index:03d}.jpg'
            Image.fromarray(rgb).save(output / image_path, quality=95, subsampling=0)
            valid_depth = depths[index][masks[index] & np.isfinite(depths[index]) & (depths[index] > 0)]
            views.append({
                'frame': filename,
                'image': image_path,
                'width': width,
                'height': height,
                'time_seconds': source['time_seconds'],
                'source_frame': source['frame'],
                'intrinsics': intrinsics[index].tolist(),
                'camera_to_world': poses[index].tolist(),
                'focus_distance': float(np.median(valid_depth)),
            })
    metadata['views'] = views
    metadata['camera_convention'] = 'OpenCV camera-to-world in display coordinates: +X right, +Y down, +Z forward'
    metadata['rgb_note'] = 'Uncropped RGB frames used for inference, JPEG encoded at the calibrated input resolution.'
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('result', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--frames-manifest', type=Path)
    args = parser.parse_args()
    path = args.output / 'metadata.json'
    metadata = export_cameras(args.result, args.output, json.loads(path.read_text()), args.frames_manifest)
    path.write_text(json.dumps(metadata, indent=2, allow_nan=False))
    print(f"Exported {len(metadata['views'])} calibrated cameras and RGB frames to {args.output}")


if __name__ == '__main__':
    main()
