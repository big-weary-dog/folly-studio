// Mosaic: snaps what is above it to flat pieces. Shape blocks: tiles, Blocks across the layer's width, height and
// depth (flat layers stay flat); runs: runs of LEDs along each strand, LEDs per run long, sharing one colour.
const params = {
  shape: { value: 'blocks', type: 'choice', options: ['blocks', 'runs'], label: 'Shape',
    help: 'blocks tiles the layer in space; runs breaks each strand into runs of LEDs that share a colour.' },
  cells: { value: 12, min: 2, max: 64, step: 1, label: 'Blocks across the layer (blocks)',
    help: 'How many blocks fit across the layer each way. Low gives big chunky blocks; high keeps the detail.' },
  leds: { value: 6, min: 2, max: 40, step: 1, label: 'LEDs per run (runs)',
    help: 'How many LEDs along a strand share one colour. Low gives short runs; high gives long flat runs.' },
};

const snap = (v, n) => (floor(v * n) + 0.5) / n;

function warp(q, t, P) {
  const n = round(P.cells), m = round(P.leds);
  if (P.shape === 'runs') {
    if (q.n > 1) slide(q, min(q.n - 1, floor(q.i / m) * m + floor(m / 2)) / (q.n - 1));
  } else move(q, snap(q.lx, n), snap(q.ly, n), snap(q.lz, n));
}
