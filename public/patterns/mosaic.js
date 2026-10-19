// Mosaic: snaps what is above it to blocks, Blocks across the layer's width, height and depth, and LEDs per block along
// each strand (1 keeps strands smooth). Flat layers stay flat.
const params = {
  cells: { value: 12, min: 2, max: 64, step: 1, label: 'Blocks across the layer' },
  leds: { value: 6, min: 1, max: 40, step: 1, label: 'LEDs per block along a strand' },
};

const snap = (v, n) => (floor(v * n) + 0.5) / n;

function warp(q, t, P) {
  const n = round(P.cells), m = round(P.leds);
  move(q, snap(q.lx, n), snap(q.ly, n), snap(q.lz, n));
  if (m > 1 && q.n > 1) slide(q, min(q.n - 1, floor(q.i / m) * m + floor(m / 2)) / (q.n - 1));
}
