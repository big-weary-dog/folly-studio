// Lighthouse: beams turn round the layer's vertical axis (atan2 of lz and lx; a flat layer, lx 0.5 all over,
// turns in the façade by a), each a solid band of saturated colour with a crisp `edge`, never blended toward
// white, leaving an afterglow (`glow`) through the trail colour. twist winds the beams with height.
const params = {
  speed: { value: 0.2, min: -2, max: 2, step: 0.01, label: 'Turns per second' },
  beams: { value: 2, min: 1, max: 6, step: 1 },
  width: { value: 0.22, min: 0.02, max: 0.5, step: 0.01, label: 'Beam width (share of the gap)' },
  edge: { value: 0.015, min: 0.002, max: 0.2, step: 0.001, label: 'Edge softness' },
  glow: { value: 0.55, min: 0, max: 1, step: 0.01, label: 'Afterglow behind the beam' },
  twist: { value: 0, min: -2, max: 2, step: 0.05, label: 'Twist with height' },
  base: { value: '#14009e', type: 'color' },
  trail: { value: '#d4006a', type: 'color' },
  beam: { value: '#ffae00', type: 'color' },
};

let turn = 0;

function frame(t, P) {
  turn = t * P.speed;
}

function pixel(p, t, P) {
  const flat = p.lx === 0.5;
  const angle = (flat ? p.a : atan2(p.lz - 0.5, p.lx - 0.5) / TAU) + p.ly * P.twist;
  const s = fract((angle - turn) * P.beams);              // 0 on a beam's centre line, rising ahead of it
  const half = P.width / 2, d = min(s, 1 - s);
  const behind = (P.speed < 0 ? s : 1 - s) - half;        // how far the beam has passed this LED
  const after = behind > 0 && behind < 0.5 ? P.glow * exp(-behind * 8) : 0;
  const c = mix(P.base, P.trail, after);
  return mix(c, P.beam, smoothstep(half + P.edge, half, d));
}
