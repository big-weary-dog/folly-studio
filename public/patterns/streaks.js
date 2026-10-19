// Streaks: lines of colour fall in Direction in lanes, each with a fading tail; Flake draws swaying dots instead.
// Colours run from the end of the tail (first) to the head (last). Lanes stack in Depth slots front to back.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth' },
  direction: { value: 'down', type: 'choice', options: DIRECTIONS, label: 'Direction' },
  angle: { value: 0, min: -0.25, max: 0.25, step: 0.01, label: 'Angle off Direction (turns)' },
  speed: { value: 0.6, min: 0, max: 3, step: 0.01, label: 'Speed (layers a second)' },
  lanes: { value: 40, min: 4, max: 120, step: 1, label: 'Lanes' },
  density: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Share of lanes in use' },
  tail: { value: 0.15, min: 0.005, max: 0.6, step: 0.005, label: 'Tail (share of the layer)' },
  depth: { value: 3, min: 1, max: 6, step: 1, label: 'Depth slots' },
  profile: { value: 'streak', type: 'choice', options: ['streak', 'flake'], label: 'Profile' },
  sway: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Sway (flakes)' },
};

// The coordinate across a direction: across for up, down, back and front; up for right and left; the angle for out
// and in; the radius for round; each strand its own lane along them.
const across = (p, d) => (d === 'right' || d === 'left' ? p.ly : d === 'out' || d === 'in' ? p.a
  : d === 'round' ? p.r : d === 'along' ? fract(p.fixture * 0.618) : p.lz);

function pixel(p, t, P) {
  const d = P.direction, w = TAU * P.angle, s = sin(w), c = cos(w), a0 = toward(p, d), b0 = across(p, d);
  const along = a0 * c + b0 * s, x = (b0 * c - a0 * s) * P.lanes, lane = floor(x);
  const deep = floor(p.lx * P.depth * 0.9999), run = clock('speed'), flake = P.profile === 'flake';
  let v = 0;
  for (let m = 0; m < 3; m++) {
    if (rand(lane, deep * 3 + m, 4) > P.density) continue;
    const head = fract(run * (0.6 + 0.8 * rand(lane, m, 1)) / 2.6 + rand(lane, m, 2)) * 2.6 - 1.3;
    const behind = head - along;
    if (flake) {
      const off = x - lane - 0.5 - P.sway * 0.4 * sin(TAU * (run * 0.5 + rand(lane, m, 3)));
      v = max(v, smoothstep(0.5, 0.15, hypot(behind * P.lanes, off)));
    } else if (behind > -0.01) {
      v = max(v, exp(-max(0, behind) / P.tail));
    }
  }
  if (v < 0.004) return null;
  const col = pal('colours', v);
  col[3] = v;
  return col;
}
