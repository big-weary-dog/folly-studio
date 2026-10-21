// Rose ring reverse: exchanges inner and outer rings, sampling each ring's cells by their wire order.
const params = {
  inner: { value: 1, min: 1, max: 7, step: 1, label: 'Inner ring',
    help: 'The first ring in the range to reverse. Rings outside the range stay as they are.' },
  outer: { value: 7, min: 1, max: 7, step: 1, label: 'Outer ring',
    help: 'The last ring in the range. Unequal cell counts repeat or omit samples.' },
};
// Bounded scratch storage, created once. Discover each petal through slide and attrs, never rig ids.
const counts = new Int16Array(16 * 8), cells = new Int16Array(16 * 8 * 32);
const ready = new Uint8Array(16), rings = new Int16Array(16 * 32);
function warp(q, t, P) {
  if (!q.is('rose') || q.sector < 0 || q.sector > 15 || q.n > 32) return;
  const petal = q.sector, i = q.i, n = q.n, ring = q.ring, base = petal * 8;
  const lo = min(round(P.inner), round(P.outer)), hi = max(round(P.inner), round(P.outer));
  if (ring < lo || ring > hi) return;
  if (!ready[petal]) {
    for (let j = 0; j < n; j++) {
      slide(q, j / max(1, n - 1));
      const r = q.ring, at = base + r;
      if (r < 1 || r > 7) continue;
      rings[petal * 32 + j] = r;
      cells[at * 32 + counts[at]++] = j;
    }
    ready[petal] = 1;
  }
  let rank = 0;
  for (let j = 0; j < i; j++) if (rings[petal * 32 + j] === ring) rank++;
  const dest = base + lo + hi - ring, nc = counts[dest], old = counts[base + ring];
  const target = nc ? cells[dest * 32 + min(nc - 1, floor((rank + 0.5) * nc / old))] : i;
  slide(q, target / max(1, n - 1));
}
