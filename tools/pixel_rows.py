"""A row per LED of a pixel-map folder, in show-builder td/python/make_pixel_csv.py's order and arithmetic (its
all-pixels-positions.csv, which TouchDesigner, Mirage and the relay read): zone, pixel id, universe and channel, place
in metres (x depth, y height, z width), that place from 0 to 1 across all the LEDs, and row (the rose's ring).

A chain's LEDs run on from its first address, three channels each, into the next universe when one fills; that is
how lighting's xLights models address them. The rose window is 16 petals of 14 cells, one RGB pixel each, addressed
as universe-map.json says. pixel-map places every cell within the window, but not the window within the cathedral,
so that is copied from cathedral-3d-sim.html. Used by tools/build_rig.py.
"""
import glob
import json
import math
import os

# cathedral-3d-sim.html's buildRoseWindow(): the window's plane and centre. Its +x,
# the viewer's right facing it from the playa, is +z in the cathedral.
WINDOW_DEPTH_M, WINDOW_CENTRE_Y_M, WINDOW_CENTRE_Z_M = -8.567, 5.936, -0.443
ROSE_FILES = ('universe-map.json', 'cell-polygons.json', 'window-data.json')


def read(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def sources(pixel_map):
    """Every file of LED positions, with the zone it becomes, in the rows' order."""
    found = [('main-arch', 'arch-led-positions.json')]
    for prefix, zone in (('arch-led-positions-mini-', 'mini-arch-'),
                         ('arch-led-positions-quad-', 'quad-arch-'),
                         ('spire-led-positions-', 'spire-')):
        for path in sorted(glob.glob(os.path.join(pixel_map, prefix + '*.json'))):
            name = os.path.basename(path)
            found.append((zone + name[len(prefix):-len('.json')], name))
    return found + [('spirelet', 'spires-corners-led-positions.json'),
                    ('canopy', 'canopy-led-positions.json'),
                    ('wash', 'wash-led-positions.json')]


def chain(zone, start, places, channels, rows=None):
    """(zone, universe, channel, place, row) for a chain of pixels from its first
    address, running on into the next universe when one fills."""
    for i, place in enumerate(places):
        offset = ((start['universe'] - 1) * channels
                  + start['universe_start_channel'] - 1 + 3 * i)
        yield (zone, offset // channels + 1, offset % channels + 1,
               place, rows[i] if rows else '')


def chains(zone, data, channels):
    """Every chain in a pixel-map file. Arches and quad faces give places in their
    own plane."""
    for arch in data.get('arches', []):
        yield from chain(zone, arch, [(arch['x_position_m'], y, z)
                                      for z, y in arch['pixel_positions']], channels)
    for face in data.get('faces', []):
        at, along_z = face['fixed_axis_pos_m'], face['span_axis'] == 'z'
        yield from chain(zone, face, [(at, y, a) if along_z else (a, y, at)
                                      for a, y in face['pixel_positions']], channels)
    for strand in data.get('strands', []) + data.get('runs', []):
        yield from chain(zone, strand, strand['pixel_positions'], channels)
    for pixel in data.get('pixels', []):
        yield from chain(zone, pixel, [pixel['position']], channels)


def rose_spec(pixel_map, universe_map):
    """The rose window's zone in universe-map.json: pixel-map's own, else `universe_map`'s."""
    own = os.path.join(pixel_map, 'universe-map.json')
    return read(own if os.path.exists(own) else universe_map)['zones']['rose_window']


def rose(pixel_map, channels, universe_map):
    """The rose window's cells: each at its centroid, turned to its petal's angle."""
    spec = rose_spec(pixel_map, universe_map)
    order = spec['cell_order']
    petals_per_universe = spec['pixels_per_universe'] // len(order)
    centroids = dict((c['cell'], c['centroid'])
                     for c in read(os.path.join(pixel_map, 'cell-polygons.json'))['cells'])
    for petal in read(os.path.join(pixel_map, 'window-data.json'))['petals']:
        p, angle = petal['petal'], math.radians(petal['angle_deg'])
        places = []
        for cell in order:
            # r runs out from the centre, t across, both clockwise from twelve o'clock.
            r, t = centroids[cell]['r'], centroids[cell]['t']
            x_mm = r * math.sin(angle) + t * math.cos(angle)
            y_mm = r * math.cos(angle) - t * math.sin(angle)
            places.append((WINDOW_DEPTH_M, WINDOW_CENTRE_Y_M + y_mm / 1000.0,
                           WINDOW_CENTRE_Z_M + x_mm / 1000.0))
        start = {'universe': spec['universe_start'] + p // petals_per_universe,
                 'universe_start_channel': p % petals_per_universe * 3 * len(order) + 1}
        yield from chain('rose-petal-%02d' % (p + 1), start, places, channels,
                         [int(cell[0]) for cell in order])


def pixel_rows(pixel_map, channels, universe_map):
    """The rows, each place normalised across every LED. `universe_map`: the rose's, where pixel-map has none."""
    files = sources(pixel_map)
    unread = sorted(set(os.path.basename(p) for p in glob.glob(os.path.join(pixel_map, '*.json')))
                    - set(name for _, name in files) - set(ROSE_FILES))
    if unread:
        raise ValueError('pixel-map holds %s, which tools/pixel_rows.py does not read, so its '
                         'LEDs would stay dark' % ', '.join(unread))
    found = [led for zone, name in files for led in chains(zone, read(os.path.join(pixel_map, name)), channels)]
    found += rose(pixel_map, channels, universe_map)
    owner = {}
    for zone, universe, channel, _, _ in found:
        if (universe, channel) in owner:
            raise ValueError('universe %d channel %d is both %s and %s'
                             % (universe, channel, owner[(universe, channel)], zone))
        owner[(universe, channel)] = zone
    places = [[float('%.4f' % v) for v in place] for _, _, _, place, _ in found]
    low = [min(p[i] for p in places) for i in range(3)]
    high = [max(p[i] for p in places) for i in range(3)]
    return [[zone, pixel_id, universe, channel]
            + ['%.4f' % v for v in place]
            + ['%.4f' % ((v - low[i]) / (high[i] - low[i])) for i, v in enumerate(place)]
            + [row]
            for pixel_id, ((zone, universe, channel, _, row), place) in enumerate(zip(found, places))]
