#!/usr/bin/env python3
"""Production lightmaps: <dir>/<id>.png → <id>.webp (lossy q92) and "file": "<id>.webp" in <id>.json, which the game
then loads instead of the PNG (main.js _loadLightmap). Run by tools/build.mjs on dist/assets/lightmaps; the repo keeps
the lossless PNGs tools/bake-ao.mjs writes.

The maps are single-channel AO, smooth inside each chart: q92 is ~5× smaller than the PNG with an error well under
one 8-bit step on average (printed below). Needs: pip install pillow
usage: python3 tools/lightmaps-webp.py dist/assets/lightmaps
"""
import glob
import json
import os
import sys

from PIL import Image, ImageChops, ImageStat

QUALITY = 92
d = sys.argv[1]
for png in sorted(glob.glob(os.path.join(d, '*.png'))):
    base = png[:-4]
    meta_path = base + '.json'
    if not os.path.exists(meta_path):
        continue
    src = Image.open(png).convert('L')
    out = base + '.webp'
    src.save(out, format='WEBP', quality=QUALITY, method=6)
    err = ImageStat.Stat(ImageChops.difference(src, Image.open(out).convert('L')))
    meta = json.load(open(meta_path))
    meta['file'] = os.path.basename(out)
    json.dump(meta, open(meta_path, 'w'), separators=(',', ':'))
    was = os.path.getsize(png)
    os.remove(png)
    print(f'  lightmap {os.path.basename(png)} {was // 1024} KB → {os.path.basename(out)} {os.path.getsize(out) // 1024} KB'
          f' (mean |Δ| {err.mean[0]:.2f}/255, max {err.extrema[0][1]})')
