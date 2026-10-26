"""Offline MapAnything reconstruction with bounded memory on Apple Silicon.

Loads the supplied checkpoint strictly. The bundled DINOv2 architecture is used
instead of downloading an extra encoder. Mixed mode stores encoder/attention
matrices in FP16 with FP32 geometry; --precision fp32 keeps all operations FP32.
"""
import argparse
import gc
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
from safetensors import safe_open

from mapanything.models import MapAnything
from mapanything.models.external.dinov2.hub import backbones
from mapanything.utils.image import load_images


def bounded_sdpa(original, chunk=512):
    """Exact noncausal inference attention, partitioned along query positions.

    Every query still attends to all keys; this only bounds the temporary score
    matrix, which exceeds Metal's buffer limit for a full multi-view sequence.
    """
    def attention(q, k, v, attn_mask=None, dropout_p=0.0, is_causal=False, **kwargs):
        if q.device.type != "mps" or q.shape[-2] <= 2048:
            return original(q,k,v,attn_mask,dropout_p,is_causal,**kwargs)
        if is_causal or dropout_p:
            raise ValueError("Chunked attention is only enabled for noncausal evaluation")
        output = torch.empty((*q.shape[:-1],v.shape[-1]),device=q.device,dtype=q.dtype)
        for start in range(0,q.shape[-2],chunk):
            end=min(start+chunk,q.shape[-2])
            mask=attn_mask
            if mask is not None and mask.shape[-2] != 1:
                mask=mask[...,start:end,:]
            # Explicit FP32 softmax avoids Metal SDPA instability for long keys
            # with strided query slices. Use every key for each query block.
            with torch.autocast("mps",enabled=False):
                scale=kwargs.get("scale",None) or q.shape[-1]**-.5
                scores=(q[...,start:end,:].float()*scale)@k.float().transpose(-2,-1)
                if mask is not None:
                    if mask.dtype == torch.bool:
                        scores=scores.masked_fill(~mask,float('-inf'))
                    else:
                        scores=scores+mask
                values=scores.softmax(dim=-1)@v.float()
                output[...,start:end,:]=values.to(q.dtype)
        return output
    return attention


def load_model(weights, device, precision="mixed"):
    config = json.loads((weights / "config.json").read_text())
    config["encoder_config"]["torch_hub_pretrained"] = False
    original_linspace = torch.linspace

    def local_dino(repo, name, **kwargs):
        if repo != "facebookresearch/dinov2":
            raise RuntimeError(f"Unexpected Hub dependency: {repo}")
        kwargs.pop("force_reload", None)
        kwargs["pretrained"] = False
        return getattr(backbones, name)(**kwargs)

    def cpu_linspace(*args, **kwargs):
        kwargs.setdefault("device", "cpu")
        return original_linspace(*args, **kwargs)

    # Meta initialization avoids allocating a second full set of giant weights.
    with patch("torch.hub.load", local_dino), patch("torch.linspace", cpu_linspace):
        with torch.device("meta"):
            model = MapAnything(**config)
    state = {}
    with safe_open(weights / "model.safetensors", framework="pt", device="cpu") as file:
        for key in file.keys():
            tensor = file.get_tensor(key)
            if (device == "mps" and precision == "mixed" and key.startswith(("encoder.", "info_sharing."))
                    and key.endswith("weight") and tensor.ndim >= 2):
                tensor = tensor.half()
            state[key] = tensor
    # HF Safetensors omits duplicate names for shared parameters. Restore only
    # verified aliases from the actual architecture, then retain strict loading.
    aliases = {}
    for name, parameter in model.named_parameters(remove_duplicate=False):
        aliases.setdefault(id(parameter), []).append(name)
    restored = 0
    for names in aliases.values():
        present = next((name for name in names if name in state), None)
        if present:
            for name in names:
                if name not in state:
                    state[name] = state[present]
                    restored += 1
    print(f"Restored {restored} shared-parameter aliases", flush=True)
    result = model.load_state_dict(state, strict=True, assign=True)
    for names in aliases.values():
        if len(names) > 1:
            parameter = model.get_parameter(names[0])
            for name in names[1:]:
                parent, leaf = name.rsplit('.', 1)
                setattr(model.get_submodule(parent), leaf, parameter)
    print(f"Checkpoint: {result}", flush=True)
    del state
    model = model.to(device).eval()
    if any(t.is_meta for t in list(model.parameters()) + list(model.buffers())):
        raise RuntimeError("Uninitialized model tensors remain")
    gc.collect()
    return model


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("images", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--weights", type=Path, default=Path("map-anything/weights"))
    parser.add_argument("--width", type=int, default=392)
    parser.add_argument("--height", type=int, help="Target height; defaults to the source aspect ratio, aligned to 14 pixels")
    parser.add_argument("--device", default="mps")
    parser.add_argument("--precision", choices=["mixed","fp32"], default="mixed")
    args = parser.parse_args()
    paths = sorted(args.images.glob("*.jpg"))
    if not paths:
        raise ValueError(f"No JPEG images in {args.images}")
    with Image.open(paths[0]) as source:
        source_width,source_height=source.size
    height=args.height or int(round(args.width*source_height/source_width/14))*14
    if args.width<=0 or height<=0 or args.width%14 or height%14:
        raise ValueError("Input dimensions must be positive multiples of 14")
    args.output.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(4)
    print(f"Loading model on {args.device}", flush=True)
    started = time.monotonic()
    model = load_model(args.weights, args.device, args.precision)
    if args.device == "mps":
        torch.mps.synchronize()
        print(f"Model ready: {torch.mps.current_allocated_memory()/1e9:.2f} GB allocated", flush=True)

    # Use the source aspect ratio. 448 x 252 preserves the video's full 16:9 frame.
    views = load_images([str(p) for p in paths], resize_mode="fixed_size", size=(args.width,height))
    print(f"Inference: {len(views)} views at {args.width} x {height}", flush=True)
    def report(name):
        def hook(module, inputs, outputs):
            if args.device == "mps":
                torch.mps.synchronize()
                memory = torch.mps.current_allocated_memory()/1e9
                print(f"{name}: {time.monotonic()-started:.1f}s, {memory:.2f} GB allocated",flush=True)
            if isinstance(outputs,torch.Tensor):
                if not torch.isfinite(outputs).all():
                    raise RuntimeError(f"Non-finite features at {name}")
        return hook
    model.encoder.register_forward_hook(report("Encoder complete"))
    model.info_sharing.register_forward_hook(report("Multi-view attention complete"))
    for i, block in enumerate(model.info_sharing.self_attention_blocks):
        if i % 4 == 3:
            block.register_forward_hook(report(f"Attention block {i+1}"))
    inference_start = time.monotonic()
    with patch("torch.nn.functional.scaled_dot_product_attention", bounded_sdpa(F.scaled_dot_product_attention)):
        outputs = model.infer(views, memory_efficient_inference=True, minibatch_size=1,
                              use_amp=args.precision=="mixed", amp_dtype="fp16", apply_mask=True,
                              mask_edges=True, apply_confidence_mask=True,
                              confidence_percentile=15)
    arrays = {}
    for key in ["pts3d", "depth_z", "intrinsics", "camera_poses", "mask", "conf", "img_no_norm"]:
        arrays[key] = np.stack([pred[key][0].detach().float().cpu().numpy() for pred in outputs])
    if not np.isfinite(arrays["pts3d"]).all():
        raise RuntimeError("Non-finite reconstruction points")
    valid_per_view=arrays["mask"].reshape(len(views),-1).mean(1)
    if np.min(valid_per_view)<.01 or np.ptp(arrays["pts3d"])<1e-6:
        raise RuntimeError(f"Invalid reconstruction: valid fractions {valid_per_view.tolist()}")
    np.savez_compressed(args.output / "predictions.npz", **arrays)
    meta = {"model":"facebook/map-anything", "checkpoint_sha256":"981f060c64664dff3272b5f5a823d350abe71a2f144444db4cfc325f3ed5a3a0",
            "device":args.device,"image_width":args.width,"image_height":height,
            "frames":[p.name for p in paths],"inference_seconds":time.monotonic()-inference_start,
            "source_image_dimensions":[source_width,source_height],"input_directory":args.images.name,
            "input_framing":"full_input_frame" if args.width*source_height==height*source_width else "center_crop_to_target_aspect",
            "geometry_validity_filter":{"model_mask":True,"mask_edges":True,"confidence_percentile":15},
            "torch":torch.__version__,"encoder_attention_dtype":"float32" if args.precision=="fp32" else "FP16 matrices; FP32 normalization, biases, tokens","geometry_dtype":"float32"}
    (args.output / "inference.json").write_text(json.dumps(meta,indent=2))
    print(f"Saved predictions to {args.output}; inference {meta['inference_seconds']:.1f}s",flush=True)


if __name__ == "__main__":
    main()
