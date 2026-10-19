// Radial repeat: repeats what is above it in rings round the layer's centre, moving outward at Speed; Mirror flips
// every other ring, so there is no seam.
const params = {
  rings: { value: 3, min: 1, max: 12, step: 1, label: 'Rings' },
  speed: { value: 0.2, min: -2, max: 2, step: 0.01, label: 'Speed (rings a second)' },
  mirror: { value: true, type: 'toggle', label: 'Mirror' },
};

function warp(q, t, P) {
  const x = q.r * P.rings - clock('speed'), r = P.mirror ? tri(x / 2) : fract(x);
  q.r = r;
  q.lz = 0.5 + 0.5 * r * sin(TAU * q.a);
  q.ly = 0.5 + 0.5 * r * cos(TAU * q.a);
}
