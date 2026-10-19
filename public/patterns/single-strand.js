// Chase: bands of colour chase along every strand at Speed, one colour each from Colours, a Gap of each left clear.
// Mode: along, back and forth, out from each strand's middle, or in to it. Comet draws each band as a head (the last
// colour) with a tail fading back through the others. Lap leaves that many clear LEDs after each pass; Scatter gives
// each strand its own start and pace; Alternate runs every other strand the other way.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth' },
  speed: { value: 20, min: -150, max: 150, step: 1, label: 'Speed (LEDs a second)' },
  size: { value: 10, min: 1, max: 120, step: 1, label: 'LEDs per band' },
  gap: { value: 0.3, min: 0, max: 0.95, step: 0.01, label: 'Gap (share of each band)' },
  mode: { value: 'along', type: 'choice', options: ['along', 'bounce', 'out', 'in'], label: 'Mode' },
  profile: { value: 'bands', type: 'choice', options: ['bands', 'comet'], label: 'Profile' },
  tail: { value: 10, min: 1, max: 60, step: 1, label: 'Comet tail (LEDs)' },
  lap: { value: 0, min: 0, max: 300, step: 1, label: 'Lap (clear LEDs after each pass)' },
  scatter: { value: 0, min: 0, max: 1, step: 0.01, label: 'Scatter' },
  alternate: { value: false, type: 'toggle', label: 'Alternate strands' },
  softness: { value: 1.5, min: 0, max: 10, step: 0.1, label: 'Edge softness (LEDs)' },
};

function pixel(p, t, P) {
  const s = p.fixture, n = p.n, h = (n - 1) / 2, m = P.mode, sc = P.scatter;
  const i = P.alternate && s % 2 ? n - 1 - p.i : p.i;
  const x = m === 'out' ? abs(i - h) : m === 'in' ? h - abs(i - h) : i;
  const run = clock('speed') * (1 + sc * 0.6 * (rand(s, 3) - 0.5)) + sc * rand(s, 1) * (n + P.lap);
  let at = x - (m === 'bounce' ? tri(run / (2 * n)) * n : run);
  if (P.lap > 0 && m !== 'bounce') {                 // a pass (whole comets), then the lap clear
    const L = n + P.lap;
    at -= floor(at / L) * L;
    if (P.profile === 'comet' ? (floor(at / P.size) + 1) * P.size > max(n, P.size) : at >= n) return null;
  }
  const f = at / P.size;
  if (P.profile === 'comet') {
    // Each band's head at its front (the way it moves), its tail behind: the head the last colour.
    const b = floor(f), behind = (P.speed < 0 ? f - b : b + 1 - f) * P.size - 0.5;
    const v = exp(-max(0, behind) / P.tail) * soft(0, behind + 0.5, min(1, P.softness));
    if (v < 0.004) return null;
    const c = pal('colours', v);
    c[3] = v;
    return c;
  }
  // Band b: its first Gap clear, then its colour; g is half the gap, b the band whose clear part is nearest.
  const g = P.gap / 2, b = round(f - g), w = min(P.softness / P.size, 1 - P.gap);
  const c = mix(swatch('colours', b - 1), swatch('colours', b), soft(b + g, f, w));
  c[3] = 1 - band(f, b + g, g, w);
  return c;
}
