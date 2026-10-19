// Mirror: folds the layer onto itself, so what is above it draws folded: left-right, front-back, up-down (round the
// middle of its frame: under anchor, the group's), or every wire at its middle, so chases run in from both ends.
const params = {
  across: { value: true, type: 'toggle', label: 'Left ↔ right' },
  depth: { value: false, type: 'toggle', label: 'Front ↔ back' },
  height: { value: false, type: 'toggle', label: 'Up ↔ down' },
  along: { value: false, type: 'toggle', label: 'Along strands' },
};

const fold = (v) => (v > 0.5 ? 1 - v : v);

function warp(q, t, P) {
  if (P.across || P.depth || P.height) {
    move(q, P.depth ? fold(q.lx) : q.lx, P.height ? fold(q.ly) : q.ly, P.across ? fold(q.lz) : q.lz);
  }
  if (P.along) slide(q, fold(q.u));
}
