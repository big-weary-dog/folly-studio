// Shockwave: a sphere bursts from the rose window's centre (rose off, or a rig without a group tagged `rose`: the
// layer's middle) and sweeps out through arches, towers and spires in true metres, reaching the layer's far corner:
// highlight front (harder with energy), accent wake, low colour ahead. every (seconds), width (of the reach, grows).
const params = {
  every: { value: 2, min: 0.5, max: 8, step: 0.1, label: 'Seconds between waves' },
  width: { value: 0.12, min: 0.02, max: 0.5, step: 0.01, label: 'Ring width' },
  rose: { value: true, type: 'toggle', label: 'Burst from the rose window' },
};

let ox = 0, oy = 0, oz = 0, reach = 1;
function frame(t, P) {
  const lo = extent()[0], hi = extent()[1], o = P.rose ? centres('rose')[0] : undefined;
  ox = o ? o[0] : (lo[0] + hi[0]) / 2;
  oy = o ? o[1] : (lo[1] + hi[1]) / 2;
  oz = o ? o[2] : (lo[2] + hi[2]) / 2;
  // Metres from the origin to the layer's farthest corner: the wave fills what it lands on.
  reach = hypot(max(ox - lo[0], hi[0] - ox), max(oy - lo[1], hi[1] - oy), max(oz - lo[2], hi[2] - oz)) || 1;
}

function pixel(p, t, P, G) {
  const a = fract(t / P.every), R = 1.2 * (1 - (1 - a) ** 3);              // bursts fast, then slows
  const dx = p.X - ox, dy = p.Y - oy, dz = p.Z - oz, d = sqrt(dx * dx + dy * dy + dz * dz) / reach;  // 1: far corner
  const x = (R - d) / (P.width * (0.5 + a));                 // > 0 behind the front
  const fade = 1 - a * a * a;
  const c = mix(pal('low', d), pal('accent', d), (x > 0 ? exp(-x * 0.3) : exp(-x * x * 9)) * fade);
  return mix(c, pal('high'), exp(-x * x * 4) * fade * (0.5 + 0.5 * G.energy));
}
