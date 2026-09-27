#!/usr/bin/env python3
"""Derive the medium stage renders: assets/stages/<id>-<time>-md.webp (1280×720, WebP q80) from the full-size
<id>-<time>.webp that tools/stage-shots.mjs writes.

The stage-select hero is ~62 % of the screen wide: the 1920 render is only worth its ~300 KB on big, sharp desktop
screens. menus.js picks -md for everything smaller (phones included, whatever their DPR). Re-run after new shots.
usage: python3 tools/stage-variants.py      (needs: pip install pillow)
"""
import glob
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for src in sorted(glob.glob(os.path.join(ROOT, 'assets', 'stages', '*.webp'))):
    name = os.path.basename(src)
    if name.endswith(('-sm.webp', '-md.webp')):
        continue
    out = src[:-5] + '-md.webp'
    Image.open(src).convert('RGB').resize((1280, 720), Image.LANCZOS).save(out, format='WEBP', quality=80, method=6)
    print(f'{os.path.relpath(out, ROOT)}: {os.path.getsize(out) // 1024} KB (from {os.path.getsize(src) // 1024} KB)')
