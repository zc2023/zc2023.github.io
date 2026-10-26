"""Crop reviewed car regions and create foreground masks for geometry export."""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("run", type=Path)
    parser.add_argument("annotations", type=Path)
    args = parser.parse_args()
    annotations = json.loads(args.annotations.read_text())
    for folder in ["crops", "masks", "pilot"]:
        (args.run / folder).mkdir(exist_ok=True)
    sheet = Image.new("RGB", (1280, 4*270), "#181818")
    draw = ImageDraw.Draw(sheet)
    records = []
    for n, (name, bounds) in enumerate(annotations["bounds"].items()):
        image = cv2.imread(str(args.run / "frames" / (name + ".jpg")))
        h, w = image.shape[:2]
        x1, y1, x2, y2 = [int(v * w / 320) for v in bounds]
        labels = np.zeros((h, w), np.uint8)
        cv2.grabCut(image, labels, (x1,y1,x2-x1,y2-y1), np.zeros((1,65)), np.zeros((1,65)), 5, cv2.GC_INIT_WITH_RECT)
        mask = np.isin(labels, [cv2.GC_FGD,cv2.GC_PR_FGD]).astype(np.uint8)
        count, components, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
        if count < 2:
            raise RuntimeError(f"No car mask for {name}")
        mask = (components == 1+np.argmax(stats[1:,cv2.CC_STAT_AREA])).astype(np.uint8) * 255
        # Fixed 4:3 crop aspect means masks follow the model's resize exactly.
        cw = max((x2-x1)*1.35, (y2-y1)*1.35*4/3)
        cw = min(cw, w, h*4/3)
        ch = cw*3/4
        left = int(np.clip((x1+x2-cw)/2, 0, w-cw))
        top = int(np.clip((y1+y2-ch)/2, 0, h-ch))
        right, bottom = left+int(cw), top+int(ch)
        crop = image[top:bottom,left:right]
        crop = cv2.resize(crop,(896,672),interpolation=cv2.INTER_AREA)
        cmask = cv2.resize(mask[top:bottom,left:right],(896,672),interpolation=cv2.INTER_NEAREST)
        cv2.imwrite(str(args.run / "crops" / (name+'.jpg')), crop, [cv2.IMWRITE_JPEG_QUALITY,97])
        cv2.imwrite(str(args.run / "masks" / (name+'.png')), cmask)
        if name in annotations["pilot"]:
            cv2.imwrite(str(args.run / "pilot" / (name+'.jpg')),crop,[cv2.IMWRITE_JPEG_QUALITY,97])
        preview = crop.copy()
        preview[cmask == 0] = (preview[cmask == 0]*.20).astype(np.uint8)
        thumb = Image.fromarray(cv2.cvtColor(preview,cv2.COLOR_BGR2RGB)).resize((320,240))
        x,y = n%4*320,n//4*270
        sheet.paste(thumb,(x,y+25)); draw.text((x+8,y+7), name,fill="white")
        records.append({"file":name+'.jpg',"crop_xyxy":[left,top,right,bottom],"foreground_pixels":int((cmask>0).sum())})
    sheet.save(args.run / "foreground-review.jpg",quality=90)
    (args.run / "crops.json").write_text(json.dumps(records,indent=2))
    print(f"Prepared {len(records)} car crops and masks")


if __name__ == '__main__':
    main()
