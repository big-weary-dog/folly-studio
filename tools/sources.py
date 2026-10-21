"""Where the show's sources live: a show-builder checkout (td/, pixel-map/, city-of-gods/, mirage/, xlights/).

SHOW_BUILDER_DIR names it; by default it is show-builder/ beside this repo. test/fixtures/sources.js finds the same.
"""
import os

STUDIO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOW_BUILDER = os.path.abspath(os.environ.get('SHOW_BUILDER_DIR') or os.path.join(STUDIO, '..', 'show-builder'))

if not os.path.isdir(os.path.join(SHOW_BUILDER, 'td')):
    raise SystemExit('no show-builder checkout at %s: set SHOW_BUILDER_DIR' % SHOW_BUILDER)
