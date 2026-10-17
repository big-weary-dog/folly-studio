// Rose ripple: rings of light spread from the rose window through the whole cathedral.
//
// Distance is measured in metres in 3D from the centre of the rose window (X, Y, Z are metres),
// so the rings are true spheres: they cross the window first, then the arches, the towers and
// the spires. Rainbow shifts each new ring's hue along.
const params = {
  speed: { value: 4, min: 0.5, max: 15, step: 0.1, label: 'Metres per second' },
  spacing: { value: 6, min: 1, max: 20, step: 0.1, label: 'Metres between rings' },
  width: { value: 0.25, min: 0.05, max: 0.5, step: 0.01, label: 'Ring width' },
  base: { value: '#12006b', type: 'color' },
  ring: { value: '#00ffd5', type: 'color' },
  rainbow: { value: true, type: 'toggle' },
};

// The rose window's centre, from the pixel map (td/python/make_pixel_csv.py).
const ROSE = [-8.567, 5.936, -0.443];

function pixel(p, t, P) {
  const d = dist(p.X, p.Y, p.Z, ROSE[0], ROSE[1], ROSE[2]);
  const phase = (d - t * P.speed) / P.spacing;
  const k = pulse(phase, P.width);
  // Which ring this is (counting outward ones as newer) picks its hue.
  const ring = P.rainbow ? hsv(0.47 - floor(phase + 0.5) * 0.13, 1, 1) : P.ring;
  return mix(P.base, ring, k);
}
