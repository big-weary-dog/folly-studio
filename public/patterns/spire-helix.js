// Tower helix: candy stripes wind up round each tower and its spire.
//
// Each LED finds the vertical axis of its nearest tower (the four spire axes, in metres) and
// takes its angle round it; adding height turns the angle into a helix, and time turns the
// helix. Made for the spires, quad arches and spirelets; elsewhere it still spirals round the
// closest tower.
const params = {
  speed: { value: 0.3, min: -2, max: 2, step: 0.01, label: 'Turns per second' },
  stripes: { value: 2, min: 1, max: 8, step: 1, label: 'Stripes round' },
  pitch: { value: 3, min: 0.5, max: 12, step: 0.1, label: 'Metres per turn' },
  a: { value: '#ff0040', type: 'color' },
  b: { value: '#ffd000', type: 'color' },
};

// Spire axes [x, z] in metres: front-left, front-right, back-left, back-right.
const TOWERS = [[-9.85, -5.24], [-9.85, 4.52], [12.99, -7.68], [12.97, 6.98]];

function pixel(p, t, P) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < TOWERS.length; i++) {
    const d = hypot(p.X - TOWERS[i][0], p.Z - TOWERS[i][1]);
    if (d < bd) { bd = d; best = i; }
  }
  const [tx, tz] = TOWERS[best];
  const angle = atan2(p.Z - tz, p.X - tx) / TAU;          // -0.5..0.5 round the axis
  const s = angle * P.stripes + p.Y / P.pitch - t * P.speed;
  return mix(P.a, P.b, smoothstep(0.3, 0.7, tri(s)));
}
