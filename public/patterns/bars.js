// Bars: bands of colour move in Direction, one colour each from Colours, in turn.
// Bars is how many fit across the layer (whole on Round, so the circle has no seam); Duty is the lit share of each,
// the rest left clear. Profile: step (flat, edges soft by Softness), smooth (each blends into the next), pulse
// (brightest in its middle) or comet (brightest at its front, fading behind).
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours' },
  direction: { value: 'up', type: 'choice', options: DIRECTIONS, label: 'Direction' },
  speed: { value: 0.4, min: -2, max: 2, step: 0.01, label: 'Speed (bars a second)' },
  bars: { value: 4, min: 0.25, max: 16, step: 0.25, label: 'Bars across the layer' },
  duty: { value: 1, min: 0.05, max: 1, step: 0.01, label: 'Duty (lit share of each bar)' },
  profile: { value: 'step', type: 'choice', options: ['step', 'smooth', 'pulse', 'comet'], label: 'Profile' },
  softness: { value: 0.2, min: 0, max: 1, step: 0.01, label: 'Edge softness (share of a bar)' },
};

function pixel(p, t, P) {
  const n = P.direction === 'round' ? max(1, round(P.bars)) : P.bars, d = P.duty, s = min(P.softness, d);
  const f = toward(p, P.direction) * n - clock('speed'), prof = P.profile;
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
