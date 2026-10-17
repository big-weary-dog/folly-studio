// Lighthouse: beams sweep round the vertical axis, washing each face as they pass.
//
// The angle round the middle of the layer comes from lx (depth) and lz (width), so the beams
// turn round whatever the layer lands on: the whole cathedral, one tower, the canopy. A flat
// layer (one arch, the rose window) has no depth, so lx is 0.5 all over; there the beam turns
// in the façade instead, like a radar, using a (clockwise from 12 o'clock). Twist winds the
// beam into a spiral with height. frame() advances the turn once per frame.
const params = {
  speed: { value: 0.2, min: -2, max: 2, step: 0.01, label: 'Turns per second' },
  beams: { value: 2, min: 1, max: 6, step: 1 },
  width: { value: 0.2, min: 0.02, max: 0.5, step: 0.01, label: 'Beam width' },
  twist: { value: 0, min: -2, max: 2, step: 0.05, label: 'Twist with height' },
  base: { value: '#0b2a80', type: 'color' },
  beam: { value: '#fff3c4', type: 'color' },
};

let turn = 0;

function frame(t, P) {
  turn = t * P.speed;
}

function pixel(p, t, P) {
  const flat = p.lx === 0.5;
  const angle = (flat ? p.a : atan2(p.lz - 0.5, p.lx - 0.5) / TAU) + p.ly * P.twist;
  const k = pulse((angle - turn) * P.beams, P.width);
  return mix(P.base, P.beam, k);
}
