// Mosaic: snaps positions to blocks: `cells` across width, height and depth (and metres, angle, radius to
// match), `leds` per block along each strand (1 keeps strands smooth). Flat layers stay flat.
const params = {
  cells: { value: 12, min: 2, max: 64, step: 1, label: 'Blocks across the layer' },
  leds: { value: 6, min: 1, max: 40, step: 1, label: 'LEDs per block along a strand' },
};

const snap = (v, n) => (floor(v * n) + 0.5) / n;

function warp(q, t, P) {
  const n = round(P.cells), m = round(P.leds), metres = 24 / n;
  if (q.lx !== 0.5) q.lx = snap(q.lx, n);
  q.ly = snap(q.ly, n); q.lz = snap(q.lz, n);
  q.x = snap(q.x, n); q.y = snap(q.y, n); q.z = snap(q.z, n);
  q.X = (floor(q.X / metres) + 0.5) * metres; q.Y = (floor(q.Y / metres) + 0.5) * metres;
  q.Z = (floor(q.Z / metres) + 0.5) * metres;
  q.a = snap(q.a, 2 * n); q.r = snap(q.r, n / 2);
  if (m > 1) {
    q.i = min(q.n - 1, floor(q.i / m) * m + floor(m / 2));
    q.u = q.n > 1 ? q.i / (q.n - 1) : 0;
  }
}
