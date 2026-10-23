// Reorder: lines what is above it up in a new order, read as out (and in): By wires, metres along the wiring from
// From (a tag, or each network's top or bottom), so a ring from the rose runs down the petals and over the arches
// rather than through the air; by strands or groups, the layer as one long row, strand after strand or group after
// group; by random, a fixed shuffle Seed deals, so a sweep becomes a dissolve. The angle stays. Amount mixes from
// the straight-line distance (0) to the new order (1). Reach is the metres of wire that count as the edge (0: the
// farthest).
const params = {
  by: { value: 'wires', type: 'choice', options: ['wires', 'strands', 'groups', 'random'], label: 'Order by',
    help: 'wires: along the wiring from From; strands or groups: one long row; random: a fixed shuffle (Seed).' },
  from: { value: 'rose', type: 'choice', label: 'From', showWhen: { by: ['wires'] },
    options: ['rose', 'tower', 'spire', 'spirelet', 'arch', 'arch-main', 'arch-mini', 'arch-quad', 'canopy',
      'ground-level', 'front', 'back', 'left', 'right', 'top', 'bottom'],
    help: 'By wires: where it starts: a tagged group\'s heart, or top or bottom, each piece\'s highest or lowest.' },
  reach: { value: 0, min: 0, max: 60, step: 0.5, label: 'Reach (metres of wire; 0: the farthest)',
    showWhen: { by: ['wires'] },
    help: 'By wires: how much wire counts as the edge. Small packs what is above near From; 0 spreads it to the end.' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Amount',
    help: 'Zero keeps the straight-line distance; one is fully in the new order.' },
  seed: { value: 1, min: 0, max: 99, step: 1, label: 'Seed', showWhen: { by: ['random'] },
    help: 'By random: which shuffle. Each seed is different, always the same; step it to deal again.' },
};

let order = null, dist = null, R = 1;

function frame(t, P) {
  if (P.by !== 'wires') { order = rowOrder(P.by, P.seed); return; }
  order = null;
  const d = wireDistance(P.from);
  if (d !== dist) {                                        // a new layer, rig or From: the farthest wire once
    dist = d; R = 0;
    for (const k of links().idx) if (d[k] < Infinity) R = max(R, d[k]);
  }
}

function warp(q, t, P) {
  if (P.amount <= 0) return;
  const key = order ? order[q.k] : dist ? dist[q.k] / (P.reach > 0 ? P.reach : max(R, 0.5)) : NaN;
  if (!(key >= 0) || key === Infinity) return;
  turn(q, q.a, mix(q.r, key, P.amount));                  // out and in read the order; the angle stays
}
