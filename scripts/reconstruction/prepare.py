"""Select sharp video frames across the clip; keep their source timestamps."""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--count", type=int, default=24)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    frames_dir = args.output / "frames"
    frames_dir.mkdir(exist_ok=True)
    cap = cv2.VideoCapture(str(args.video))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot decode {args.video}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total / fps
    best = {}
    step = max(1, round(fps / 4))
    for index in range(total):
        ok = cap.grab()
        if not ok:
            break
        if index % step:
            continue
        ok, image = cap.retrieve()
        if not ok:
            continue
        h, w = image.shape[:2]
        image = cv2.resize(image, (1280, round(h * 1280 / w)))
        h, w = image.shape[:2]
        roi = image[int(.15*h):int(.88*h), int(.20*w):int(.82*w)]
        grey = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        score = float(cv2.Laplacian(grey, cv2.CV_64F).var())
        bucket = min(args.count - 1, int(index / total * args.count))
        if bucket not in best or score > best[bucket][0]:
            best[bucket] = (score, index, image)
    cap.release()
    manifest = []
    sheet = Image.new("RGB", (1280, 4 * 210), "#181818")
    draw = ImageDraw.Draw(sheet)
    for bucket, (score, index, image) in sorted(best.items()):
        name = f"{bucket:03d}.jpg"
        cv2.imwrite(str(frames_dir / name), image, [cv2.IMWRITE_JPEG_QUALITY, 97])
        manifest.append({"file": name, "frame": index, "time_seconds": index / fps,
                         "sharpness": score, "width": image.shape[1], "height": image.shape[0]})
        thumb = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB)).resize((320, 180))
        x, y = bucket % 4 * 320, bucket // 4 * 210
        if y + 210 > sheet.height:
            larger = Image.new("RGB", (1280, y + 210), "#181818")
            larger.paste(sheet, (0, 0))
            sheet = larger
            draw = ImageDraw.Draw(sheet)
        sheet.paste(thumb, (x, y + 25))
        draw.text((x+6, y+5), f"{bucket:02d}   {index/fps:.2f}s   sharpness {score:.0f}", fill="white")
    sheet.save(args.output / "selected-frames.jpg", quality=90)
    metadata = {"video": str(args.video.resolve()), "fps": fps, "source_frames": total,
                "duration_seconds": duration, "frames": manifest}
    (args.output / "frames.json").write_text(json.dumps(metadata, indent=2))
    print(f"Selected {len(manifest)} frames; video {duration:.2f}s at {fps:.3f} fps")


if __name__ == "__main__":
    main()
