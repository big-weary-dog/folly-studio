"""Where the show's sources live: a lighting checkout (The-Gothic-Folly/lighting, read only) for the LEDs and their
channels, and tools/data/ for what is Studio's own (output, the Folly's views, Mirage's sizes, the palettes).

LIGHTING_DIR names the checkout; by default it is lighting/ beside this repo. test/fixtures/sources.js finds the same.
"""
import os

STUDIO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIGHTING = os.path.abspath(os.environ.get('LIGHTING_DIR') or os.path.join(STUDIO, '..', 'lighting'))
DATA = os.path.join(STUDIO, 'tools', 'data')


def lighting():
    """The checkout, or exit saying where it was looked for."""
    if not os.path.isdir(os.path.join(LIGHTING, 'city-of-gods')):
        raise SystemExit('no lighting checkout at %s: set LIGHTING_DIR' % LIGHTING)
    return LIGHTING
