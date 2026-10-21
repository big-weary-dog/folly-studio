#!/usr/bin/env python3
"""Build the rigs as the studio sees them (SPEC "Rig"): City of Gods, the default, as public/data/rig.json from
show-builder's city-of-gods/pixel-map/ (tools/cog_rig.py), and the Gothic Folly's playa build as rig-folly.json from
its pixel-map/ (show-builder: tools/sources.py).

    python3 tools/build_rig.py [--check]   # write them, or exit 1 if a committed file is stale

Every LED comes from td/python/make_pixel_csv.py's pixel_rows(), so the studio lights exactly the LEDs
TouchDesigner, Mirage and the relay do from the same pixel map: same order, universe/channel and places. This adds
what the CSV does not keep: fixtures (an arch, a quad face, a spire strand, a rose petal...), learnt by wrapping
make_pixel_csv's module-global `chain` generator (consecutive spirelet or wash pixels of one corner or chain merged),
the rose's rings and petals as attrs, a tagged group tree, and the render hints and scaffold Mirage draws
(tools/rig_render.py). Views: td/config/views.json (City of Gods: its own). Output: td/config/output.json, universes
from xlights/xlights_networks.xml.
"""
import argparse
import json
import os
import re
import sys

sys.dont_write_bytecode = True  # keep td/python and tools free of __pycache__

HERE = os.path.dirname(os.path.abspath(__file__))
from sources import SHOW_BUILDER as REPO, STUDIO  # noqa: E402

TD_PYTHON = os.path.join(REPO, 'td', 'python')
PIXEL_MAP = os.path.join(REPO, 'pixel-map')
TD_CONFIG = os.path.join(REPO, 'td', 'config')
NETWORKS = os.path.join(REPO, 'xlights', 'xlights_networks.xml')
DATA = os.path.join(STUDIO, 'public', 'data')

for p in (TD_PYTHON, HERE):
    if p not in sys.path:
        sys.path.insert(0, p)
import make_pixel_csv as mpc  # noqa: E402  (needs the path above)
import rig_render  # noqa: E402
import cog_rig  # noqa: E402

NAME = 'Gothic Folly 2026'
ABOUT = ('The Gothic Folly is a full-scale LED cathedral built for Burning Man: a playa-facing portal of five '
         'main arches, mini arches left and right, six quad arches, four spires, spirelets (flood-lit cones), a '
         '16-petal rose window with 7 rings of cells, a canopy overhead and a ground wash of 22 floods.')
TOWERS = {'FL': 'front-left', 'FR': 'front-right', 'BL': 'back-left', 'BR': 'back-right'}
QUADS = ['back-bottom-left', 'back-bottom-right', 'back-top-left', 'back-top-right', 'front-top-left',
         'front-top-right']


def read(*parts):
    with open(os.path.join(*parts), encoding='utf-8') as f:
        return json.load(f)


def identity(zone, start, n):
    """(merge key or None, id, name) for the n-th chain() call of a zone; a key merges consecutive calls."""
    if zone == 'main-arch':
        return None, 'main-arch-%d' % n, 'Main arch %d' % n
    m = re.match(r'mini-arch-(left|right)$', zone)
    if m:
        return None, 'mini-arch-%s-%d' % (m.group(1), n), 'Mini arch %s %d' % (m.group(1), n)
    m = re.match(r'quad-arch-(.+)$', zone)
    if m:
        role = start.get('face_role') or 'face-%d' % start.get('face_index', 0)
        return None, 'quad-%s-%s' % (m.group(1), role), 'Quad %s %s face' % (m.group(1), role)
    m = re.match(r'spire-(.+)$', zone)
    if m:
        k = start['string_index'] + 1
        return None, 'spire-%s-%d' % (m.group(1), k), 'Spire %s strand %d' % (m.group(1), k)
    if zone == 'spirelet':
        return ('spirelet', start['corner']), 'spirelets-' + start['corner'], 'Spirelets ' + start['corner']
    if zone == 'canopy':
        k = start['run_index'] + 1
        return None, 'canopy-run-%d' % k, 'Canopy run %d' % k
    if zone == 'wash':
        chain = start['chain']  # 'WASH-FR': a tower's flood chain
        tower = start.get('tower') or TOWERS.get(chain.split('-')[-1], chain.lower())
        return ('wash', chain), 'wash-' + tower, 'Wash ' + tower
    return None, zone, zone[:1].upper() + zone[1:].replace('-', ' ')


def tagged_rows(pixel_map):
    """pixel_rows() plus, per row, its fixture index, and the fixtures."""
    fixtures, tags = [], []
    original, sources = mpc.chain, mpc.sources

    def chain(zone, start, places, channels, rows=None):
        n = sum(1 for f in fixtures if f['zone'] == zone) + 1
        key, fid, name = identity(zone, start, n)
        last = fixtures[-1] if fixtures else None
        if key is None or last is None or last['key'] != key or last['zone'] != zone:
            if any(f['id'] == fid for f in fixtures):  # a corner's spirelet chained on after another corner's
                k = start['label'].split('-')[-1]
                fid, name = 'spirelet-%s-%s' % (start['corner'], k), 'Spirelet %s %s' % (start['corner'], k)
            fixtures.append({'id': fid, 'name': name, 'zone': zone, 'key': key, 'count': 0})
        index = len(fixtures) - 1
        for led in original(zone, start, places, channels, rows):
            tags.append(index)
            fixtures[index]['count'] += 1
            yield led

    mpc.chain = chain
    mpc.sources = lambda pm: [s for s in sources(pm) if os.path.exists(os.path.join(pm, s[1]))]  # no canopy: none
    try:
        rows = mpc.pixel_rows(pixel_map, output()['channelsPerUniverse'])
    finally:
        mpc.chain, mpc.sources = original, sources
    if len(tags) != len(rows) or any(fixtures[tags[i]]['zone'] != r[0] for i, r in enumerate(rows)):
        raise SystemExit('fixture tags and pixel rows disagree')
    return rows, tags, fixtures


def output():
    out = read(TD_CONFIG, 'output.json')
    cpu = out['channels_per_universe']
    with open(NETWORKS, encoding='utf-8') as f:
        sizes = re.findall(r'MaxChannels="(\d+)"', f.read())
    if not sizes or any(int(s) != cpu for s in sizes):
        raise SystemExit('%s: expected networks of %d channels' % (NETWORKS, cpu))
    return {'protocol': out['protocol'], 'universes': len(sizes), 'channelsPerUniverse': cpu, 'order': 'RGB',
            'fps': out['frame_rate']}


def m3(v):
    """Metres to 3 decimals as a float (deterministic text via repr)."""
    return float('%.3f' % float(v))


def folly_scaffold():
    """The Folly's scaffold, and its spirelet and wash cones."""
    quads = dict((q, read(PIXEL_MAP, 'arch-led-positions-quad-%s.json' % q)) for q in QUADS)
    towers = rig_render.towers(quads, read(PIXEL_MAP, 'wash-led-positions.json'))
    return rig_render.structure(towers), rig_render.spirelet_cone, lambda mine: rig_render.wash_cone(mine, towers)


def render_hints(fixtures, rows, pixel_map, spirelet_cone, wash_cone=None):
    """Each fixture's kind and render hints, as Mirage draws it."""
    strips = rig_render.strip_hints()
    cells = read(pixel_map, 'cell-polygons.json')['cells']
    petals = read(pixel_map, 'window-data.json')['petals']
    order = read(pixel_map, 'universe-map.json')['zones']['rose_window']['cell_order']
    floods, first = {'spirelet': read(pixel_map, 'spires-corners-led-positions.json')['pixels']}, {}
    if wash_cone:
        floods['wash'] = read(pixel_map, 'wash-led-positions.json')['pixels']
    for f in fixtures:
        zone, at = f['zone'], f['start']
        mine = floods.get(zone, [])[at - first.setdefault(zone, at):][:f['count']]
        if any(m3(a) != m3(b) for p, r in zip(mine, rows[at:]) for a, b in zip(p['position'], r[4:7])):
            raise SystemExit('%s: pixel-map order differs from the CSV' % f['id'])
        if zone == 'wash':
            f.update(kind='flood', render={'cone': wash_cone(mine)})
        elif zone == 'spirelet':
            f.update(kind='flood', render={'cone': spirelet_cone(mine)})
        elif zone.startswith('rose-petal-'):
            petal = petals[int(zone[len('rose-petal-'):]) - 1]
            f.update(kind='cells', render={'cells': rig_render.rose_cells(mpc, cells, petal, order),
                                           'normal': [-1, 0, 0]})
        else:
            f.update(kind='strip', render=next(v for k, v in strips.items() if zone.startswith(k)))


def build_groups(zones, fixtures, pixel_map, drop=()):
    """The group tree; `drop`: side tags that name no real place on this rig."""
    groups = []

    def add(gid, name, parent, tags=(), zones_=None, fixtures_=None, where=None, centre=None):
        g = {'id': gid, 'name': name, 'parent': parent}
        for k, v in (('tags', list(tags)), ('zones', zones_), ('fixtures', fixtures_), ('where', where),
                     ('centre', centre)):
            if v:
                g[k] = v
        groups.append(g)

    like = lambda pattern: [z for z in zones if re.match(pattern, z)]
    sides = lambda name: [s for s in ('front', 'back', 'left', 'right') if s in name.split('-') and s not in drop]

    add('cathedral', 'Cathedral', None, ['all'], zones)
    add('arches', 'Arches', 'cathedral', ['arch'], like(r'(main-arch|mini-arch-|quad-arch-)'))
    add('main-arches', 'Main arches', 'arches', ['arch-main', 'ground-level'], ['main-arch'])
    leaves = lambda zone, parent: [add(f['id'], f['name'], parent, sides(f['id']) if zone in ('spirelet', 'wash')
                                       else (), fixtures_=[f['id']]) for f in fixtures if f['zone'] == zone]
    leaves('main-arch', 'main-arches')
    add('mini-arches', 'Mini arches', 'arches', ['arch-mini', 'ground-level'], like(r'mini-arch-'))
    for side in ('left', 'right'):
        add('mini-arches-' + side, 'Mini arches ' + side, 'mini-arches', [side], ['mini-arch-' + side])
        leaves('mini-arch-' + side, 'mini-arches-' + side)
    add('quad-arches', 'Quad arches', 'arches', ['arch-quad'], like(r'quad-arch-'))
    for zone in like(r'quad-arch-'):
        quad = zone[len('quad-arch-'):]
        low = ['ground-level'] if 'bottom' in quad else []
        add('quad-' + quad, 'Quad ' + quad, 'quad-arches', sides(quad) + low, [zone])
        leaves(zone, 'quad-' + quad)

    add('spires', 'Spires', 'cathedral', ['spire'], like(r'spire-'))
    for zone in like(r'spire-'):
        spire = read(pixel_map, 'spire-led-positions-%s.json' % zone[len('spire-'):])
        centre = [m3((a + b) / 2) for a, b in zip(spire['base_center'], spire['apex'])]
        add(zone, 'Spire ' + zone[len('spire-'):], 'spires', ['tower'] + sides(zone), [zone], centre=centre)
    add('spirelets', 'Spirelets', 'cathedral', ['spirelet'], ['spirelet'])
    leaves('spirelet', 'spirelets')

    petals = like(r'rose-petal-')
    centre = [mpc.WINDOW_DEPTH_M, mpc.WINDOW_CENTRE_Y_M, mpc.WINDOW_CENTRE_Z_M]
    add('rose-window', 'Rose window', 'cathedral', ['rose', 'window'], petals, centre=centre)
    for zone in petals:
        add(zone, 'Rose petal ' + zone[len('rose-petal-'):], 'rose-window', zones_=[zone])
    for ring in range(1, 8):
        add('rose-ring-%d' % ring, 'Rose ring %d' % ring, 'rose-window', ['ring'], where={'ring': [ring]})

    if 'canopy' in zones:
        add('canopy', 'Canopy', 'cathedral', ['canopy'], ['canopy'])
        leaves('canopy', 'canopy')
    if 'wash' in zones:
        add('wash', 'Wash', 'cathedral', ['wash', 'flood'], ['wash'])
        leaves('wash', 'wash')

    ids = [g['id'] for g in groups]
    if len(ids) != len(set(ids)):
        raise SystemExit('duplicate group ids')
    return groups


def build(which):
    """The rig `which` ('cog' or 'folly')."""
    cog = which == 'cog'
    pixel_map = cog_rig.PIXEL_MAP if cog else PIXEL_MAP
    rows, tags, fixtures = tagged_rows(pixel_map)
    zones = []
    for r in rows:
        if r[0] not in zones:
            zones.append(r[0])
    pos = []
    for r in rows:
        pos += [m3(r[4]), m3(r[5]), m3(r[6])]
    start = 0
    for f in fixtures:
        f.update(start=start)
        start += f['count']
    if cog:
        structure = cog_rig.structure(read(pixel_map, 'spires-corners-led-positions.json')['pixels'])
        render_hints(fixtures, rows, pixel_map, cog_rig.spirelet_cone)
    else:
        structure, spirelet_cone, wash_cone = folly_scaffold()
        render_hints(fixtures, rows, pixel_map, spirelet_cone, wash_cone)
    groups = build_groups(zones, fixtures, pixel_map, drop=('back',) if cog else ())
    if cog:
        cog_rig.names(groups + fixtures)
    petal = lambda zone: int(zone[len('rose-petal-'):]) - 1 if zone.startswith('rose-petal-') else -1
    return {
        'rig': 1, 'name': cog_rig.NAME if cog else NAME, 'about': cog_rig.ABOUT if cog else ABOUT,
        'units': 'm', 'axes': {'up': '+y', 'front': '-x', 'right': '+z'},
        'output': output(), 'count': len(rows),
        'bounds': {'min': [min(pos[i::3]) for i in range(3)], 'max': [max(pos[i::3]) for i in range(3)]},
        'fixtures': [{k: f[k] for k in ('id', 'name', 'zone', 'kind', 'start', 'count', 'render')} for f in fixtures],
        'pixels': {
            'universe': [int(r[2]) for r in rows],
            'channel': [int(r[3]) for r in rows],
            'pos': pos,
            'attrs': {'ring': [int(r[10]) if r[10] != '' else 0 for r in rows],
                      'sector': [petal(r[0]) for r in rows]},
        },
        'groups': groups,
        'views': cog_rig.VIEWS if cog else read(TD_CONFIG, 'views.json')['views'],
        'structure': structure,
    }


def dumps(rig):
    """Compact but diffable: one top-level key, fixture, group, pixel array or scaffold line per line."""
    c = lambda v: json.dumps(v, separators=(',', ':'), ensure_ascii=False)
    block = lambda items, open_, close: [open_] + [c(v) + ',' for v in items[:-1]] + [c(items[-1]), close]
    lines = ['{']
    keys = list(rig)
    for n, key in enumerate(keys):
        comma = ',' if n < len(keys) - 1 else ''
        value = rig[key]
        if key in ('fixtures', 'groups'):
            lines += block(value, '%s:[' % c(key), ']' + comma)
        elif key in ('pixels', 'views'):
            sub = list(value)
            lines += ['%s:{' % c(key)] + ['%s:%s%s' % (c(k), c(value[k]), ',' if i < len(sub) - 1 else '')
                                          for i, k in enumerate(sub)] + ['}' + comma]
        elif key == 'structure':
            rest = {k: v for k, v in value.items() if k != 'lines'}
            lines += ['%s:{' % c(key)] + block(value['lines'], '"lines":[', '],') + [c(rest)[1:-1], '}' + comma]
        else:
            lines.append('%s:%s%s' % (c(key), c(value), comma))
    return '\n'.join(lines + ['}']) + '\n'


RIGS = {'cog': 'rig.json', 'folly': 'rig-folly.json'}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--check', action='store_true', help='exit 1 if a committed rig is stale')
    ap.add_argument('--out', default=DATA, help='the folder to write them to (default: %(default)s)')
    args = ap.parse_args()
    stale = False
    for which, name in RIGS.items():
        out = os.path.join(args.out, name)
        text = dumps(build(which))
        old = open(out, encoding='utf-8').read() if os.path.exists(out) else None
        if args.check:
            stale = stale or old != text
            print('%s %s' % (os.path.relpath(out, STUDIO), 'is up to date' if old == text
                             else 'is stale: run python3 tools/build_rig.py'))
            continue
        os.makedirs(args.out, exist_ok=True)
        with open(out, 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
        rig = json.loads(text)
        print('%d LEDs, %d fixtures, %d groups, %d scaffold lines -> %s (%s)'
              % (rig['count'], len(rig['fixtures']), len(rig['groups']), len(rig['structure']['lines']),
                 os.path.relpath(out, STUDIO), 'unchanged' if old == text else 'written'))
    sys.exit(1 if stale else 0)

if __name__ == '__main__':
    main()
