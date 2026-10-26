"""Create a small full-scene point GLB for Spatial Gallery autoplay cards.

Reads only published scene assets. Does not require model weights, source video,
prediction tensors or foreground masks.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import trimesh


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('scene', type=Path)
    parser.add_argument('--max-points', type=int, default=180000)
    args = parser.parse_args()
    if args.max_points < 1:
        parser.error('--max-points must be positive')
    metadata_path = args.scene / 'metadata.json'
    metadata = json.loads(metadata_path.read_text())
    loaded = trimesh.load(args.scene / 'scene-points.glb', process=False)
    cloud = next(iter(loaded.geometry.values()))
    vertices = np.asarray(cloud.vertices)
    colors = np.asarray(cloud.colors)
    voxel = metadata['voxel_size']
    keep = np.arange(len(vertices))
    while len(keep) > args.max_points:
        voxel *= 1.25
        cells = np.floor(vertices / voxel).astype(np.int64)
        _, keep = np.unique(cells, axis=0, return_index=True)
    preview = trimesh.points.PointCloud(vertices[keep], colors[keep])
    path = args.scene / 'preview-points.glb'
    trimesh.Scene(preview).export(path)
    metadata['gallery_preview'] = {
        'file': path.name,
        'point_count': len(keep),
        'point_size': metadata['viewer_point_size'] * (len(vertices) / len(keep)) ** .5,
        'processing': 'Spatial voxel representatives from the complete published scene; no object segmentation or bounding-box crop.',
    }
    metadata['files'][path.name] = path.stat().st_size
    metadata_path.write_text(json.dumps(metadata, indent=2, allow_nan=False))
    print(json.dumps(metadata['gallery_preview'], indent=2))
    print(f'{path}: {path.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
