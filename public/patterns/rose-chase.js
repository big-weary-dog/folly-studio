// Rose chase: petals light in turn round the rose window while rings breathe outward.
//
// On the window, petal (0-15, clockwise from 12 o'clock) and row (ring 1-7, centre out) are
// the window's own cells. Anywhere else the same picture comes from a (angle) and r (radius)
// round the layer's centre, so it also turns over the whole façade.
const params = {
  speed: { value: 0.25, min: -2, max: 2, step: 0.01, label: 'Turns per second (− anticlockwise)' },
  hands: { value: 2, min: 1, max: 8, step: 1 },
  trail: { value: 3, min: 0.5, max: 12, step: 0.1, label: 'Trail (petals)' },
  breathe: { value: 0.4, min: 0, max: 2, step: 0.01, label: 'Rings per second' },
  base: { value: '#1b0080', type: 'color' },
  chase: { value: '#ff00a0', type: 'color' },
  ring: { value: '#ffb000', type: 'color' },
};

function pixel(p, t, P) {
  const petal = p.petal >= 0 ? p.petal : floor(p.a * 16);
  const ring = p.row > 0 ? p.row : 1 + floor(p.r * 6.999);
  // Petals since a hand passed, 0 right behind it.
  const dir = P.speed < 0 ? -1 : 1;
  const since = fract(dir * (t * P.speed - petal / 16) * P.hands) * 16 / P.hands;
  const lit = exp(-since / P.trail);
  const swell = pulse((ring - 1) / 7 - t * P.breathe, 0.12);
  return mix(mix(P.base, P.chase, lit), P.ring, swell * 0.85);
}
