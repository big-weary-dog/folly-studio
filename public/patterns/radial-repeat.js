// Radial repeat: repeats the radius r in rings round the layer's centre (lz, ly rebuilt from it and a), a tunnel
// when it zooms. rings, zoom (rings a second outward), mirror (every other ring flipped, so no seam).
const params = {
  rings: { value: 3, min: 1, max: 12, step: 1 },
  zoom: { value: 0.2, min: -2, max: 2, step: 0.01, label: 'Rings a second outward' },
  mirror: { value: true, type: 'toggle', label: 'Mirror every other ring' },
};

function warp(q, t, P) {
  const x = q.r * P.rings - t * P.zoom, r = P.mirror ? tri(x / 2) : fract(x);
  q.r = r;
  q.lz = 0.5 + 0.5 * r * sin(TAU * q.a);
  q.ly = 0.5 + 0.5 * r * cos(TAU * q.a);
}
