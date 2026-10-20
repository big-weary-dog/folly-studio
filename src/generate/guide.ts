// The text the generators work from: how pattern code is written (the pattern guide, whole for the Fleet worker's
// brief; with how an extension is declared, library/extensions.md), how a look is composed from the library, show
// taste, the globals and time, and the composition examples. The same bytes for a rig on every call, so they cache.

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

/** The pixel, the stdlib and the rules for code: what an extension needs. `perSecond`: LEDs × fps on the rig. */
export const pixelApi = (perSecond = 0) => `The pixel \`p\`:
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
0..1 along it: up down right left back front out in clockwise counterclockwise along petal ring (clockwise as seen
from the front); petal and ring step pane by pane on
the rose), region(q, rule, size?, seed?) and regions(rule, size?) (q's rose pane group, −1 off the rose, and how
many: rules petal alternate ring rings centre spiral wedges checker random), past(ago) (in a filter that declares
const stage = 'history' and const history = <seconds, up to 8>: what was above it at this LED ago seconds back, the
frames the core keeps for it), use(name, params?) (a library pattern as a
function (p, t) → colour; call it at the top level). Colours are [r, g, b] arrays, 0..1.

Rules for code:
- pixel() runs for every LED, every frame${perSecond ? ` (about ${(Math.round(perSecond / 1000) * 1000)
    .toLocaleString('en')} times a second here)` : ''}: keep it cheap, no big allocations per call; put
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
  for the modules above it. So a warp goes after what it bends. A blur, trails, delay, smoke, replay, sort or splash
  holds real LED colours (its code declares \`const stage = 'spatial'\` or \`'history'\`): a warp below one does not
  reach above it.
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

/** The whole pattern guide, for a brief that writes code (the Fleet worker's). */
export const patternGuide = (perSecond = 0) => `${CODE_INTRO}\n\n${pixelApi(perSecond)}\n\n${CHAIN_GUIDE}`;

/** library/extensions.md: how an extension is written, read only when a look needs one. */
export const extensionsPage = (perSecond = 0) => `# Extensions

An extension is a last resort: code you write when nothing in the library draws the idea. Declare it in the look's
\`extensions\` as { name, kind, summary, why, code }, \`why\` naming the modules you tried and what they lack, and use
it in a chain as { "use": "ext:<name>" } like any module.

Its code is a plain script (no import/export) defining its kind's function: a source \`function pixel(p, t, P, G)\`
returning [r, g, b, alpha] (0..1) or null where it draws nothing; a filter \`function filter(c, q, t, P, G, x)\`
reworking c = [r, g, b, a] (x: its input's colour); a warp \`function warp(q, t, P, G)\` changing q, a copy of the
pixel. Params: \`const params = { speed: { value: 0.4, min: 0, max: 2 }, colours: { value: 'all', type: 'color' } }\`,
read as P.speed; a source draws only from its one \`colours\` param, with swatch('colours', i) or pal('colours', t);
motion from clock('speed'). A pattern fills what it lands on: work in lx/ly/lz, a/r and u, so it spans its own
groups.

${pixelApi(perSecond)}
`;

export const TASTE = `- Saturated colours at full value: a palette sets hue, not brightness (half-bright warm reads as
  brown). Dim only a bed.
- Darkness is punctuation: colour moves, LEDs never go out. A sweep leaves no gaps, a pulse swells rather than
  dipping to black, an element is mostly lit. A dim or mostly dark look reads as broken.
- Put the idea where it says. Every other part gets a calm voice of its own, or the bed: every LED has a look.
- Motion the idea names (climbing, chasing, breathing) comes from a module that moves that way.
- Sparse places (spire strands, the rose's cells) alias: soft edges, fewer and wider features.
- Safety: no large-area flashing, strobing or colour cycling faster than about 3 Hz.`;

export const GLOBALS_GUIDE = `\`globals\`: palette (${PALETTE_NAMES.length} below, by name), speed (0..4, 1), level,
hue (−0.5..0.5 turns), saturation (0..2, 1), energy (0..1, 0.5), macros [{ name, value, min, max, mod? }]. \`bpm\`
(40–240, 120) sits beside globals. \`automation\` [{ name, points: [[seconds, value], …] }] moves a global or macro
linearly: energy 0.2 → 1 over a minute is a build. A macro is one dial for many params: bind them to it (a storm macro
dims the bed while bolts quicken). A macro with a \`mod\` (an LFO) is a modulator: all bound to it move in step. Give
one min 0, max 1, center 0.5, depth 0.5; its pace and amount name a fader (a global or a plain macro), never a
modulator. One modulator, not the same LFO repeated.
\`duration\` (seconds, 30 unless set, at most ${LIMITS.duration}) loops. For a progression ("calm, a storm, embers")
set it (30–120) and give the layers that come and go \`clips\` [{ start, end, fadeIn, fadeOut }], not overlapping,
with fades of a few seconds; the bed has none, so the rig never goes dark between sections.`;

export const COMPOSE_GUIDE = `A look is 1 to ${LIMITS.layers} layers, composited bottom (first) to top, each on a
union of groups. Layer blend: \`add\` sums light, \`over\` covers what is below where the layer draws, \`max\` keeps
the brighter, \`multiply\` tints. \`level\` is 0..1, usually 1.

A layer is a \`preset\` (a ready chain by name, with \`overrides\` [{ module, name, value }]; \`bars#2\` is its second
bars) or \`modules\`: a chain of up to ${LIMITS.modules}, listed top to bottom, each { use, params: [{ name, value }] }
giving only the params you change.

One rule: each module works on everything above it, as in an image editor.
- A source draws its element on transparent onto what is above it: the first covers, later ones add (or take a
  \`blend\`: over, add, max, multiply, under). With an \`id\` and \`as: "input"\` it draws nothing and feeds the filter
  whose \`input\` names it (clouds as input, then mask: what is above shows only in the clouds).
- A filter reworks everything above it. A warp bends everything above it, so it goes below what it bends; anchor
  lowest of the warps. blur, trails, delay, smoke, replay, sort and splash hold real colours: a warp below one does
  not reach above it.
- A bed is a dim colour-wash (level 0.15–0.35, or brightness 0.2–0.4) so the element reads: a layer on the root, or,
  when each part has a layer of its own, first in that part's chain with the element after it \`blend: "over"\`.
- A new layer when a part goes on other places, plays in another clip or needs its own level; another module when
  it works on the same place.

Values: a number within its range; on/off; a choice by its word. \`out\` and \`in\` run from and to the layer's
centre (or the anchor's), \`clockwise\` and \`counterclockwise\` round it seen from the front, \`along\` each wire. A
colour pick: \`all\`, a role (\`low\` \`body\` \`accent\` \`high\`), a slot (\`accent2\`), \`rainbow\` or \`#rrggbb\`
(only for a colour the idea names); joined by spaces in order, or with / dealt in turn. A source reads its pick by
position: bands in turn, a gradient first to last, a head or crest the last.
Any number param may be bound instead:
- \`{ "mod": "lfo", "rate": 0.2, "shape": "sine", "center": 0.5, "depth": 0.5 }\`: Hz, or with \`"unit": "beats"\`
  cycles a beat (0.25: once a bar); shape \`hold\` steps; \`"pace"\` and \`"amount"\` name a fader that quickens it
  or scales its swing.
- \`{ "mod": "global", "name": "energy", "from": 0.2, "to": 1 }\`: follows a global, macro or modulator. Library
  sources never read energy: bind their density, speed or brightness to it to build.
- on a speed, \`{ "mod": "beats", "per": 0.5 }\`: per × the beats a second, in time with the beat.
A layer's level cannot be bound: bind a source's brightness.

Choose a preset that is the idea; else a chain (a bed, the element, a warp or filter to shape it; a preset's recipe
is a good start); place it with groups. An extension only when nothing in the library can draw it.`;

type Example = { idea: string, uses: string[], places?: string[],
  look: (root: string, place: (tag: string) => string) => object };
const v = (name: string, value: unknown) => ({ name, value });
/** Worked compositions; each is shown only when the library has every name it uses and the rig every tag it places
 * on. */
export const EXAMPLES: Example[] = [
  { idea: 'a comet circling the rose window over a dark bed', uses: ['colour-wash', 'bars'], places: ['rose'],
    look: (root, place) => ({ title: 'Rose comet', summary: 'A comet runs round the rose window over a deep bed.',
      layers: [
        { title: 'Bed', groups: [root], blend: 'add', level: 0.25,
          modules: [{ use: 'colour-wash', params: [v('colours', 'low'), v('speed', 0)] }] },
        { title: 'Comet', groups: [place('rose')], blend: 'over', level: 1, modules: [{ use: 'bars', params: [
          v('colours', 'accent high'), v('direction', 'clockwise'), v('bars', 1), v('profile', 'comet'),
          v('speed', { mod: 'global', name: 'energy', from: 0.15, to: 0.6 })] }] }] }) },
  { idea: 'lightning only inside drifting storm clouds on the spires', uses: ['lightning', 'clouds', 'mask'],
    places: ['spire'],
    look: (root, place) => ({ title: 'Spire storm', summary: 'Bolts strike only where clouds drift over the spires.',
      layers: [{ title: 'Storm', groups: [place('spire')], blend: 'add', level: 1, modules: [
        { use: 'lightning', params: [v('colours', 'accent high')] },
        { use: 'clouds', id: 'sky', as: 'input', params: [v('cover', 0.6)] },
        { use: 'mask', input: 'sky' }] }] }) },
  { idea: 'a storm that gathers: the sky darkens as bolts on the spires come faster, rain arriving at 20 s',
    uses: ['colour-wash', 'lightning', 'streaks'], places: ['spire'],
    look: (root, place) => ({ title: 'Gathering storm',
      summary: 'One storm macro darkens the sky and quickens the bolts.',
      duration: 60, globals: { macros: [{ name: 'storm', value: 0.2, min: 0, max: 1 }] },
      automation: [{ name: 'storm', points: [[0, 0.2], [40, 1], [60, 1]] }],
      layers: [
        { title: 'Sky', groups: [root], blend: 'add', level: 0.3, modules: [{ use: 'colour-wash', params: [
          v('colours', 'low'), v('brightness', { mod: 'global', name: 'storm', from: 0.5, to: 0.2 })] }] },
        { title: 'Rain', groups: [root], blend: 'add', level: 0.6,
          clips: [{ start: 20, end: 60, fadeIn: 6, fadeOut: 2 }],
          modules: [{ use: 'streaks', params: [v('colours', 'body')] }] },
        { title: 'Bolts', groups: [place('spire')], blend: 'add', level: 1, modules: [{ use: 'lightning', params: [
          v('colours', 'accent high'), v('speed', { mod: 'global', name: 'storm', from: 0.1, to: 0.8 })] }] }] }) },
  { idea: 'a procession through the arches over a breathing bed', uses: ['colour-wash', 'bars', 'in-turn'],
    places: ['arch'],
    look: (root, place) => ({ title: 'Arch procession', summary: 'Each arch fills along its wire in turn.',
      layers: [
        { title: 'Bed', groups: [root], blend: 'add', level: 1, modules: [{ use: 'colour-wash', params: [
          v('colours', 'low'),
          v('brightness', { mod: 'lfo', rate: 0.05, shape: 'sine', center: 0.3, depth: 0.1 })] }] },
        { title: 'Procession', groups: [place('arch')], blend: 'over', level: 1, modules: [
          { use: 'bars', params: [v('colours', 'body accent'), v('direction', 'along'), v('profile', 'smooth'),
            v('speed', 0)] },
          { use: 'in-turn', params: [v('tag', 'arch'), v('every', 0.8), v('gate', 'wipe'), v('direction', 'along'),
            v('release', 2)] }] }] }) },
  { idea: 'everything breathes together, slowly speeding up as the storm builds', uses: ['colour-wash', 'clouds'],
    look: (root) => ({ title: 'Storm breath', summary: 'One quickening breath swells sky and clouds.',
      duration: 60, bpm: 90, globals: { macros: [{ name: 'storm', value: 0.5, min: 0.5, max: 3 },
        { name: 'breath', value: 0.5, min: 0, max: 1, mod: { mod: 'lfo', shape: 'sine', rate: 0.25, unit: 'beats',
          center: 0.5, depth: 0.5, pace: 'storm' } }] },
      automation: [{ name: 'storm', points: [[0, 0.5], [60, 3]] }],
      layers: [
        { title: 'Sky', groups: [root], blend: 'add', level: 1, modules: [{ use: 'colour-wash', params: [
          v('colours', 'low'), v('brightness', { mod: 'global', name: 'breath', from: 0.2, to: 0.5 })] }] },
        { title: 'Clouds', groups: [root], blend: 'add', level: 0.8, modules: [{ use: 'clouds', params: [
          v('cover', { mod: 'global', name: 'breath', from: 0.3, to: 0.8 })] }] }] }) },
];
