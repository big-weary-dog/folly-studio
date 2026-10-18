// Tower helix: candy stripes wind up round the axis of each LED's nearest tower (the groups tagged `tower`, in
// metres), height turning the angle into a helix and time turning the helix. `around`, or a rig without towers,
// winds them round the layer's own centre instead: xLights' Spirals on any group (a flat layer turns by a).
const params = {
  speed: { value: 0.3, min: -2, max: 2, step: 0.01, label: 'Turns per second' },
  stripes: { value: 2, min: 1, max: 8, step: 1, label: 'Stripes round' },
  pitch: { value: 3, min: 0.5, max: 12, step: 0.1, label: 'Metres per turn' },
  a: { value: '#ff0040', type: 'color' },
  b: { value: '#ffd000', type: 'color' },
  around: { value: false, type: 'toggle', label: 'Round the layer\'s own centre' },
};

let towers = [];
function frame() { towers = centres('tower'); }

function pixel(p, t, P) {
  if (P.around || !towers.length) {
    const a = p.lx === 0.5 ? p.a : atan2(p.lz - 0.5, p.lx - 0.5) / TAU;
    return mix(P.a, P.b, smoothstep(0.3, 0.7, tri(a * P.stripes + p.Y / P.pitch - t * P.speed)));
  }
  let best = 0, bd = Infinity;
  for (let i = 0; i < towers.length; i++) {
    const d = hypot(p.X - towers[i][0], p.Z - towers[i][2]);
    if (d < bd) { bd = d; best = i; }
  }
  const [tx, , tz] = towers[best];
  const angle = atan2(p.Z - tz, p.X - tx) / TAU;          // -0.5..0.5 round the axis
  const s = angle * P.stripes + p.Y / P.pitch - t * P.speed;
  return mix(P.a, P.b, smoothstep(0.3, 0.7, tri(s)));
}
