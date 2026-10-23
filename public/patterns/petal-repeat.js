// Petal repeat: copies a block of neighbouring petals round the rose window, Repeats times, alternate copies mirrored
// (the cells inside each petal too), for symmetry with whole petals. Off the rose it leaves what is above it alone.
const params = {
  repeats: { value: 'four', type: 'choice', options: ['two', 'four', 'eight', 'sixteen'], label: 'Repeats',
    help: 'How many copies go round the rose: four copies four petals each; sixteen repeats one petal.' },
  petal: { value: 0, min: 0, max: 15, step: 1, label: 'Source petal (0–15)',
    help: 'The first petal of the block, 0 at the top, then clockwise. Petal mask\'s petal N is N − 1 here.' },
  mirror: { value: true, type: 'toggle', label: 'Mirror',
    help: 'Reflect alternate copies, so neighbouring copies meet edge to matching edge.' },
};

let cy = 0, cz = 0;
function frame() {
  const c = centres('rose')[0];
  if (c) { cy = c[1]; cz = c[2]; }
}

function warp(q, t, P) {
  if (!q.is('rose') || q.sector < 0) return;
  const r = P.repeats, n = r === 'two' ? 8 : r === 'eight' ? 2 : r === 'sixteen' ? 1 : 4;
  const p = q.sector, flip = P.mirror && floor(p / n) % 2, local = p % n;
  const a = (round(P.petal) + (flip ? n - 1 - local : local) - p) * TAU / 16;
  let y = q.Y - cy, z = q.Z - cz;
  if (flip) {   // across the petal's centre line
    const b = p * TAU / 16, along = y * cos(b) + z * sin(b), side = z * cos(b) - y * sin(b);
    y = along * cos(b) + side * sin(b); z = along * sin(b) - side * cos(b);
  }
  const Y = cy + y * cos(a) - z * sin(a), Z = cz + z * cos(a) + y * sin(a);
  move(q, q.lx, q.sy ? 0.5 + (Y - q.oy) / (2 * q.sy) : 0.5, q.sz ? 0.5 + (Z - q.oz) / (2 * q.sz) : 0.5);
  slide(q, toward(q, 'along'));
}
