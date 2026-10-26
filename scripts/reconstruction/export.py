"""Export observed car geometry as a colored PLY, point GLB and surface GLB."""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree
import trimesh

from mapanything.utils.cropping import crop_resize_if_necessary


def multiview_support(pred, valid):
    """Count other foreground depth maps agreeing within 2% camera depth."""
    n,h,w=valid.shape
    support=np.zeros(valid.shape,np.uint8)
    for i in range(n):
        pts=pred['pts3d'][i][valid[i]]
        counts=np.zeros(len(pts),np.uint8)
        for j in range(n):
            if i==j:
                continue
            pose=pred['camera_poses'][j]
            cam=(pts-pose[:3,3])@pose[:3,:3]
            uv=cam@pred['intrinsics'][j].T
            z=cam[:,2]
            uv=uv[:,:2]/np.maximum(uv[:,2:],1e-8)
            u,v=np.rint(uv).astype(int).T
            inside=(z>0)&(u>=0)&(u<w)&(v>=0)&(v<h)
            indexes=np.where(inside)[0]
            u,v=u[inside],v[inside]
            observed=pred['depth_z'][j,v,u,0]
            agree=valid[j,v,u] & (np.abs(z[inside]-observed)<.02*np.maximum(z[inside],observed))
            counts[indexes]+=agree.astype(np.uint8)
        support[i][valid[i]]=counts
    return support


def fit_table(points, car, rng):
    points = points[rng.choice(len(points), min(15000, len(points)), replace=False)]
    extent = np.linalg.norm(np.quantile(car,.98,axis=0)-np.quantile(car,.02,axis=0))
    threshold = extent * .008
    best = None
    for _ in range(250):
        a,b,c = points[rng.choice(len(points),3,replace=False)]
        normal = np.cross(b-a,c-a)
        norm = np.linalg.norm(normal)
        if norm < 1e-8:
            continue
        normal /= norm
        offset = -normal @ a
        inliers = np.abs(points @ normal + offset) < threshold
        if best is None or inliers.sum() > best[0]:
            best = (int(inliers.sum()),inliers)
    inlier_points = points[best[1]]
    center = inlier_points.mean(0)
    _,_,vectors = np.linalg.svd(inlier_points-center,full_matrices=False)
    normal = vectors[-1]
    offset = -normal @ center
    if np.median(car @ normal + offset) < 0:
        normal,offset = -normal,-offset
    return normal,offset,best[0]/len(points)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("run",type=Path)
    parser.add_argument("result",type=Path)
    parser.add_argument("output",type=Path)
    parser.add_argument("--mesh-stride",type=int,default=2)
    parser.add_argument("--min-support",type=int,default=2)
    args = parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    rng = np.random.default_rng(5064)
    meta = json.loads((args.result/"inference.json").read_text())
    pred = np.load(args.result/"predictions.npz")
    points = pred['pts3d'].copy()
    colors = np.clip(pred['img_no_norm']*255,0,255).astype(np.uint8)
    n,h,w = points.shape[:3]
    valid = pred['mask'][...,0].astype(bool) & np.isfinite(points).all(-1)
    masks = []
    for name in meta['frames']:
        path = args.run / 'masks' / Path(name).with_suffix('.png')
        mask = crop_resize_if_necessary(Image.open(path).convert('RGB'),(w,h))[0]
        mask = np.asarray(mask)[...,0] > 180
        masks.append(cv2.erode(mask.astype(np.uint8),np.ones((3,3),np.uint8)).astype(bool))
    foreground = np.stack(masks)
    car_valid = valid & foreground
    car_raw = points[car_valid]
    if len(car_raw)<1000:
        raise RuntimeError("Too few foreground points for a usable reconstruction")
    support=multiview_support(pred,car_valid)
    supported=car_valid & (support>=args.min_support)
    support_retention=float(supported.sum()/car_valid.sum())
    if support_retention<.1:
        raise RuntimeError("Multi-view agreement is too low; inspect poses and depth before exporting")
    # Estimate orientation from the visible wooden table, preserving model scale.
    rgb = colors.astype(float)
    table_colors = (rgb[...,0]>rgb[...,1]*1.05) & (rgb[...,1]>rgb[...,2]*1.2)
    table_valid = valid & ~foreground & table_colors
    normal,offset,table_inliers = fit_table(points[table_valid],car_raw,rng)
    car_valid=supported
    transform = trimesh.geometry.align_vectors(normal,np.array([0.,1.,0.]))
    points = trimesh.transform_points(points.reshape(-1,3),transform).reshape(n,h,w,3)
    points[...,1] += offset
    transform[1,3] += offset
    raw = points[car_valid]
    # Horizontal principal axis; this is a rotation, not a change in proportions.
    _,vectors = np.linalg.eigh(np.cov(raw[:,[0,2]].T))
    axis = vectors[:,-1]
    rotation = np.array([[axis[0],0,axis[1]],[0,1,0],[-axis[1],0,axis[0]]])
    points = points @ rotation.T
    turn = np.eye(4);turn[:3,:3] = rotation;transform=turn@transform
    raw = points[car_valid]
    center = np.median(raw,axis=0);center[1]=0
    points-=center
    transform[:3,3]-=center
    raw=points[car_valid]
    low,high=np.quantile(raw,[.002,.998],axis=0)
    span=high-low
    # Remove sparse extreme predictions and points below the support plane.
    in_bounds=((points >= low-span*.08)&(points <= high+span*.08)).all(-1)
    car_valid &= in_bounds & (points[...,1]>-span[1]*.025)
    flat=points[car_valid]
    tree=cKDTree(flat)
    dist,_=tree.query(flat,k=9,workers=4)
    density=dist[:,1:].mean(1)
    keep=density < max(np.quantile(density,.985),np.median(density)*4)
    indexes=np.flatnonzero(car_valid)
    car_valid.flat[indexes[~keep]]=False
    flat=points[car_valid]
    flat_colors=colors[car_valid]
    # Voxel merging keeps a representative observed sample per small cell.
    voxel=float(np.max(np.ptp(flat,axis=0))/420)
    cells=np.floor(flat/voxel).astype(np.int32)
    _,unique=np.unique(cells,axis=0,return_index=True)
    flat,flat_colors=flat[unique],flat_colors[unique]
    cloud=trimesh.points.PointCloud(flat,flat_colors)
    cloud.export(args.output/'car.ply')
    def linear_colors(srgb):
        x=srgb.astype(float)/255
        linear=np.where(x<=.04045,x/12.92,((x+.055)/1.055)**2.4)
        return np.round(linear*255).astype(np.uint8)
    # glTF vertex colors are linear; PLY conventionally retains source sRGB.
    trimesh.Scene(trimesh.points.PointCloud(flat,linear_colors(flat_colors))).export(args.output/'car-points.glb')
    # Local image triangles retain observed surfaces; do not invent unseen faces.
    mesh_vertices=[];mesh_colors=[];mesh_faces=[];base=0
    for v in range(n):
        stride=args.mesh_stride
        p=points[v,::stride,::stride];m=car_valid[v,::stride,::stride]
        mh,mw=p.shape[:2]
        idx=np.arange(mh*mw).reshape(mh,mw)
        triangles=np.concatenate([
            np.stack([idx[:-1,:-1],idx[1:,:-1],idx[:-1,1:]],axis=-1).reshape(-1,3),
            np.stack([idx[:-1,1:],idx[1:,:-1],idx[1:,1:]],axis=-1).reshape(-1,3)])
        triangles=triangles[m.ravel()[triangles].all(1)]
        pflat=p.reshape(-1,3)
        edge_lengths=np.stack([np.linalg.norm(pflat[triangles[:,a]]-pflat[triangles[:,b]],axis=1) for a,b in [(0,1),(0,2),(1,2)]],1)
        triangles=triangles[edge_lengths.max(1)<voxel*8]
        used,remapped=np.unique(triangles,return_inverse=True)
        mesh_vertices.append(pflat[used]);mesh_colors.append(linear_colors(colors[v,::stride,::stride].reshape(-1,3)[used]))
        mesh_faces.append(remapped.reshape(-1,3)+base);base+=len(used)
    mesh=trimesh.Trimesh(vertices=np.concatenate(mesh_vertices),faces=np.concatenate(mesh_faces),vertex_colors=np.concatenate(mesh_colors),process=False)
    trimesh.Scene(mesh).export(args.output/'car-surface.glb')
    cameras=pred['camera_poses'].copy()
    cameras=transform[None]@cameras
    summary={**meta,"source_video":"IMG_5064.MOV","point_count":len(flat),"triangle_count":len(mesh.faces),
             "bounds":cloud.bounds.tolist(),"table_plane_inlier_fraction":table_inliers,
             "world_to_display":transform.tolist(),"camera_poses":cameras.tolist(),
             "scale_note":"Model-estimated scale; no measured reference was supplied.",
             "geometry_note":"Observed colored points and per-view surface triangles. Unseen underside is not reconstructed.",
             "mask_method":"macOS Vision foreground instance segmentation; 1px erosion at inference resolution",
             "mesh_stride":args.mesh_stride,
             "minimum_additional_views":args.min_support,"depth_agreement_relative_tolerance":.02,
             "multiview_support_retention":support_retention,
             "files":{p.name:p.stat().st_size for p in args.output.glob('*') if p.suffix in ['.glb','.ply']}}
    (args.output/'metadata.json').write_text(json.dumps(summary,indent=2))
    print(json.dumps({k:summary[k] for k in ['point_count','triangle_count','bounds','table_plane_inlier_fraction','files']},indent=2))


if __name__ == '__main__':
    main()
