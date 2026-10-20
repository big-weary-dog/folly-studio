// Mirror: folds the layer onto itself, so what is above it draws folded: left-right, front-back, up-down (round the
// middle of its frame: under anchor, the group's); into Wedges round the centre (their edges on the rose's petal
// edges) or Rings out from it; or every wire at its middle, so chases run in from both ends.
const params = {
  across: { value: true, type: 'toggle', label: 'Left ↔ right',
    help: 'On folds the layer side to side, so one half shows mirrored on the other. Off leaves it.' },
  depth: { value: false, type: 'toggle', label: 'Front ↔ back',
    help: 'On folds the layer front to back, so one half shows mirrored on the other. Off leaves it.' },
  height: { value: false, type: 'toggle', label: 'Up ↔ down',
    help: 'On folds the layer top to bottom, so one half shows mirrored on the other. Off leaves it.' },
  wedges: { value: 0, min: 0, max: 16, step: 1, label: 'Wedges round (0: off)',
    help: 'Folds the circle into this many mirrored wedges, like a kaleidoscope. 8 or 16 match the rose\'s petals.' },
  rings: { value: 0, min: 0, max: 12, step: 2, label: 'Rings out (0: off)',
    help: 'Repeats the layer this many times from the centre out, every other ring mirrored, so there is no seam.' },
  along: { value: false, type: 'toggle', label: 'Along strands',
    help: 'On folds every strand at its middle, so chases run in from both ends. Off leaves strands as they are.' },
};

const fold = (v) => (v > 0.5 ? 1 - v : v);

function warp(q, t, P) {
  if (P.across || P.depth || P.height) {
    move(q, P.depth ? fold(q.lx) : q.lx, P.height ? fold(q.ly) : q.ly, P.across ? fold(q.lz) : q.lz);
  }
  const n = round(P.wedges), m = round(P.rings);
  if (n >= 2 || m >= 2) {
    const f = fract((q.a + 1 / 32) * n);                 // from a petal edge (a = k/16 − 1/32), so wedges fit petals
    turn(q, n >= 2 ? (f < 0.5 ? f : 1 - f) / n - 1 / 32 : q.a, m >= 2 ? tri(q.r * m / 2) : q.r);
  }
  if (P.along) slide(q, fold(q.u));
}
