// Mirror: folds the layer onto itself, so what is above it draws folded: left-right, front-back, up-down (round the
// middle of its frame: under anchor, the group's), or every wire at its middle, so chases run in from both ends.
const params = {
  leftRight: { value: true, type: 'toggle', label: 'Left ↔ right' },
  frontBack: { value: false, type: 'toggle', label: 'Front ↔ back' },
  upDown: { value: false, type: 'toggle', label: 'Up ↔ down' },
  along: { value: false, type: 'toggle', label: 'Along strands' },
};

const fold = (v) => (v > 0.5 ? 1 - v : v);

function warp(q, t, P) {
  if (P.leftRight || P.frontBack || P.upDown) {
    move(q, P.frontBack ? fold(q.lx) : q.lx, P.upDown ? fold(q.ly) : q.ly, P.leftRight ? fold(q.lz) : q.lz);
  }
  if (P.along) slide(q, fold(q.u));
}
