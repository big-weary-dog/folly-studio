#!/usr/bin/env python3
"""Build studio/public/data/palettes.json, the looks' palettes, from td/palettes/*.csv.

    python3 studio/tools/build_palettes.py [--check]   # write it, or exit 1 if the committed file is stale

A palette file has a row per colour: `slot,colour`, the slot a role plus a number (low1, body2, accent1,
high1). The role is what the colour is for (td/README.md "Colours"); the order within a role is kept.
Format: studio/SPEC.md "Looks".
"""
import argparse
import csv
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STUDIO = os.path.dirname(HERE)
REPO = os.path.dirname(STUDIO)
PALETTES = os.path.join(REPO, 'td', 'palettes')
OUT = os.path.join(STUDIO, 'public', 'data', 'palettes.json')
ROLES = ['low', 'body', 'accent', 'high']
SLOT = re.compile(r'^(low|body|accent|high)(\d+)$')
HEX = re.compile(r'^#[0-9a-f]{6}$')


def read_palette(path):
    roles = {r: [] for r in ROLES}
    with open(path, encoding='utf-8', newline='') as f:
        for row in csv.DictReader(f):
            m = SLOT.match((row.get('slot') or '').strip())
            colour = (row.get('colour') or '').strip().lower()
            if not m or not HEX.match(colour):
                raise SystemExit('%s: bad row %r' % (os.path.relpath(path, REPO), row))
            roles[m.group(1)].append((int(m.group(2)), colour))
    return {r: [c for _, c in sorted(roles[r])] for r in ROLES}


def build():
    names = sorted(f[:-4] for f in os.listdir(PALETTES) if f.endswith('.csv'))
    palettes = [dict(name=n, **read_palette(os.path.join(PALETTES, n + '.csv'))) for n in names]
    return {'version': 1, 'roles': ROLES, 'palettes': palettes}


def dumps(model):
    """One palette per line."""
    c = lambda v: json.dumps(v, separators=(',', ':'))
    rows = [c(p) + (',' if i < len(model['palettes']) - 1 else '') for i, p in enumerate(model['palettes'])]
    return '{"version":%d,"roles":%s,"palettes":[\n%s\n]}\n' % (model['version'], c(model['roles']), '\n'.join(rows))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--check', action='store_true', help='exit 1 if %s is stale' % os.path.relpath(OUT, REPO))
    args = ap.parse_args()
    text = dumps(build())
    old = open(OUT, encoding='utf-8').read() if os.path.exists(OUT) else None
    if args.check:
        if old != text:
            print('%s is stale: run python3 studio/tools/build_palettes.py' % os.path.relpath(OUT, REPO))
            sys.exit(1)
        print('%s is up to date' % os.path.relpath(OUT, REPO))
        return
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    print('%d palettes -> %s (%s)' % (len(json.loads(text)['palettes']), os.path.relpath(OUT, REPO),
                                       'unchanged' if old == text else 'written'))


if __name__ == '__main__':
    main()
