"""The Folly's render hints and scaffold for rig.json (SPEC "Rig"), drawn as Mirage draws the Folly.

Sizes are read from mirage/src/config.js and the constants of mirage/src/world/scaffold.js and zones/spires.js,
so the studio's 3D view follows Mirage; places come from pixel-map/ (all in show-builder: tools/sources.py). Used by
tools/build_rig.py.
"""
import math
import os
import re

from sources import SHOW_BUILDER

MIRAGE = os.path.join(SHOW_BUILDER, 'mirage', 'src')
_text = {}


def _source(rel):
    if rel not in _text:
        with open(os.path.join(MIRAGE, rel), encoding='utf-8') as f:
            _text[rel] = f.read()
    return _text[rel]


def _block(text, name):
    """The body of the object literal `name: {…}` or `name = {…}` in text."""
    m = re.search(r'\b%s\s*[:=]\s*\{' % name, text)
    depth = 0
    for end in range(m.end() - 1, len(text)) if m else ():
        depth += {'{': 1, '}': -1}.get(text[end], 0)
        if depth == 0:
            return text[m.end():end]
    raise SystemExit('mirage/src/config.js: no %s' % name)


def config(path, key):
    """A number in config.js, e.g. config('FIXTURES.canopy', 'sag'): `key` at the top level of that object."""
    body = _source('config.js')
    for name in path.split('.'):
        body = _block(body, name)
    v = re.search(r'\b%s\s*:\s*(-?[\d.]+)' % key, re.sub(r'\{[^{}]*\}', '', body))
    if not v:
        raise SystemExit('mirage/src/config.js: no %s.%s' % (path, key))
    return float(v.group(1))


def const(rel, name):
    """A top-level `const NAME = number` in a Mirage module."""
    v = re.search(r'\bconst %s = (-?[\d.]+)' % name, _source(rel))
    if not v:
        raise SystemExit('mirage/src/%s: no %s' % (rel, name))
    return float(v.group(1))


def r3(v):
    return float('%.3f' % v)


def r2(v):
    return float('%.2f' % v)


def unit(v):
    n = math.sqrt(sum(c * c for c in v)) or 1
    return [c / n for c in v]


# Strips: a tube as wide as Mirage's arch sections; globes on wire for the spires and canopy.
def strip_hints():
    globe = {'radius': config('FIXTURES.globe', 'radius'), 'bulbs': True}
    side = {'radius': config('FIXTURES.sideArch', 'width') / 2}
    return {'main-arch': {'radius': config('FIXTURES.mainArch', 'width') / 2}, 'mini-arch': side, 'quad-arch': side,
            'spire': globe, 'canopy': dict(globe, sag=config('FIXTURES.canopy', 'sag'))}


# The scaffold (world/scaffold.js): towers framed from the quad arches and the floods mounted on them.
def towers(quads, wash):
    def box(faces):
        xs = [f['fixed_axis_pos_m'] for f in faces if f['span_axis'] == 'z']
        zs = [f['fixed_axis_pos_m'] for f in faces if f['span_axis'] == 'x']
        return [min(xs), max(xs), min(zs), max(zs)]

    def grown(b, prefix):
        floods = [p['position'] for p in wash['pixels'] if p['label'].startswith(prefix)]
        return [min([b[0]] + [p[0] for p in floods]), max([b[1]] + [p[0] for p in floods]),
                min([b[2]] + [p[2] for p in floods]), max([b[3]] + [p[2] for p in floods])]

    left, right = box(quads['front-top-left']['faces']), box(quads['front-top-right']['faces'])
    return [('front', 'left', grown(left, 'WASH-FL'), left), ('front', 'right', grown(right, 'WASH-FR'), right),
            ('back', 'left', box(quads['back-bottom-left']['faces']), None),
            ('back', 'right', box(quads['back-bottom-right']['faces']), None)]


def _stations(a, b):
    n = max(1, math.ceil((b - a) / const('world/scaffold.js', 'MAX_BAY') - 1e-6))
    return [a + (b - a) * i / n for i in range(n + 1)]


def _levels(y0, y1):
    n = max(1, math.floor((y1 - y0) / config('SCAFFOLD', 'ledgerSpacing') + 0.5))
    first = const('world/scaffold.js', 'FIRST_LEDGER')
    return [first if i == 0 and y0 == 0 else y0 + (y1 - y0) * i / n for i in range(n + 1)]


def _frame(add, x0, x1, z0, z1, levels, braced):
    xs, zs = _stations(x0, x1), _stations(z0, z1)
    bottom, top = (levels[0] if levels[0] > 0.5 else 0), levels[-1]
    for i, x in enumerate(xs):
        for j, z in enumerate(zs):
            if i in (0, len(xs) - 1) or j in (0, len(zs) - 1):
                add([x, bottom, z], [x, top, z])
    for k, y in enumerate(levels):
        last = k == len(levels) - 1
        for j, z in enumerate(zs):
            if last or j in (0, len(zs) - 1):
                for i in range(len(xs) - 1):
                    add([xs[i], y, z], [xs[i + 1], y, z])
        for i, x in enumerate(xs):
            if last or i in (0, len(xs) - 1):
                for j in range(len(zs) - 1):
                    add([x, y, zs[j]], [x, y, zs[j + 1]])
    faces = [('x0', zs, lambda s, y: [x0, y, s]), ('x1', zs, lambda s, y: [x1, y, s]),
             ('z0', xs, lambda s, y: [s, y, z0]), ('z1', xs, lambda s, y: [s, y, z1])]
    for face, span, at in faces:
        for lo, hi in zip(levels, levels[1:]):
            if braced(face, lo, hi):
                for i in range(len(span) - 1):
                    add(at(span[i], lo), at(span[i + 1], hi))
                    add(at(span[i + 1], lo), at(span[i], hi))


def structure(tower_list):
    lines, eps = [], 1e-3
    top, belfry_top = config('SCAFFOLD', 'top'), config('SCAFFOLD', 'belfryTop')
    reach = const('world/scaffold.js', 'OUTRIGGER_REACH')
    add = lambda a, b: lines.append([r2(v) for v in a + b])
    for end, side, base, belfry in tower_list:
        if end == 'front':  # the mini arches pass through faces x0 and x1
            braced = lambda face, lo, hi: face in ('z0', 'z1') or lo >= 6 - eps
        else:               # quad arches fill 0–4 m and 6–8 m
            braced = lambda face, lo, hi: lo >= 4 - eps and hi <= 6 + eps
        _frame(add, *base, _levels(0, top), braced)
        if belfry:
            _frame(add, *belfry, _levels(top, belfry_top), lambda *_: False)
        outer, out = (base[2], -1) if side == 'left' else (base[3], 1)
        for x in _stations(base[0], base[1]):
            add([x, top * const('world/scaffold.js', 'OUTRIGGER_TOP'), outer], [x, 0, outer + out * reach])
    return {'lines': lines, 'radius': r3(config('SCAFFOLD', 'tubeRadius')), 'ground': {'y': 0}}


# Floods (zones/wash.js, zones/spires.js): the wash aims up or down, tilted toward its tower's middle; a
# spirelet is a lit cone standing on the scaffold, drawn as a solid cone from its tip.
def wash_cone(pixels, tower_list):
    tilt, dirs = config('FIXTURES.wash', 'tilt'), []
    for p in pixels:
        x, _, z = p['position']
        near = min(tower_list, key=lambda t: math.hypot(max(t[2][0] - x, 0, x - t[2][1]),
                                                        max(t[2][2] - z, 0, z - t[2][3])))
        b = near[3] if p['aim'] == 'up' and near[3] else near[2]
        inward = unit([(b[0] + b[1]) / 2 - x, 0, (b[2] + b[3]) / 2 - z])
        dirs.append([r3(v) for v in unit([inward[0] * tilt, 1 if p['aim'] == 'up' else -1, inward[2] * tilt])])
    return {'angle': config('FIXTURES.wash', 'beamAngle'), 'length': config('FIXTURES.wash', 'reach'), 'dirs': dirs}


def spirelet_cone(pixels):
    height, radius = config('FIXTURES.spirelet', 'height'), config('FIXTURES.spirelet', 'radius')
    top, belfry, min_y = config('SCAFFOLD', 'top'), config('SCAFFOLD', 'belfryTop'), const(
        'zones/spires.js', 'BELFRY_SPIRELET_MIN_Y')
    apex = []
    for p in pixels:
        x, y, z = p['position']
        floor = belfry if not p['corner'].startswith('back') and y >= min_y else top
        apex.append([r3(x), r3(floor + height), r3(z)])
    return {'angle': r3(2 * math.degrees(math.atan(radius / height))), 'length': height, 'dir': [0, -1, 0],
            'apex': apex, 'solid': True}


# Rose cells (zones/rose-window.js): each cell's outline turned to its petal and placed as make_pixel_csv's rose.
def _simplify(ring, tolerance):
    """Douglas–Peucker on a closed loop of [r, t] mm, keeping its first point."""
    def keep(pts):
        a, b = pts[0], pts[-1]
        dx, dy = b[0] - a[0], b[1] - a[1]
        n = math.hypot(dx, dy) or 1
        far, at = 0, 0
        for i, p in enumerate(pts[1:-1], 1):
            d = abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / n
            if d > far:
                far, at = d, i
        return keep(pts[:at + 1])[:-1] + keep(pts[at:]) if far > tolerance else [a, b]
    loop = ring + [ring[0]]
    mid = max(range(len(loop)), key=lambda i: math.hypot(loop[i][0] - ring[0][0], loop[i][1] - ring[0][1]))
    return keep(loop[:mid + 1])[:-1] + keep(loop[mid:])[:-1]


def rose_cells(mpc, cells, petal, cell_order, tolerance=5.0):
    rings = dict((c['cell'], _simplify(c['ring'], tolerance)) for c in cells)
    a = math.radians(petal['angle_deg'])
    out = []
    for cell in cell_order:
        loop = []
        for r, t in rings[cell]:
            x_mm, y_mm = r * math.sin(a) + t * math.cos(a), r * math.cos(a) - t * math.sin(a)
            loop += [r3(mpc.WINDOW_DEPTH_M), r3(mpc.WINDOW_CENTRE_Y_M + y_mm / 1000.0),
                     r3(mpc.WINDOW_CENTRE_Z_M + x_mm / 1000.0)]
        out.append(loop)
    return out
