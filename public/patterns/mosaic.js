// Mosaic: snaps what is above it to runs of LEDs along each strand, LEDs per run long, each run sharing one colour.
const params = {
  leds: { value: 6, min: 2, max: 40, step: 1, label: 'LEDs per run',
    help: 'How many LEDs along a strand share one colour. Low gives short runs; high gives long flat runs.' },
};

function warp(q, t, P) {
  const m = round(P.leds);
  if (q.n > 1) slide(q, min(q.n - 1, floor(q.i / m) * m + floor(m / 2)) / (q.n - 1));
}
