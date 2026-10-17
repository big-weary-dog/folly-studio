// Mirror: folds the layer onto itself, so one half plays and the other reflects it.
//
// A warp moves each pixel before the modules after it draw. Left-right folds the right half onto
// the left (lz, z and the angle a), front-back and up-down fold depth (lx, x) and height (ly, y),
// and along strands folds every wire at its middle (u and i), so chases run in from both ends.
// Positions in metres (X Y Z) are left as they are.
const params = {
  leftRight: { value: true, type: 'toggle', label: 'Left ↔ right' },
  frontBack: { value: false, type: 'toggle', label: 'Front ↔ back' },
  upDown: { value: false, type: 'toggle', label: 'Up ↔ down' },
  along: { value: false, type: 'toggle', label: 'Along strands' },
};

const fold = (v) => (v > 0.5 ? 1 - v : v);

function warp(q, t, P) {
  if (P.leftRight) { q.lz = fold(q.lz); q.z = fold(q.z); q.a = fold(q.a); }
  if (P.frontBack) { q.lx = fold(q.lx); q.x = fold(q.x); }
  if (P.upDown) { q.ly = fold(q.ly); q.y = fold(q.y); }
  if (P.along) { q.u = fold(q.u); q.i = min(q.i, q.n - 1 - q.i); }
}
