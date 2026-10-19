// Anchor: moves the centre of what is above it to a group's centre (by tag): the rose, the nearest tower, ...
// Shape is how distance is measured round it: in the façade, in plan (round an upright axis) or as a sphere.
// Reach is the distance, in metres, that counts as the edge (0: the layer's farthest corner). Line up uses the
// whole rig's across, up and depth, so layers on different groups match.
const params = {
  tag: { value: 'rose', type: 'choice', label: 'Group',
    options: ['rose', 'window', 'tower', 'spire', 'spirelet', 'arch', 'arch-main', 'arch-mini', 'arch-quad', 'ring',
      'canopy', 'wash', 'flood', 'ground-level', 'front', 'back', 'left', 'right', 'all'],
    help: 'Which of the rig\'s tagged groups the centre moves to; all is the whole rig.' },
  which: { value: 'first', type: 'choice', options: ['first', 'nearest'], label: 'Which group',
    help: 'first centres on the first group with the tag; nearest centres each LED on its closest group.' },
  shape: { value: 'facade', type: 'choice', options: ['facade', 'plan', 'sphere'], label: 'Shape',
    help: 'facade rings round the centre on the front face; plan rings round an upright axis; sphere grows outward.' },
  reach: { value: 0, min: 0, max: 30, step: 0.5, label: 'Reach (metres; 0: the layer)',
    help: 'How far out counts as the edge. Small packs what is above round the group; large spreads it wide.' },
  lineup: { value: false, type: 'toggle', label: 'Line up with other layers',
    help: 'On keeps the across, up and depth of the whole rig, so layers on different groups match up.' },
};

let list = [], R = 1;
const metric = (shape, dx, dy, dz) => (shape === 'plan' ? hypot(dx, dz) : shape === 'sphere' ? hypot(dx, dy, dz)
  : hypot(dy, dz));

function frame(t, P) {
  list = centres(P.tag);
  if (!list.length) return;
  const [lo, hi] = extent(), c = list[0];
  if (P.reach > 0) R = P.reach;
  else if (P.which === 'nearest' && list.length > 1) {     // half the gap between the two closest
    R = Infinity;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        R = min(R, metric(P.shape, b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2);
      }
    }
  } else {                                                 // the layer's farthest corner
    R = 0;
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
      R = max(R, metric(P.shape, x - c[0], y - c[1], z - c[2]));
    }
  }
  R = max(R, 0.5);
}

function warp(q, t, P) {
  if (!list.length) return;
  let c = list[0];
  if (P.which === 'nearest') {
    let best = Infinity;
    for (const k of list) {
      const d = metric(P.shape, q.X - k[0], q.Y - k[1], q.Z - k[2]);
      if (d < best) { best = d; c = k; }
    }
  }
  const dx = q.X - c[0], dy = q.Y - c[1], dz = q.Z - c[2], plan = P.shape === 'plan';
  q.a = fract(plan ? atan2(dz, -dx) / TAU : atan2(dz, dy) / TAU);  // plan: 0 toward the front, ¼ toward the right
  q.r = metric(P.shape, dx, dy, dz) / R;
  if (P.lineup) { q.lx = q.x; q.ly = q.y; q.lz = q.z; return; }
  // A new frame (SPEC "Modules"): the moves of the warps after this one read the group's middle and reach.
  q.cy = c[1]; q.cz = c[2]; q.oz = c[2]; q.sz = q.sr = R; q.lz = 0.5 + dz / (2 * R);
  if (P.shape !== 'facade') { q.ox = c[0]; q.sx = R; q.lx = 0.5 + dx / (2 * R); }
  if (!plan) { q.oy = c[1]; q.sy = R; q.ly = 0.5 + dy / (2 * R); }
}
