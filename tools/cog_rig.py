"""City of Gods 2026, the studio's default rig: what differs from the Folly's in tools/build_rig.py.

The condensed Folly at Industry City: the playa's rose and five main arches, one mini arch a side, and two front
towers, each a scaffold box (major arch 1 to arch 3, its top at arch 1's peak) carrying a spire, a three-face quad
and spirelets. The towers' fixtures came from the playa's back towers and keep their ids (the hardware is labelled
so); names say where they stand, and tags name only real places, so no `back`.
"""
import math
import os
import re

import rig_render
from sources import SHOW_BUILDER

PIXEL_MAP = os.path.join(SHOW_BUILDER, 'city-of-gods', 'pixel-map')
NAME = 'City of Gods 2026'
ABOUT = ('City of Gods is the Gothic Folly condensed for a night outdoors between two buildings: a portal of five '
         'main arches around a 16-petal rose window with 7 rings of cells, one mini arch each side, and two towers '
         'at the front, each a scaffold box carrying a spire of 8 globe strands, a quad arch on three faces and '
         'flood-lit spirelets (10 in all). No canopy and no ground wash.')
BOX_HEIGHT = 2.0  # each tower's box, metres down from its top corners
TARGET = [-10.0, 8.0, -0.4]  # the middle of what is built: arches 1–5, the towers, the spires' tips
VIEWS = {
    'front': {'Target': TARGET, 'Distance': 30, 'Angle': 25, 'Elevation': 12, 'Fov': 45, 'Eyelock': False},
    'playa': {'Target': [-10.0, 7.0, -0.4], 'Distance': 26, 'Angle': 0, 'Elevation': 0, 'Fov': 60, 'Eyelock': True},
    'side': {'Target': TARGET, 'Distance': 30, 'Angle': 90, 'Elevation': 5, 'Fov': 45, 'Eyelock': False},
    'rose': {'Target': [-8.6, 5.9, -0.4], 'Distance': 12, 'Angle': 0, 'Elevation': 0, 'Fov': 45, 'Eyelock': False},
    'spire': {'Target': [-11.1, 12.5, 4.5], 'Distance': 14, 'Angle': 40, 'Elevation': 8, 'Fov': 45, 'Eyelock': False},
    'top': {'Target': TARGET, 'Distance': 32, 'Angle': 0, 'Elevation': 89, 'Fov': 45, 'Eyelock': False},
}


def names(groups):
    """Groups (or fixtures) named for where they stand: 'Spire left (back-left)'."""
    for g in groups:
        g['name'] = re.sub(r'back-(?:top-)?(left|right)', lambda m: '%s (%s)' % (m.group(1), m.group(0)), g['name'])
    return groups


def boxes(spirelets):
    """Each tower's box [x0, x1, z0, z1, top], from the spirelets on its top corners."""
    out = []
    for side in ('BL', 'BR'):
        top = max(p['position'][1] for p in spirelets if p['label'].startswith(side))
        corners = [p['position'] for p in spirelets if p['label'].startswith(side) and p['position'][1] == top]
        xs, zs = [c[0] for c in corners], [c[2] for c in corners]
        out.append([min(xs), max(xs), min(zs), max(zs), top])
    return out


def structure(spirelets):
    """Each box as scaffold standing on the ground, ledgers as Mirage spaces them."""
    lines = []
    add = lambda a, b: lines.append([rig_render.r2(v) for v in a + b])
    for x0, x1, z0, z1, top in boxes(spirelets):
        levels = sorted(set(rig_render._levels(0, top - BOX_HEIGHT) + [top]))
        rig_render._frame(add, x0, x1, z0, z1, levels, lambda *_: False)
    return {'lines': lines, 'radius': rig_render.r3(rig_render.config('SCAFFOLD', 'tubeRadius')), 'ground': {'y': 0}}


def spirelet_cone(pixels):
    """A lit cone standing on its spirelet's pixel, drawn from its tip."""
    height = rig_render.config('FIXTURES.spirelet', 'height')
    radius = rig_render.config('FIXTURES.spirelet', 'radius')
    apex = [[rig_render.r3(x), rig_render.r3(y + height), rig_render.r3(z)] for x, y, z in
            (p['position'] for p in pixels)]
    return {'angle': rig_render.r3(2 * math.degrees(math.atan(radius / height))), 'length': height,
            'dir': [0, -1, 0], 'apex': apex, 'solid': True}
