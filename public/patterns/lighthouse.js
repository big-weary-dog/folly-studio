// Lighthouse: beams of colour turn round the layer, one colour each from Colours, each fading behind as it passes.
// Plane is what they turn in: round an upright axis (plan; a flat layer turns in its façade), in the façade, or
// from the side. Stripes fills between the beams instead, each stripe blending into the next. Twist winds them along
// the axis (with height in plan).
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours' },
  plane: { value: 'plan', type: 'choice', options: ['facade', 'side', 'plan'], label: 'Plane' },
  profile: { value: 'beams', type: 'choice', options: ['beams', 'stripes'], label: 'Profile' },
  spin: { value: 0.2, min: -2, max: 2, step: 0.01, label: 'Spin (turns a second)' },
  beams: { value: 2, min: 1, max: 8, step: 1, label: 'Beams' },
  width: { value: 0.22, min: 0.02, max: 0.5, step: 0.01, label: 'Width (share of the gap; stripes: blend)' },
  edge: { value: 0.015, min: 0.002, max: 0.2, step: 0.001, label: 'Edge softness' },
  glow: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Afterglow behind the beam' },
  twist: { value: 0, min: -6, max: 6, step: 0.05, label: 'Twist along the axis (turns)' },
};

function pixel(p, t, P) {
  const plan = P.plane === 'plan' && p.lx !== 0.5, side = P.plane === 'side';
  const angle = plan ? atan2(p.lz - 0.5, p.lx - 0.5) / TAU : side ? atan2(p.lx - 0.5, p.ly - 0.5) / TAU : p.a;
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
