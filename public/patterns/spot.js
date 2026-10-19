// Spot: a round spot of one colour at the layer's centre; put an anchor below it to move it.
// Size is its radius as a share of the layer; Softness fades its edge.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours' },
  size: { value: 0.15, min: 0.01, max: 1, step: 0.01, label: 'Size' },
  softness: { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Softness' },
};

function pixel(p, t, P) {
  const d = p.r / P.size;                     // 0 at its centre, 1 at its edge
  const cover = 1 - smoothstep(1 - P.softness, 1, d);
  return cover > 0 ? [P.colours[0], P.colours[1], P.colours[2], cover] : null;
}
