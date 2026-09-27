#!/usr/bin/env python3
"""Build the Japanese UI font subsets: assets/fonts/MPLUSRounded1c-{500,800}-jp.woff2.

M PLUS Rounded 1c (SIL OFL 1.1) is downloaded once from Google Fonts into .cache/fonts/ (git-ignored). The subset keeps
  - every hiragana, katakana, CJK symbol/punctuation and full-width ASCII form (player names, future strings)
  - every other non-ASCII character the Japanese strings in src/i18n/ja.js use (their kanji, arrows, ×, …)
Latin text keeps rendering in Rubik / Titan One: the CSS stacks list those first, so the Japanese faces are only
downloaded when a page actually shows Japanese.

Re-run after adding kanji to ja.js:  python3 tools/subset-fonts.py
Needs: pip install fonttools brotli
"""
import os
import re
import sys
import urllib.request

from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.cache', 'fonts')
OUT = os.path.join(ROOT, 'assets', 'fonts')
WEIGHTS = [500, 800]
CSS_URL = 'https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@' + ';'.join(map(str, WEIGHTS))

RANGES = [
    (0x3000, 0x303F),  # CJK symbols & punctuation
    (0x3040, 0x309F),  # hiragana
    (0x30A0, 0x30FF),  # katakana
    (0xFF01, 0xFF5E),  # full-width ASCII forms
    (0xFF61, 0xFF9F),  # half-width katakana
]


def fetch_sources():
    os.makedirs(CACHE, exist_ok=True)
    paths = {w: os.path.join(CACHE, f'MPLUSRounded1c-{w}.ttf') for w in WEIGHTS}
    if all(os.path.exists(p) for p in paths.values()):
        return paths
    # no User-Agent → Google Fonts answers with plain TTF URLs (one per weight)
    css = urllib.request.urlopen(urllib.request.Request(CSS_URL, headers={'User-Agent': 'curl'})).read().decode()
    for w, url in re.findall(r'font-weight: (\d+);\s*src: url\((https://[^)]+\.ttf)\)', css):
        w = int(w)
        if w in paths and not os.path.exists(paths[w]):
            print('downloading', url)
            with urllib.request.urlopen(url) as r, open(paths[w], 'wb') as f:
                f.write(r.read())
    missing = [w for w, p in paths.items() if not os.path.exists(p)]
    if missing:
        sys.exit(f'could not download weights {missing} from {CSS_URL}')
    return paths


def wanted_text():
    src = open(os.path.join(ROOT, 'src', 'i18n', 'ja.js'), encoding='utf-8').read()
    chars = {c for c in src if ord(c) > 0x7E}
    for a, b in RANGES:
        chars.update(chr(c) for c in range(a, b + 1))
    return ''.join(sorted(chars))


def main():
    paths = fetch_sources()
    text = wanted_text()
    print(f'{len(text)} characters')
    for w, src in paths.items():
        out = os.path.join(OUT, f'MPLUSRounded1c-{w}-jp.woff2')
        opts = subset.Options()
        opts.flavor = 'woff2'
        opts.layout_features = ['palt', 'kern', 'liga', 'vert']
        opts.name_IDs = ['*']            # keep the copyright / licence records (OFL)
        opts.notdef_outline = True
        opts.hinting = False             # screen-only UI text: hints only cost bytes
        opts.desubroutinize = True
        font = subset.load_font(src, opts)
        sub = subset.Subsetter(opts)
        sub.populate(text=text)
        sub.subset(font)
        subset.save_font(font, out, opts)
        print(f'{os.path.relpath(out, ROOT)}: {os.path.getsize(out) / 1024:.1f} KB')


if __name__ == '__main__':
    main()
