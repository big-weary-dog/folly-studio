// Rose ripple: rings spread in 3D from the rose window's centre (X Y Z in metres; on a rig without a group tagged
// `rose`, its middle), true spheres crossing the window, the arches, the towers and the spires; rainbow moves each
// new ring's hue along.
const params = {
  speed: { value: 4, min: 0.5, max: 15, step: 0.1, label: 'Metres per second' },
  spacing: { value: 6, min: 1, max: 20, step: 0.1, label: 'Metres between rings' },
  width: { value: 0.25, min: 0.05, max: 0.5, step: 0.01, label: 'Ring width' },
  base: { value: '#12006b', type: 'color' },
  ring: { value: '#00ffd5', type: 'color' },
  rainbow: { value: true, type: 'toggle' },
};

let O = [0, 0, 0];
function frame() { O = centres('rose')[0] || centres('all')[0] || O; }

function pixel(p, t, P) {
  const d = dist(p.X, p.Y, p.Z, O[0], O[1], O[2]);
  const phase = (d - t * P.speed) / P.spacing;
  const k = pulse(phase, P.width);
  // Which ring this is (counting outward ones as newer) picks its hue.
  const ring = P.rainbow ? hsv(0.47 - floor(phase + 0.5) * 0.13, 1, 1) : P.ring;
  return mix(P.base, ring, k);
}
