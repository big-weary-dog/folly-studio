// Bars: bands of colour move in Direction. Circular counts round whole so they meet without a seam.
// Step has soft edges, smooth blends colours, pulse has bright middles and comet has bright fronts.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours',
    help: 'Which palette colours the bars, one colour a bar, in turn.' },
  direction: { value: 'up', type: 'choice', label: 'Direction',
    options: ['up', 'down', 'right', 'left', 'back', 'front', 'out', 'in', 'clockwise', 'counterclockwise',
      'orbit-clockwise', 'orbit-counterclockwise', 'along'],
    help: 'Which way they move. Clockwise and counterclockwise as seen from the front; orbit\'s, from above.' },
  speed: { value: 0.4, min: -2, max: 2, step: 0.01, label: 'Speed (bars a second)',
    help: 'How fast the bars move in Direction. Negative runs them the other way; 0 holds them still.' },
  bars: { value: 4, min: 0.25, max: 16, step: 0.25, label: 'Bars across the layer',
    help: 'Few gives broad bands; many gives thin stripes. Circular directions round to whole bars, at least one.' },
  duty: { value: 1, min: 0.05, max: 1, step: 0.01, label: 'Duty (lit share of each bar)',
    showWhen: { profile: ['step', 'pulse', 'comet'] },
    help: 'How much of each bar lights, the rest clear. 1 fills edge to edge; low leaves slivers with wide gaps.' },
  profile: { value: 'step', type: 'choice', options: ['step', 'smooth', 'pulse', 'comet'], label: 'Profile',
    help: 'step: flat bands; smooth: each blends into the next; pulse: bright middles; comet: bright fronts.' },
  softness: { value: 0.2, min: 0, max: 1, step: 0.01, label: 'Edge softness (step only; share of a bar)',
    showWhen: { profile: ['step'] },
    help: 'How blurred step edges are, up to Duty. 0 is a hard cut; values above Duty give the same softness.' },
};

// Saved before both ways were named: round was clockwise; orbit, at a positive speed, counterclockwise from above.
function upgrade(s) {
  if (s.direction === 'round') s.direction = 'clockwise';
  if (s.direction === 'orbit') s.direction = 'orbit-counterclockwise';
  return s;
}

function pixel(p, t, P) {
  const dir = P.direction, orbit = dir.startsWith('orbit'), turns = orbit || dir.endsWith('clockwise');
  const d = P.duty, s = min(P.softness, d), n = turns ? max(1, round(P.bars)) : P.bars;
  // Orbit: the angle round the upright axis in metres, 0 toward the front, counterclockwise from above; a layer with
  // no depth turns in its face.
  const a = orbit && p.sx > 0 ? fract(atan2(p.Z - p.oz, p.ox - p.X) / TAU) : toward(p, turns ? 'clockwise' : dir);
  const back = dir === 'counterclockwise' || dir === 'orbit-clockwise';
  const f = (back ? -a : a) * n - clock('speed'), prof = P.profile;
  if (prof === 'smooth') {
    const b = floor(f);
    return mix(swatch('colours', b), swatch('colours', b + 1), smoothstep(0, 1, f - b));
  }
  if (prof === 'pulse' || prof === 'comet') {
    // Lit over the first Duty of each bar: a pulse peaks in its middle, a comet at its front (the way it moves).
    const b = floor(f), u = f - b;
    if (u >= d) return null;
    const x = u / d, front = P.speed < 0 ? 1 - x : x, c = swatch('colours', b);
    c[3] = prof === 'pulse' ? smoothstep(0, 1, 1 - abs(2 * x - 1)) : front * front;
    return c;
  }
  if (d < 1) {                               // step, lit over Duty of each bar round its middle, the rest clear
    const g = f - d / 2, k = round(g), c = swatch('colours', k);
    c[3] = band(g - k, 0, d / 2, s);
    return c;
  }
  const e = round(f);                        // step, edge to edge: e the nearest edge, bar e − 1 below it, e above
  return mix(swatch('colours', e - 1), swatch('colours', e), soft(e, f, s));
}
