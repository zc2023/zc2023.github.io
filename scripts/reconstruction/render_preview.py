"""Render a thumbnail directly from the exported, observed colored point cloud."""
import argparse
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import trimesh

parser=argparse.ArgumentParser()
parser.add_argument("ply")
parser.add_argument("output")
args=parser.parse_args()
cloud=trimesh.load(args.ply)
stride=max(1,len(cloud.vertices)//120000)
points=cloud.vertices[::stride]
colors=cloud.colors[::stride,:3]/255
fig=plt.figure(figsize=(6.4,4.8),facecolor="#171918")
ax=fig.add_axes([0,0,1,1],projection="3d")
ax.set_facecolor("#171918")
ax.scatter(points[:,0],points[:,2],points[:,1],c=colors,s=.65,depthshade=False)
ax.set_box_aspect(np.ptp(points,axis=0)[[0,2,1]],zoom=1.25)
ax.view_init(20,135)
ax.set_axis_off()
fig.savefig(args.output,dpi=160,facecolor=fig.get_facecolor())
