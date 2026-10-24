// Streaks: lines of colour fall in Direction in lanes, each with a fading tail; Flake draws swaying dots instead.
// Colours run from the end of the tail (first) to the head (last). Lanes stack in Depth slots front to back; flakes
// take four lanes each, so they read as flakes, not dots.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'Colours each streak along its length: the head takes the last colour, the tail fades back to the first.' },
  direction: { value: 'down', type: 'choice', options: ['up', 'down', 'along'], label: 'Direction',
    help: 'Up, down, or along strands. Angle tilts the fall sideways.' },
  angle: { value: 0, min: -0.25, max: 0.25, step: 0.01, label: 'Angle off Direction (turns)',
    help: 'Tilts the fall. 0 falls straight; higher slants it like rain in wind; negative slants the other way.' },
  speed: { value: 0.6, min: 0, max: 3, step: 0.01, label: 'Speed (layers a second)',
    help: 'How fast streaks fall (each lane varies a little). 0 freezes them; high pours them through quickly.' },
  lanes: { value: 40, min: 4, max: 120, step: 1, label: 'Lanes',
    help: 'How many lanes fit across; flakes use one column per four lanes. Low gives fewer, broader shapes.' },
  density: { value: 0.8, min: 0, max: 1, step: 0.01, label: 'Stream chance',
    help: 'Chance for each of three streams per lane. Low is a drizzle; 1 admits all three, at their own phases.' },
  tail: { value: 0.15, min: 0.005, max: 0.6, step: 0.005, label: 'Tail (share of the layer)',
    showWhen: { profile: ['streak'] },
    help: 'How long each streak tail fades over. Low is short sharp dashes; high long glowing trails.' },
  depth: { value: 3, min: 1, max: 6, step: 1, label: 'Depth slots',
    help: 'How many separate sheets of lanes stack front to back. 1 is one flat sheet; high a deep, layered volume.' },
  profile: { value: 'streak', type: 'choice', options: ['streak', 'flake'], label: 'Profile',
    help: 'Streak draws falling lines with tails; flake draws round swaying dots, like snow.' },
  sway: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Sway', showWhen: { profile: ['flake'] },
    help: 'How far flakes drift side to side as they fall (flake only). 0 drops straight; high weaves widely.' },
};

// Each strand has its own lane along; vertical falls use the layer's width.
const across = (p, d) => (d === 'along' ? fract(p.fixture * 0.618) : p.lz);

function pixel(p, t, P) {
  const d = P.direction, w = TAU * P.angle, s = sin(w), c = cos(w), a0 = toward(p, d), b0 = across(p, d);
  const flake = P.profile === 'flake', n = flake ? P.lanes / 4 : P.lanes;
  const along = a0 * c + b0 * s, x = (b0 * c - a0 * s) * n, lane = floor(x);
  const deep = floor(p.lx * P.depth * 0.9999), run = clock('speed');
  const span = flake ? 1.3 : 2.6, lead = flake ? 0.15 : 1.3;          // a lap, from off one end past the other
  let v = 0;
  for (let m = 0; m < 3; m++) {
    if (rand(lane, deep * 3 + m, 4) > P.density) continue;
    const head = fract(run * (0.6 + 0.8 * rand(lane, m, 1)) / span + rand(lane, m, 2)) * span - lead;
    const behind = head - along;
    if (flake) {
      const off = x - lane - 0.5 - P.sway * 0.4 * sin(TAU * (run * 0.5 + rand(lane, m, 3)));
      v = max(v, smoothstep(0.5, 0.2, hypot(behind * n, off)));
    } else if (behind > -0.01) {
      v = max(v, exp(-max(0, behind) / P.tail));
    }
  }
  if (v < 0.004) return null;
  const col = pal('colours', 0.35 + 0.65 * v);                       // the tail fades by alpha, not twice
  col[3] = v;
  return col;
}
