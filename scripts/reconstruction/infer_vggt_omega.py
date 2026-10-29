"""Reconstruct the existing video frames with the local VGGT-Omega checkpoint.

Writes the same NPZ/camera contract as infer.py so the existing scene exporters
and website can display a separate VGGT-Omega result. Apple Silicon uses FP32,
per-image encoder batches and exact query-chunked attention to bound memory.
"""
import argparse
import gc
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import time
from unittest.mock import patch

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import numpy as np
from PIL import Image
import torch
import torch.nn.functional as F

from mapanything.utils.geometry import depth_edge, normals_edge, points_to_normals
from vggt_omega.models import VGGTOmega
from vggt_omega.utils.geometry import closed_form_inverse_se3
from vggt_omega.utils.load_fn import load_and_preprocess_images
from vggt_omega.utils.pose_enc import encoding_to_camera


def contiguous_mps_attention(original):
    def attention(q, k, v, attn_mask=None, dropout_p=0.0, is_causal=False, **kwargs):
        if q.device.type != "mps" or q.shape[-2] <= 2048:
            return original(q, k, v, attn_mask, dropout_p, is_causal, **kwargs)
        if is_causal or dropout_p or kwargs.get("enable_gqa", False):
            raise ValueError("This path supports noncausal inference attention without GQA")
        parts = []
        with torch.autocast("mps", enabled=False):
            keys, values = k.float().contiguous(), v.float().contiguous()
            scale = kwargs.get("scale") or q.shape[-1] ** -0.5
            for start in range(0, q.shape[-2], 256):
                end = min(start + 256, q.shape[-2])
                query = q[..., start:end, :].float().contiguous()
                scores = (query * scale) @ keys.transpose(-2, -1)
                mask = attn_mask
                if mask is not None:
                    if mask.shape[-2] != 1:
                        mask = mask[..., start:end, :]
                    scores = scores.masked_fill(~mask, float("-inf")) if mask.dtype == torch.bool else scores + mask
                parts.append((scores.softmax(-1) @ values).to(q.dtype))
                # Complete each large temporary before queuing the next one
                # so the allocator can reuse buffers on 16 GB unified memory.
                torch.mps.synchronize()
                del query, scores
        return torch.cat(parts, dim=-2)

    return attention


def load_model(checkpoint, device):
    # mmap + assign avoids a second resident copy of the 4.6 GB checkpoint.
    model = VGGTOmega(autocast=False).eval()
    state = torch.load(checkpoint, map_location="cpu", weights_only=True, mmap=True)
    state = state.get("model", state.get("state_dict", state))
    print(f"Checkpoint: {model.load_state_dict(state, strict=True, assign=True)}", flush=True)
    del state
    gc.collect()
    return model.to(device)


def convert_predictions(depth, confidence, extrinsics, intrinsics, rgb, percentile):
    poses = closed_form_inverse_se3(extrinsics).numpy()
    depth = depth.numpy()
    confidence = confidence.numpy()
    intrinsics = intrinsics.numpy()
    count, height, width, _ = depth.shape
    yy, xx = np.mgrid[:height, :width].astype(np.float32)
    pixels = np.stack([xx, yy, np.ones_like(xx)], axis=-1)
    points = np.empty((count, height, width, 3), dtype=np.float32)
    masks = np.empty((count, height, width, 1), dtype=bool)
    for i in range(count):
        camera_points = (pixels @ np.linalg.inv(intrinsics[i]).T) * depth[i]
        points[i] = camera_points @ poses[i, :3, :3].T + poses[i, :3, 3]
        valid = (depth[i, ..., 0] > 0) & np.isfinite(points[i]).all(-1)
        threshold = np.percentile(confidence[i][valid], percentile)
        valid &= confidence[i] > threshold
        normals, normal_valid = points_to_normals(points[i], mask=valid)
        edges = normals_edge(normals, tol=5.0, mask=normal_valid)
        edges &= depth_edge(depth[i, ..., 0], rtol=0.03, mask=valid)
        masks[i, ..., 0] = valid & ~edges
    return dict(pts3d=points, depth_z=depth, conf=confidence,
                intrinsics=intrinsics, camera_poses=poses, mask=masks,
                img_no_norm=rgb.permute(0, 2, 3, 1).numpy())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--checkpoint", type=Path, default=Path("weights/vggt_omega_1b_512.pt"))
    parser.add_argument("--resolution", type=int, default=512)
    parser.add_argument("--resize-mode", choices=["balanced", "max_size"], default="max_size")
    parser.add_argument("--device", choices=["mps", "cpu", "cuda"], default="mps")
    parser.add_argument("--max-frames", type=int, help="Evenly spaced subset for a pilot run")
    parser.add_argument("--confidence-percentile", type=float, default=15)
    args = parser.parse_args()
    if not 0 <= args.confidence_percentile < 100:
        parser.error("--confidence-percentile must be in [0, 100)")
    paths = sorted(args.images.glob("*.jpg"))
    if args.max_frames:
        indices = np.linspace(0, len(paths) - 1, min(args.max_frames, len(paths)), dtype=int)
        paths = [paths[i] for i in indices]
    if not paths:
        parser.error("No JPEG input frames")
    if args.device == "mps" and not torch.backends.mps.is_available():
        parser.error("MPS unavailable; use --device cpu")
    with Image.open(paths[0]) as image:
        source_size = list(image.size)
    if not 0.5 <= source_size[0] / source_size[1] <= 2:
        parser.error("Full-scene export requires source aspect ratio between 1:2 and 2:1")
    args.output.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(4)
    started = time.monotonic()
    print(f"Loading VGGT-Omega on {args.device} in FP32", flush=True)
    model = load_model(args.checkpoint, args.device)
    rgb = load_and_preprocess_images([str(p) for p in paths],
                                    mode=args.resize_mode, image_resolution=args.resolution)
    height, width = rgb.shape[-2:]
    images = rgb.unsqueeze(0).to(args.device)
    print(f"Inference: {len(paths)} frames, {width} x {height}, {args.resize_mode} {args.resolution}", flush=True)
    memory_samples = []

    def report(label):
        if args.device == "mps":
            torch.mps.synchronize()
            memory = torch.mps.current_allocated_memory() / 1e9
            memory_samples.append(memory)
            print(f"{label}: {time.monotonic()-started:.1f}s, {memory:.2f} GB allocated", flush=True)
            torch.mps.empty_cache()
        else:
            print(f"{label}: {time.monotonic()-started:.1f}s", flush=True)

    # Image encoding has no cross-frame attention. Only keep patch tokens, then
    # perform the original joint 24-view aggregator without splitting the scene.
    encoder = model.aggregator.patch_embed
    original_encoder = encoder.forward

    def encode_frames(batch):
        tokens = []
        for i in range(len(batch)):
            result = original_encoder(batch[i:i+1])
            tokens.append(result["x_norm_patchtokens"])
            if i % 4 == 3 or i == len(batch) - 1:
                report(f"Image encoder {i+1}/{len(batch)}")
        return {"x_norm_patchtokens": torch.cat(tokens)}

    handles = []
    for i, block in enumerate(model.aggregator.inter_frame_blocks):
        if i % 4 == 3:
            def hook(module, inputs, output, index=i):
                if not torch.isfinite(output).all():
                    raise RuntimeError(f"Nonfinite features at attention block {index+1}")
                report(f"Joint attention {index+1}/24")
            handles.append(block.register_forward_hook(hook))

    inference_start = time.monotonic()
    with torch.inference_mode(), patch.object(encoder, "forward", encode_frames), \
            patch("torch.nn.functional.scaled_dot_product_attention", contiguous_mps_attention(F.scaled_dot_product_attention)):
        features, prefix = model.aggregator(images)
        pose = model.camera_head(features, patch_token_start=prefix)
        report("Camera head complete")
        depth, confidence = model.dense_head(features, images=images, patch_token_start=prefix,
                                              frames_chunk_size=1)
        extrinsics, intrinsics = encoding_to_camera(pose, (height, width))
        for name, tensor in [("depth", depth), ("confidence", confidence),
                             ("extrinsics", extrinsics), ("intrinsics", intrinsics)]:
            if not torch.isfinite(tensor).all():
                raise RuntimeError(f"Nonfinite {name} predictions")
        depth, confidence = depth[0].cpu(), confidence[0].cpu()
        extrinsics, intrinsics = extrinsics[0].cpu(), intrinsics[0].cpu()
        report("Depth head complete")
    inference_seconds = time.monotonic() - inference_start
    for handle in handles:
        handle.remove()
    del features, pose, images, encoder, original_encoder, model
    gc.collect()
    if args.device == "mps":
        torch.mps.empty_cache()
    arrays = convert_predictions(depth, confidence, extrinsics, intrinsics, rgb, args.confidence_percentile)
    if not np.isfinite(arrays["pts3d"]).all():
        raise RuntimeError("Nonfinite point cloud")
    valid_fractions = arrays["mask"].reshape(len(paths), -1).mean(1)
    if valid_fractions.min() < 0.01:
        raise RuntimeError(f"Too little valid geometry: {valid_fractions}")
    np.savez_compressed(args.output / "predictions.npz", **arrays)
    with args.checkpoint.open("rb") as checkpoint:
        digest = hashlib.file_digest(checkpoint, "sha256").hexdigest()
    metadata = {
        "model": "facebook/VGGT-Omega", "checkpoint": args.checkpoint.name,
        "checkpoint_sha256": digest, "checkpoint_strict_load": True,
        "package_version": importlib.metadata.version("vggt-omega"),
        "source_commit": "48b23c8ce72c9a8fcf987f0d7f43d8e4870759f6",
        "device": args.device, "torch": torch.__version__, "numpy": np.__version__,
        "image_resolution": args.resolution, "resize_mode": args.resize_mode,
        "image_width": width, "image_height": height,
        "source_image_dimensions": source_size, "input_directory": args.images.name,
        "input_framing": "full_input_frame", "frames": [p.name for p in paths],
        "inference_seconds": inference_seconds,
        "encoder_attention_dtype": "float32", "geometry_dtype": "float32",
        "encoder_batch_size": 1, "dense_head_batch_size": 1, "attention_query_chunk": 256,
        "attention_memory_layout": "contiguous K/V and per-query chunks",
        "attention_chunk_synchronization": True,
        "joint_inference_frame_count": len(paths),
        "largest_logged_mps_allocation_gb": max(memory_samples, default=None),
        "geometry_validity_filter": {"finite_positive_depth": True, "model_mask": False,
                                     "confidence_percentile": args.confidence_percentile,
                                     "depth_and_normal_edges": True},
        "valid_fraction_per_view": valid_fractions.tolist(),
        "scale_note": "Relative reconstruction scale; not calibrated to physical units.",
    }
    (args.output / "inference.json").write_text(json.dumps(metadata, indent=2, allow_nan=False))
    print(f"Saved {len(paths)} frames to {args.output}; inference {inference_seconds:.1f}s", flush=True)


if __name__ == "__main__":
    main()
