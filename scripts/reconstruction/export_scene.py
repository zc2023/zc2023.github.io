"""Export the entire reconstructed field of view, without object segmentation.

PLY contains every finite point accepted by the reconstruction's geometry-validity
mask. GLB points are spatially downsampled for the browser. No foreground masks,
object bounds, table-plane clipping or multi-view support threshold are used.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import trimesh
from export_cameras import export_cameras


def linear_colors(srgb):
    values=srgb.astype(np.float32)/255
    linear=np.where(values<=.04045,values/12.92,((values+.055)/1.055)**2.4)
    return np.round(linear*255).astype(np.uint8)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("result",type=Path)
    parser.add_argument("output",type=Path)
    parser.add_argument("--mesh-stride",type=int,default=2)
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    meta=json.loads((args.result/'inference.json').read_text())
    if meta.get('input_framing')!='full_input_frame' or meta.get('input_directory')!='frames':
        raise ValueError("Full-scene export requires uncropped video frames")
    pred=np.load(args.result/'predictions.npz')
    valid=(pred['mask'][...,0]>0) & np.isfinite(pred['pts3d']).all(-1) & (pred['depth_z'][...,0]>0)
    if not np.all(valid.reshape(len(valid),-1).sum(1)>100):
        raise ValueError("At least one view has no usable geometry")
    rgb=np.clip(pred['img_no_norm']*255,0,255).astype(np.uint8)
    poses=pred['camera_poses'].astype(np.float64)
    # Camera up directions provide a display orientation, without selecting any
    # scene object or cutting away points below a fitted table plane.
    up=np.mean(-poses[:,:3,1],axis=0)
    up/=np.linalg.norm(up)
    transform=trimesh.geometry.align_vectors(up,np.array([0.,1.,0.]))
    points=pred['pts3d'].astype(np.float64)@transform[:3,:3].T
    center=np.median(points[valid],axis=0)
    points-=center
    transform[:3,3]=-center
    points=points.astype(np.float32)
    cameras=transform[None]@poses
    dense=points[valid]
    dense_rgb=rgb[valid]
    trimesh.points.PointCloud(dense,dense_rgb).export(args.output/'scene.ply')

    # Quantiles set voxel scale only; no quantile bounds are used to discard
    # points. Every occupied spatial cell, including background cells, survives.
    lo,hi=np.quantile(dense,[.01,.99],axis=0)
    voxel=float(np.max(hi-lo)/1100)
    if not np.isfinite(voxel) or voxel<=0:
        raise ValueError("Degenerate scene extent")
    cells=np.floor(dense/voxel).astype(np.int64)
    _,keep=np.unique(cells,axis=0,return_index=True)
    web_points,web_rgb=dense[keep],dense_rgb[keep]
    cloud=trimesh.points.PointCloud(web_points,linear_colors(web_rgb))
    trimesh.Scene(cloud).export(args.output/'scene-points.glb')

    vertices=[];colors=[];faces=[];base=0
    for view in range(len(points)):
        stride=args.mesh_stride
        p=points[view,::stride,::stride]
        m=valid[view,::stride,::stride]
        depth=pred['depth_z'][view,::stride,::stride,0].reshape(-1)
        h,w=p.shape[:2]
        ids=np.arange(h*w).reshape(h,w)
        tri=np.concatenate([
            np.stack([ids[:-1,:-1],ids[1:,:-1],ids[:-1,1:]],axis=-1).reshape(-1,3),
            np.stack([ids[:-1,1:],ids[1:,:-1],ids[1:,1:]],axis=-1).reshape(-1,3)])
        tri=tri[m.reshape(-1)[tri].all(1)]
        flat=p.reshape(-1,3)
        edges=np.stack([np.linalg.norm(flat[tri[:,a]]-flat[tri[:,b]],axis=1) for a,b in [(0,1),(0,2),(1,2)]],axis=1)
        local_depth=depth[tri].min(1)
        tri=tri[(edges.max(1)<.06*local_depth)&(np.ptp(depth[tri],axis=1)<.05*local_depth)]
        used,mapped=np.unique(tri,return_inverse=True)
        vertices.append(flat[used]);colors.append(linear_colors(rgb[view,::stride,::stride].reshape(-1,3)[used]))
        faces.append(mapped.reshape(-1,3)+base);base+=len(used)
    mesh=trimesh.Trimesh(vertices=np.concatenate(vertices),faces=np.concatenate(faces),vertex_colors=np.concatenate(colors),process=False)
    trimesh.Scene(mesh).export(args.output/'scene-surface.glb')
    summary={**meta,"source_video":"IMG_5064.MOV","representation":"full_scene",
             "semantic_segmentation":False,"object_cropping":False,
             "dense_point_count":len(dense),"point_count":len(web_points),"triangle_count":len(mesh.faces),
             "valid_fraction_per_view":valid.reshape(len(valid),-1).mean(1).tolist(),
             "bounds":cloud.bounds.tolist(),"world_to_display":transform.tolist(),"camera_poses":cameras.tolist(),
             "voxel_size":voxel,"viewer_point_size":voxel*1.5,"mesh_stride":args.mesh_stride,
             "processing":"Model geometry validity and finite positive depth only for PLY; spatial voxel sampling for GLB points. All scene objects retained.",
             "geometry_note":"Observed car, table and room geometry. Unseen regions remain incomplete; surfaces are per-view triangles.",
             "scale_note":meta.get("scale_note", "Model-estimated scale; no measured reference was supplied."),
             "files":{p.name:p.stat().st_size for p in args.output.iterdir() if p.suffix in ['.glb','.ply']}}
    export_cameras(args.result, args.output, summary)
    (args.output/'metadata.json').write_text(json.dumps(summary,indent=2,allow_nan=False))
    print(json.dumps({key:summary[key] for key in ['dense_point_count','point_count','triangle_count','bounds','files']},indent=2))


if __name__=='__main__':
    main()
