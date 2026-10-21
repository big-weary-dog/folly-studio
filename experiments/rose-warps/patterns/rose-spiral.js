// Rose spiral: reads the rose as a ring-major row, then steps or strides through that row.
const params = {
  stride: { value: 's3', type: 'choice', options: ['s1', 's3', 's5', 's9', 's15'], label: 'Stride',
    help: 'Visit every kth pane address in the 112-address ring/petal grid. 1 just shifts the row.' },
  offset: { value: 1, min: 0, max: 111, step: 1, label: 'Offset (pane addresses)',
    help: 'Shift the ring-major row. Crossing petal 15 advances to the next ring.' },
  speed: { value: 0, min: -8, max: 8, step: 0.1, label: 'Speed (addresses a second)',
    help: 'Step along the row over time. 0 holds it still.' },
};
const strides = { s1: 1, s3: 3, s5: 5, s9: 9, s15: 15 };
const counts = new Int16Array(16 * 8), cells = new Int16Array(16 * 8 * 32);
const ready = new Uint8Array(16), rings = new Int16Array(16 * 32);
let cy = 0, cz = 0;
function frame() {
  const c = centres('rose')[0];
  if (c) { cy = c[1]; cz = c[2]; }
}
function warp(q, t, P) {
  if (!q.is('rose') || q.sector < 0 || q.sector > 15 || q.n > 32) return;
  const p = q.sector, i = q.i, n = q.n, ring = q.ring, base = p * 8;
  if (!ready[p]) {
    for (let j = 0; j < n; j++) {
      slide(q, j / max(1, n - 1));
      const r = q.ring, at = base + r;
      if (r < 1 || r > 7) continue;
      rings[p * 32 + j] = r;
      cells[at * 32 + counts[at]++] = j;
    }
    ready[p] = 1;
  }
  let rank = 0;
  for (let j = 0; j < i; j++) if (rings[p * 32 + j] === ring) rank++;
  const address = ((ring - 1) * 16 + p) * strides[P.stride] + round(P.offset) + floor(clock('speed'));
  const a112 = ((address % 112) + 112) % 112, dest = base + floor(a112 / 16) + 1;
  const nc = counts[dest], old = counts[base + ring];
  slide(q, (nc ? cells[dest * 32 + min(nc - 1, floor((rank + 0.5) * nc / old))] : i) / max(1, n - 1));
  const a = (a112 % 16 - p) * TAU / 16, y = q.Y - cy, z = q.Z - cz;
  const Y = cy + y * cos(a) - z * sin(a), Z = cz + z * cos(a) + y * sin(a);
  move(q, q.lx, q.sy ? 0.5 + (Y - q.oy) / (2 * q.sy) : 0.5,
    q.sz ? 0.5 + (Z - q.oz) / (2 * q.sz) : 0.5);
  slide(q, toward(q, 'along'));
}
