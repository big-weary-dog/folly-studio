#!/usr/bin/env python3
"""Build studio/public/data/cathedral.json, the Folly Studio model of the cathedral.

    python3 studio/tools/build_cathedral.py [--check]   # write it, or exit 1 if the committed file is stale

Every LED comes from td/python/make_pixel_csv.py's pixel_rows(), so the studio lights exactly the LEDs
TouchDesigner, Mirage and the relay do: same order, universe/channel and places. This adds what the CSV
does not keep: strands (an arch, a quad face, a spire strand, a rose petal...), learnt by wrapping
make_pixel_csv's module-global `chain` generator (consecutive spirelet or wash pixels of one corner or
chain merged), and an xLights-style tree of groups. Views: td/config/views.json, verbatim. Universes:
xlights/xlights_networks.xml. Format: studio/SPEC.md.
"""
import argparse
import json
import os
import re
import sys

sys.dont_write_bytecode = True  # keep td/python free of __pycache__

HERE = os.path.dirname(os.path.abspath(__file__))
STUDIO = os.path.dirname(HERE)
REPO = os.path.dirname(STUDIO)
TD_PYTHON = os.path.join(REPO, 'td', 'python')
PIXEL_MAP = os.path.join(REPO, 'pixel-map')
VIEWS = os.path.join(REPO, 'td', 'config', 'views.json')
NETWORKS = os.path.join(REPO, 'xlights', 'xlights_networks.xml')
OUT = os.path.join(STUDIO, 'public', 'data', 'cathedral.json')

CHANNELS_PER_UNIVERSE = 510

if TD_PYTHON not in sys.path:
    sys.path.insert(0, TD_PYTHON)
import make_pixel_csv as mpc  # noqa: E402  (needs the path above)

TOWERS = {'FL': 'front-left', 'FR': 'front-right', 'BL': 'back-left', 'BR': 'back-right'}

def title(words):
    return words[:1].upper() + words[1:]

def strand_identity(zone, start):
    """(merge key or None, display name, extra) for one chain() call; a key merges consecutive calls."""
    if zone == 'main-arch':
        return None, 'Main arch %d' % start['arch_id'], {}
    m = re.match(r'mini-arch-(left|right)$', zone)
    if m:
        return None, 'Mini arch %s %d' % (m.group(1), start['arch_id']), {}
    m = re.match(r'quad-arch-(.+)$', zone)
    if m:
        role = start.get('face_role') or 'face %d' % start.get('face_index', 0)
        return None, 'Quad %s %s face' % (m.group(1), role), {'face': role}
    m = re.match(r'spire-(.+)$', zone)
    if m:
        return None, 'Spire %s strand %d' % (m.group(1), start['string_index'] + 1), {}
    if zone == 'spirelet':
        corner = start['corner']
        return ('spirelet', corner), 'Spirelets %s' % corner, {'corner': corner}
    if zone == 'canopy':
        return None, 'Canopy run %d' % (start['run_index'] + 1), {}
    if zone == 'wash':
        chain = start['chain']  # 'WASH-FR': a tower's flood chain
        tower = start.get('tower') or TOWERS.get(chain.split('-')[-1], chain.lower())
        return ('wash', chain), 'Wash %s' % tower, {'tower': tower}
    m = re.match(r'rose-petal-(\d+)$', zone)
    if m:
        return None, 'Rose petal %s' % m.group(1), {}
    return None, title(zone.replace('-', ' ')), {}

def tagged_rows(pixel_map):
    """pixel_rows() plus, per row, its strand index, and the strand list."""
    strands, tags = [], []
    original = mpc.chain

    def chain(zone, start, places, channels, rows=None):
        key, name, extra = strand_identity(zone, start)
        last = strands[-1] if strands else None
        if key is None or last is None or last['key'] != key or last['zone'] != zone:
            strands.append({'zone': zone, 'name': name, 'key': key, 'count': 0, **extra})
        index = len(strands) - 1
        for led in original(zone, start, places, channels, rows):
            tags.append(index)
            strands[index]['count'] += 1
            yield led

    mpc.chain = chain
    try:
        rows = mpc.pixel_rows(pixel_map, CHANNELS_PER_UNIVERSE)
    finally:
        mpc.chain = original
    if len(tags) != len(rows):
        raise SystemExit('strand tags (%d) and pixel rows (%d) disagree' % (len(tags), len(rows)))
    for i, row in enumerate(rows):
        if strands[tags[i]]['zone'] != row[0]:
            raise SystemExit('row %d: zone %s tagged as strand of %s'
                             % (i, row[0], strands[tags[i]]['zone']))
    return rows, tags, strands

def universes_in_networks():
    """Universe count of the xLights networks (one <network> per universe, 510 channels)."""
    with open(NETWORKS, encoding='utf-8') as f:
        text = f.read()
    sizes = re.findall(r'MaxChannels="(\d+)"', text)
    if not sizes or any(int(s) != CHANNELS_PER_UNIVERSE for s in sizes):
        raise SystemExit('%s: expected networks of %d channels' % (NETWORKS, CHANNELS_PER_UNIVERSE))
    return len(sizes)

def m3(v):
    """Metres to 3 decimals as a float (deterministic text via repr)."""
    return float('%.3f' % float(v))

def build_groups(zones, strands):
    groups = []

    def add(gid, name, parent, zones_=None, strands_=None, rows=None):
        g = {'id': gid, 'name': name, 'parent': parent}
        for k, v in (('zones', zones_), ('strands', strands_), ('rows', rows)):
            if v:
                g[k] = list(v)
        groups.append(g)

    def zones_like(pattern):
        return [z for z in zones if re.match(pattern, z)]

    def strands_of(zone):
        return [i for i, s in enumerate(strands) if s['zone'] == zone]

    add('cathedral', 'Cathedral', None, zones)

    # Arches.
    arch_zones = zones_like(r'(main-arch|mini-arch-|quad-arch-)')
    add('arches', 'Arches', 'cathedral', arch_zones)
    add('main-arches', 'Main arches', 'arches', ['main-arch'])
    for n, s in enumerate(strands_of('main-arch'), 1):
        add('main-arch-%d' % n, strands[s]['name'], 'main-arches', strands_=[s])
    add('mini-arches', 'Mini arches', 'arches', zones_like(r'mini-arch-'))
    for side in ('left', 'right'):
        zone = 'mini-arch-' + side
        add('mini-arches-' + side, 'Mini arches ' + side, 'mini-arches', [zone])
        for n, s in enumerate(strands_of(zone), 1):
            add('mini-arch-%s-%d' % (side, n), strands[s]['name'], 'mini-arches-' + side, strands_=[s])
    quads = zones_like(r'quad-arch-')
    add('quad-arches', 'Quad arches', 'arches', quads)
    for zone in quads:
        quad = zone[len('quad-arch-'):]
        gid = 'quad-' + quad
        add(gid, 'Quad ' + quad, 'quad-arches', [zone])
        for s in strands_of(zone):
            face = strands[s].get('face', str(s))
            add('%s-%s' % (gid, face), strands[s]['name'], gid, strands_=[s])

    # Spires, spirelets.
    spires = zones_like(r'spire-')
    add('spires', 'Spires', 'cathedral', spires)
    for zone in spires:
        add(zone, 'Spire ' + zone[len('spire-'):], 'spires', [zone])
    add('spirelets', 'Spirelets', 'cathedral', ['spirelet'])
    for s in strands_of('spirelet'):
        add('spirelets-' + strands[s]['corner'], strands[s]['name'], 'spirelets', strands_=[s])

    # Rose window: each petal, and each ring across all petals.
    petals = zones_like(r'rose-petal-')
    add('rose-window', 'Rose window', 'cathedral', petals)
    for zone in petals:
        add(zone, 'Rose petal ' + zone[len('rose-petal-'):], 'rose-window', [zone])
    for ring in range(1, 8):
        add('rose-ring-%d' % ring, 'Rose ring %d' % ring, 'rose-window', petals, rows=[ring])

    # Canopy, wash.
    add('canopy', 'Canopy', 'cathedral', ['canopy'])
    for n, s in enumerate(strands_of('canopy'), 1):
        add('canopy-run-%d' % n, strands[s]['name'], 'canopy', strands_=[s])
    add('wash', 'Wash', 'cathedral', ['wash'])
    for s in strands_of('wash'):
        add('wash-' + strands[s]['tower'], strands[s]['name'], 'wash', strands_=[s])

    ids = [g['id'] for g in groups]
    if len(ids) != len(set(ids)):
        raise SystemExit('duplicate group ids')
    return groups

def build():
    rows, tags, strands = tagged_rows(PIXEL_MAP)
    zones = []
    for r in rows:
        if r[0] not in zones:
            zones.append(r[0])
    zone_index = {z: i for i, z in enumerate(zones)}

    pos = []
    for r in rows:
        pos += [m3(r[4]), m3(r[5]), m3(r[6])]
    lo = [min(pos[i::3]) for i in range(3)]
    hi = [max(pos[i::3]) for i in range(3)]

    out_strands, start = [], 0
    for s in strands:
        out_strands.append({'zone': zone_index[s['zone']], 'name': s['name'], 'start': start,
                            'count': s['count']})
        start += s['count']

    with open(VIEWS, encoding='utf-8') as f:
        views = json.load(f)['views']

    return {
        'version': 1, 'count': len(rows), 'channelsPerUniverse': CHANNELS_PER_UNIVERSE,
        'universes': universes_in_networks(), 'bounds': {'min': lo, 'max': hi}, 'zones': zones,
        'strands': out_strands,
        'pixels': {
            'zone': [zone_index[r[0]] for r in rows],
            'strand': tags,
            'universe': [int(r[2]) for r in rows],
            'channel': [int(r[3]) for r in rows],
            'row': [int(r[10]) if r[10] != '' else 0 for r in rows],
            'pos': pos,
        },
        'groups': build_groups(zones, strands), 'views': views,
    }

def dumps(model):
    """Compact but diffable: one top-level key, strand or group per line."""
    c = lambda v: json.dumps(v, separators=(',', ':'), ensure_ascii=False)
    lines = ['{']
    keys = list(model)
    for n, key in enumerate(keys):
        comma = ',' if n < len(keys) - 1 else ''
        value = model[key]
        if key in ('strands', 'groups'):
            lines.append('%s:[' % c(key))
            lines += [c(item) + (',' if i < len(value) - 1 else '') for i, item in enumerate(value)]
            lines.append(']' + comma)
        elif key in ('pixels', 'views'):
            lines.append('%s:{' % c(key))
            sub = list(value)
            lines += ['%s:%s%s' % (c(k), c(value[k]), ',' if i < len(sub) - 1 else '')
                      for i, k in enumerate(sub)]
            lines.append('}' + comma)
        else:
            lines.append('%s:%s%s' % (c(key), c(value), comma))
    lines.append('}')
    return '\n'.join(lines) + '\n'

def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--check', action='store_true', help='exit 1 if %s is stale' % os.path.relpath(OUT, REPO))
    ap.add_argument('--out', default=OUT, help='where to write (default: %(default)s)')
    args = ap.parse_args()
    text = dumps(build())
    old = open(args.out, encoding='utf-8').read() if os.path.exists(args.out) else None
    if args.check:
        if old != text:
            print('%s is stale: run python3 studio/tools/build_cathedral.py' % os.path.relpath(args.out, REPO))
            sys.exit(1)
        print('%s is up to date' % os.path.relpath(args.out, REPO))
        return
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    model = json.loads(text)
    print('%d LEDs, %d zones, %d strands, %d groups -> %s (%s)'
          % (model['count'], len(model['zones']), len(model['strands']), len(model['groups']),
             os.path.relpath(args.out, REPO), 'unchanged' if old == text else 'written'))

if __name__ == '__main__':
    main()
