// Polar: turns the layer into a circle round its centre: what is above it draws its across as the angle and its up
// as the distance from the centre. Bars across become spokes; bars up become rings.
const params = {
  repeats: { value: 1, min: 1, max: 8, step: 1, label: 'Repeats round the circle' },
  inward: { value: false, type: 'toggle', label: 'Up runs inward' },
};

function warp(q, t, P) {
  move(q, q.lx, P.inward ? 1 - q.r : q.r, fract(q.a * round(P.repeats)));
}
