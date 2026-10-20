// Lighthouse: beams of colour turn round the layer, one colour each from Colours, each fading behind as it passes.
// Plane is what they turn in: round an upright axis (plan; a flat layer turns in its façade), in the façade, or
// from the side. Stripes fills between the beams instead, each stripe blending into the next. Twist winds them along
// the axis (with height in plan).
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours',
    help: 'The palette the beams or stripes take, one colour each in turn.' },
  plane: { value: 'plan', type: 'choice', options: ['facade', 'side', 'plan'], label: 'Plane',
    help: 'Plan sweeps round an upright axis; facade turns in the front face; side turns as seen from the side.' },
  profile: { value: 'beams', type: 'choice', options: ['beams', 'stripes'], label: 'Profile',
    help: 'Beams are sweeping lights with a trail; stripes fill the whole circle, each blending into the next.' },
  spin: { value: 0.2, min: -2, max: 2, step: 0.01, label: 'Spin (turns a second)',
    help: 'How fast the beams go round. Zero holds still; negative turns the other way.' },
  beams: { value: 2, min: 1, max: 8, step: 1, label: 'Beams',
    help: 'How many beams share the circle, evenly spaced.' },
  width: { value: 0.22, min: 0.02, max: 0.5, step: 0.01, label: 'Width (share of the gap; stripes: blend)',
    help: 'Low is a thin blade, high a broad wedge. With stripes, how much of each stripe blends into the next.' },
  edge: { value: 0.015, min: 0.002, max: 0.2, step: 0.001, label: 'Edge softness',
    help: 'How soft each beam edge is. Low is a sharp cut; high fades gently.' },
  glow: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Afterglow behind the beam',
    help: 'How bright the fading trail left behind each beam is. Zero leaves none; high leaves a strong wake.' },
  twist: { value: 0, min: -6, max: 6, step: 0.05, label: 'Twist along the axis (turns)',
    help: 'Winds the beams along the axis into a spiral. Zero keeps them straight; more turns twist them tighter.' },
};

function pixel(p, t, P) {
  const plan = P.plane === 'plan' && p.sx > 0, side = P.plane === 'side';     // angles in metres round the middle
  const angle = plan ? atan2(p.Z - p.oz, p.X - p.ox) / TAU : side ? atan2(p.X - p.ox, p.Y - p.oy) / TAU : p.a;
  const along = P.plane === 'plan' ? p.ly : side ? p.lz : p.lx;
  const x = (angle + along * P.twist - clock('spin')) * P.beams, k = floor(x), s = x - k;
  if (P.profile === 'stripes') {
    return mix(swatch('colours', k), swatch('colours', k + 1), smoothstep(1 - P.width, 1, s));
  }
  // s: 0 on beam k's centre line, rising toward beam k + 1. The beam just passed glows behind it.
  const half = P.width / 2, d = min(s, 1 - s), near = s < 0.5 ? k : k + 1;
  const behind = (P.spin < 0 ? s : 1 - s) - half;
  const after = behind > 0 && behind < 0.5 ? P.glow * exp(-behind * 8) : 0;
  const beam = smoothstep(half + P.edge, half, d), c = swatch('colours', beam > 0 ? near : P.spin < 0 ? k : k + 1);
  c[3] = max(beam, after);
  return c[3] > 0.002 ? c : null;
}
