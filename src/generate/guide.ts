// The text the generators work from: how pattern code is written (the pattern guide, whole for the Fleet worker's
// brief; its API part for extensions), how a look is composed from the library, show taste, the globals, and the
// composition examples. Static: the same bytes on every call, so the prompt caches.

import { LIMITS } from '../../shared/schemas/generated.ts';
import { PALETTE_NAMES } from '../../shared/schemas/look.ts';

const CODE_INTRO = `A pattern is a plain script (not a module: no import/export). It defines \`pixel\`, and
optionally \`params\` and \`frame\`. Everything in the stdlib below is in scope as globals.

\`\`\`js
// Rising bands: bands of colour move up the layer.
const params = {
  speed: { value: 0.4, min: 0, max: 2, label: 'Speed' },
  colours: { value: 'all', type: 'color', label: 'Colours' },
};

function frame(t, P) {}            // optional: once per frame, before pixel()

function pixel(p, t, P) {          // every LED, every frame
  const x = p.ly * 3 - clock('speed'), c = swatch('colours', floor(x));
  c[3] = pulse(fract(x), 0.2);     // [r, g, b], each 0..1, and an optional alpha: how much it covers
  return c;
}
\`\`\`

\`t\` is seconds. \`P\` holds each param's current value (\`color\` params arrive as [r,g,b]).
Param kinds: number \`{ value, min, max, step? }\`, \`{ value: bool, type: 'toggle' }\`,
\`{ value: pick, type: 'color', blend? }\`, \`{ value: 'a', type: 'choice', options: ['a', 'b'] }\`. People tweak
params with sliders, so expose the few that matter (speed, colours, scale, density) with sensible ranges.

Every source has one colour param, \`colours: { value: 'all', type: 'color', label: 'Colours' }\`, and draws only
from it. Its value is a pick of the look's palette, which people choose: 'all' (the palette, low to high), a role
('body', 'accent'), a slot ('accent2'), 'rainbow' or '#rrggbb', joined by spaces in order or dealt in turn with /.
Code never names roles: it maps what it draws onto positions in the pick. swatch('colours', i) for bands and seeded
objects (the i-th colour, wrapping); pal('colours', t) for a gradient or a tail (t 0..1, first colour to last);
pal('colours', 1), the last, for a head, crest or heart; P.colours for one colour at a time. Blend is 'step'
(default: distinct colours) or 'smooth' (a ramp): declare \`blend: 'smooth'\` when the idea is a gradient.`;

/** The pixel, the stdlib and the rules for code: what an extension needs. */
export const PIXEL_API = `The pixel \`p\`:
- \`x y z\`: 0..1 across the whole installation (depth, height, left→right); \`X Y Z\`: metres
- \`lx ly lz\`: 0..1 across the pixels this layer targets (so a pattern fills what it lands on)
- \`a r\`: angle 0..1 (clockwise from 12 o'clock, seen from the front) and radius 0..1, in the
  façade (z–y) plane round the centre of this layer's pixels
- \`u i n\`: position 0..1 along its fixture, index along it, fixture length
- \`zone zi fixture\`: zone name, zone index, fixture index
- \`ring sector\`: ring and sector where the installation has them (a rose window's ring and petal), else 0 / −1;
  \`attr(name)\`: any other per-pixel number it defines
- \`is(tag)\`: true on pixels in a group with that tag (the tags are listed with the groups)
- \`part(tag) parts(tag)\`: which of \`tag\`'s parts holds the pixel (0 up, −1 none) and how many: the groups tagged
  \`tag\`, or when only one is, its smallest groups (each arch of the arches), in the installation's order
- \`k seed\`: global index; a stable random 0..1 per LED

Stdlib (globals): PI TAU sin cos tan asin acos atan atan2 abs min max floor ceil round sqrt pow
exp log hypot sign, clamp(v, lo=0, hi=1), fract(x), mix(a, b, t) (numbers or colours),
step(edge, x), smoothstep(e0, e1, x), soft(edge, x, width) (an anti-aliased step: 0 → 1 smoothly over width
round edge; use it for edges, never a bare comparison), band(x, centre, halfWidth, softness) (1 within halfWidth of
centre, edges soft), wave(x) = ½+½·sin(2πx), tri(x), saw(x),
pulse(x, width) (1 near 0 falling to 0 at ±width, wrapping), hash(n) and rand(a, b?, c?)
(stable 0..1), noise(x, y?, z?, w?) (smooth 0..1), fbm(x, y, z, octaves=4), hsv(h, s, v),
hsl(h, s, l), rgb(r, g, b), hex('#rrggbb'), scale(c, k), add(c1, c2),
gradient(t, [c0, c1, ...]), cosPalette(t, a, b, c, d) (Inigo Quilez), beat(t, bpm) (phase 0..1),
dist(x1,y1,z1,x2,y2,z2), pal(name, t) (t 0..1 along colour param name's pick), swatch(name, i) (its i-th colour,
wrapping: bands, seeded objects), palette(t) (the palette's colours, low to high), centres(tag) ([X, Y, Z] of each
group with that tag, [] if none: call it inside pixel or frame),
extent() (this layer's bounds in metres, [[X0, Y0, Z0], [X1, Y1, Z1]]: to place a centre in it, measure in metres,
fill it), clock(name) (how far number param name, a speed, has moved things: draw motion from clock('speed'), not
t × P.speed, so a modulated speed never jumps), DIRECTIONS and toward(p, direction) (a source that rises, falls or
sweeps declares direction: { value: 'up', type: 'choice', options: DIRECTIONS } and reads toward(p, P.direction),
0..1 along it: up down right left back front out in round along), use(name, params?) (a library pattern as a
function (p, t) → colour; call it at the top level). Colours are [r, g, b] arrays, 0..1.

Rules for code:
- pixel() runs ~195,000 times a second: keep it cheap, no big allocations per call; put
  per-frame work (particles, state, cellular automata) in frame() and top-level variables.
- No network, DOM, timers, imports, eval or Math.random: use rand/hash/noise/seed so a look
  is the same every time it plays. Return finite numbers only.
- A layer that throws or returns NaN goes black for that frame.`;

const CHAIN_GUIDE =
  `A look is a stack of up to ${LIMITS.layers} layers, composited bottom (first) to top. Each layer runs
one pattern on a union of groups. Blend: \`add\` sums light (default), \`over\` replaces where
the layer has alpha × level, \`max\` keeps the brighter channel, \`multiply\` tints what is below.
\`level\` is 0..1.

Instead of one pattern, a layer may be a chain of modules, listed top to bottom. One rule: each module works on
everything above it, as in an image editor.
- \`source\`: \`function pixel(p, t, P, G)\` draws, as above, onto what is above it: the first \`over\`, later ones
  \`add\` (or their own \`blend\`; \`under\` draws it beneath what is above). \`as: "input"\` hides it: it only
  feeds filters.
- \`filter\`: \`function filter(c, q, t, P, G, x)\` reworks everything above it, c = [r, g, b, a] (change it and
  return it); x is the colour of the source its \`input\` names (an earlier module's id).
- \`warp\`: \`function warp(q, t, P, G)\` bends everything above it: it changes q (a copy of p: lx ly lz a r u i …)
  for the modules above it. So a warp goes after what it bends. A blur or trails holds real LED colours (its code
  declares \`const stage = 'spatial'\` or \`'history'\`): a warp below one does not reach above it.
So "a chase only inside clouds, mirrored" is [source single-strand, source clouds as input, filter mask with input =
the clouds' id, warp mirror]. A module with a \`ref\` names the library entry it copies; still give its code. A preset
is such a chain, ready made: copy its modules, each with its library entry's code.
A source draws only what it is, on transparent: alpha is how much it covers, null where it draws nothing; it paints
no background. A bed fills: colour-wash, first in the chain with the element after it \`blend: "over"\` (or after a
filter that should rework the element alone, \`blend: "under"\`).
\`G\` holds the look's globals: G.energy (0..1, calm → busy), G.bpm (the look's tempo), the palette, and each macro by
name. A library source never reads G.energy: to make something busier with energy, bind its param in the layer,
\`"density": { "mod": "global", "name": "energy", "from": 0.3, "to": 1 }\` (or to an LFO,
\`{ "mod": "lfo", "rate": 0.2 }\`).`;

export const PATTERN_GUIDE = `${CODE_INTRO}\n\n${PIXEL_API}\n\n${CHAIN_GUIDE}`;

export const TASTE = `- Colour at full strength. A palette sets hue, not brightness: saturated colours at full value.
  Warm colours at half brightness read as brown and olive.
- Darkness is punctuation. Movement comes from colour moving, not LEDs going out: a sweep
  leaves no gaps, a pulse swells rather than dipping to black. Nothing is dimmed unless asked.
- A pattern fills what it lands on: work in lx/ly/lz, a/r and u, so the pattern spans its
  own groups.
- Every LED has a look. Parts that belong together share one; give the whole installation a
  base (a colour-wash bed, or a layer below) unless the idea wants darkness.
- Colours come from the palette: each source's one \`colours\` param, read by position. To colour a layer, set its
  pick in params (\`"colours": "accent2 accent3"\`); a hex only when the idea names a colour.
- Safety: no large-area flashing, strobing or colour cycling faster than about 3 Hz.`;

export const GLOBALS_GUIDE = `A look may set globals: speed (0..4, 1), level (0..1), hue (−0.5..0.5 turns), saturation
(0..2, 1), energy (0..1, 0.5), palette (one of ${PALETTE_NAMES.join(', ')}: picks, pal() and palette() read it,
so a look in palette colours follows the one picked), and macros [{ name, value, min, max }] that
patterns read as G.<name>. automation [{ name, points: [[seconds, value], …] }] moves a global or macro over
time, linearly between points: energy that builds from 0.2 to 1 over a minute, a storm macro that rises.`;

export const COMPOSE_GUIDE = `A look is a stack of 1 to ${LIMITS.layers} layers, composited bottom (first) to top,
each on a union of groups. Blend: \`add\` sums light, \`over\` covers what is below where the layer draws,
\`max\` keeps the brighter, \`multiply\` tints. \`level\` is 0..1, usually 1.

Compose each layer from the library below, by name; the studio fills in the code. A layer is either
- \`preset\`: a ready recipe, by name, with \`overrides\` [{ module, name, value }] for any of its modules' params
  (module: the module's name, \`bars#2\` for its second bars); or
- \`modules\`: a chain, listed top to bottom, each { use: "<module>", params: [{ name, value }] }, giving only the
  params you change from their defaults (each module's docs give its params' ranges and defaults).

One rule: each module works on everything above it, as in an image editor.
- A source draws its element on transparent, onto what is above it: the first covers, later ones add (or give a
  \`blend\`: over, add, max, multiply, under). A source with \`as: "input"\` draws nothing itself: it feeds the filter
  whose \`input\` is its \`id\` (clouds as input, then mask with input = its id: what is above shows only in clouds).
- A filter reworks everything above it; a warp bends everything above it, so a warp goes after what it bends.
- A bed fills: colour-wash first in the chain, then the element with \`blend: "over"\`; or a colour-wash layer below.
  A bed under an element stays dim (its layer's level 0.15–0.35, or brightness 0.2–0.4), so the element reads.

Values: numbers within the listed range; on/off; a choice by its word (a direction is one of up down right left
back front out in round along: \`out\` and \`round\` go from and round the layer's centre, \`along\` runs along
each wire). A colour (\`pick\`) is a pick of the look's palette: \`all\` (low to high), a role (\`low\` \`body\`
\`accent\` \`high\`), a slot (\`accent2\`), \`rainbow\` or \`#rrggbb\`, joined by spaces in order or dealt in turn
with / (\`"accent high"\`, \`"body/accent"\`). Any number param may instead be bound: \`{ "mod": "lfo", "rate": 0.2,
"shape": "sine", "center": 0.5, "depth": 0.5 }\` (Hz, or \`"unit": "beats"\`), \`{ "mod": "global", "name": "energy",
"from": 0.2, "to": 1 }\` (or a macro's name), or \`{ "mod": "envelope", "from": 0, "to": 1 }\` (the clip's fade).

Choose in this order: a preset that is the idea; else a chain of modules (a bed, the element, a warp or filter to
shape it; a preset's recipe is a good start); place it with groups. Only when nothing in the library can draw the
idea, write an extension: { name, kind, summary, why, code }, \`why\` naming the modules you tried and what they lack,
used as { use: "ext:<name>" } like any module (see Extensions). Most looks need none.`;

type Example = { idea: string, uses: string[], places?: string[],
  look: (root: string, place: (tag: string) => string) => object };
const v = (name: string, value: unknown) => ({ name, value });
/** Worked compositions; each is shown only when the library has every name it uses and the rig every tag it places
 * on. */
export const EXAMPLES: Example[] = [
  { idea: 'gentle rain over the whole cathedral, heavier as the night builds', uses: ['rain', 'streaks'],
    look: (root) => ({ title: 'Night rain', summary: 'Rain falls over the whole building, heavier as energy builds.',
      duration: 60, globals: { palette: 'vapour', energy: 0.3 }, automation: [{ name: 'energy', points: [[0, 0.3],
        [60, 0.9]] }],
      layers: [{ title: 'Rain', groups: [root], blend: 'add', level: 1, preset: 'rain',
        overrides: [{ module: 'streaks', name: 'speed', value: 0.7 }] }] }) },
  { idea: 'a comet circling the rose window over a dark bed', uses: ['colour-wash', 'bars'], places: ['rose'],
    look: (root, place) => ({ title: 'Rose comet', summary: 'A comet runs round the rose window over a deep bed.',
      layers: [
        { title: 'Bed', groups: [root], blend: 'add', level: 0.25,
          modules: [{ use: 'colour-wash', params: [v('colours', 'low'), v('speed', 0)] }] },
        { title: 'Comet', groups: [place('rose')], blend: 'over', level: 1, modules: [{ use: 'bars', params: [
          v('colours', 'accent high'), v('direction', 'round'), v('bars', 1), v('profile', 'comet'),
          v('speed', { mod: 'global', name: 'energy', from: 0.15, to: 0.6 })] }] }] }) },
  { idea: 'lightning only inside drifting storm clouds on the spires', uses: ['lightning', 'clouds', 'mask'],
    places: ['spire'],
    look: (root, place) => ({ title: 'Spire storm', summary: 'Bolts strike only where clouds drift over the spires.',
      layers: [{ title: 'Storm', groups: [place('spire')], blend: 'add', level: 1, modules: [
        { use: 'lightning', params: [v('colours', 'accent high')] },
        { use: 'clouds', id: 'sky', as: 'input', params: [v('cover', 0.6)] },
        { use: 'mask', input: 'sky' }] }] }) },
];
