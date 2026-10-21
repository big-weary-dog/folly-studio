#!/usr/bin/env python3
"""Hold the rigs' channels to what lighting drives (a lighting checkout: tools/sources.py), read only.

    python3 tools/check_channels.py   # exit 1, naming each disagreement, if lighting has moved

Both rigs against their xLights models (the channels a sequence's .fseq carries): every LED in one model, each model
starting on its first LED and running on three channels a pixel, its nodes laid out the way our LEDs run. City of
Gods also against the Falcon's newest certified string config in falcon-backups/ (the board takes those channels by
DDP and re-orders them to the wiring) and pi/data/power.json's rose: every string on whole LEDs in our order, each
petal's string where the Pi's expansion puts it. LEDs the Falcon leaves dark are allowed only inside a model it
drives in part, a strip shorter than its model (lighting's output-layer trims).
"""
import glob
import json
import math
import os
import sys
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True  # keep tools free of __pycache__
from sources import STUDIO, lighting  # noqa: E402

RIGS = [('rig.json', os.path.join('city-of-gods', 'xlights-show')),
        ('rig-folly.json', os.path.join('show-builder', 'xlights'))]
POWER = os.path.join(STUDIO, 'pi', 'data', 'power.json')
TIDY = 0.9  # how closely a model's grid must follow our LEDs along an axis for its direction to count


def read(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def models(path):
    """Each xLights model: name, first channel (0-based), node → (column, height in rows), turned about y."""
    out = []
    for m in ET.parse(path).getroot().iter('model'):
        grid = {}
        for r, row in enumerate((m.get('CustomModel') or '').split('|')[0].split(';')):
            for c, v in enumerate(row.split(',')):
                if v.strip() and int(v) > 0:
                    grid.setdefault(int(v), (c, -r))
        start = int(m.get('StartChannel').split(':')[-1]) - 1
        out.append({'name': m.get('name'), 'start': start, 'grid': grid, 'turn': float(m.get('RotateY') or 0),
                    'flip': -1 if float(m.get('ScaleX') or 1) < 0 else 1})
    return out


def corr(a, b):
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    sab = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    saa, sbb = sum((x - ma) ** 2 for x in a), sum((y - mb) ** 2 for y in b)
    return sab / (saa * sbb) ** 0.5 if saa and sbb else 0


def check_models(rig, addr, at, ms, bad):
    pos = rig['pixels']['pos']
    seen = set()
    for m in ms:
        nodes = sorted(m['grid'])
        if nodes != list(range(1, len(nodes) + 1)):
            bad('%s: nodes are not 1..%d' % (m['name'], len(nodes)))
            continue
        leds = [at.get(m['start'] + 3 * i) for i in range(len(nodes))]
        if None in leds:
            bad('%s: node %d is on no LED of ours' % (m['name'], leds.index(None) + 1))
            continue
        seen.update(leds)
        if len(leds) < 3:
            continue
        # column runs along the model's turned x: cathedral +z unturned, +x turned 90°; rows run up +y
        t = math.radians(m['turn'])
        along = [m['flip'] * (math.sin(t) * pos[3 * k] + math.cos(t) * pos[3 * k + 2]) for k in leds]
        for axis, mine, name in ((0, along, 'across'), (1, [pos[3 * k + 1] for k in leds], 'up')):
            r = corr([m['grid'][n][axis] for n in nodes], mine)
            if abs(r) >= TIDY and r < 0:
                bad('%s: its nodes run the other way %s from our LEDs' % (m['name'], name))
    lost = [k for k in range(len(addr)) if k not in seen]
    if lost:
        bad('%d LEDs in no xLights model, the first at channel %d' % (len(lost), addr[lost[0]] + 1))


def check_falcon(addr, at, ms, snapshot, power, bad):
    petals = {p['exp']: p for p in power['petals']}
    cells = set(a for p in power['petals'] for a in range(p['src'], p['src'] + 3 * 14))
    model_of = lambda a: next((m['name'] for m in ms if m['start'] <= a < m['start'] + 3 * len(m['grid'])), None)
    driven = set()
    for row in read(snapshot)['rows']:
        n, sc, what = row['n'], row['sc'], row.get('nm') or 'port %d' % (row['p'] + 1)
        if not n:
            continue
        if sc in petals:
            p = petals.pop(sc)
            span = sum(skip + count for skip, _, count in p['segments'])
            if span > n:
                bad('%s: %d px, short of the %d the rose expands to' % (what, n, span))
            continue
        leds = [at.get(sc + 3 * i) for i in range(n)]
        if None in leds:
            bad('%s: channel %d is on no LED of ours' % (what, sc + 3 * leds.index(None) + 1))
            continue
        driven.update(leds)
    for exp in petals:
        bad('no Falcon string at channel %d, where the Pi expands a petal' % (exp + 1))
    dark = {}
    for k, a in enumerate(addr):
        if k not in driven and a not in cells:
            dark.setdefault(model_of(a), []).append(a)
    lit = set(model_of(addr[k]) for k in driven)
    for model, chans in dark.items():
        if model not in lit:
            bad('no Falcon string drives %s (channel %d)' % (model or 'channels in no model', chans[0] + 1))
    return ['%s: %d px' % (m, len(c)) for m, c in dark.items() if m in lit]


def main():
    repo = lighting()
    problems = []
    for name, show in RIGS:
        rig = read(os.path.join(STUDIO, 'public', 'data', name))
        cpu = rig['output']['channelsPerUniverse']
        addr = [(u - 1) * cpu + c - 1 for u, c in zip(rig['pixels']['universe'], rig['pixels']['channel'])]
        at = dict((a, k) for k, a in enumerate(addr))
        ms = models(os.path.join(repo, show, 'xlights_rgbeffects.xml'))
        bad = lambda msg, name=name: problems.append('%s: %s' % (name, msg))
        check_models(rig, addr, at, ms, bad)
        print('%s: %d LEDs on %d xLights models (%s)' % (name, len(addr), len(ms), show))
        if name == 'rig.json':
            snaps = sorted(glob.glob(os.path.join(repo, 'falcon-backups', '*-cog-CERTIFIED.json')))
            if not snaps:
                bad('no *-cog-CERTIFIED.json in falcon-backups/')
                continue
            trimmed = check_falcon(addr, at, ms, snaps[-1], read(POWER), bad)
            print('%s: every string of %s on our channels; dark in the Falcon (its trims): %s'
                  % (name, os.path.relpath(snaps[-1], repo), '; '.join(trimmed) or 'none'))
    for p in problems:
        print(p)
    if problems:
        print('the channels have moved in lighting (%s): see CONTRIBUTING "Show data"' % repo)
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
