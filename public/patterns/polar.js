// Polar: turns the layer into a circle round its centre: what is above it draws its across as the angle and its up
// as the distance from the centre. Bars across become spokes; bars up become rings.
const params = {
  repeats: { value: 1, min: 1, max: 8, step: 1, label: 'Repeats round the circle',
    help: 'How many copies of the pattern fit round the circle. One wraps it once; more repeat it like slices.' },
  inward: { value: false, type: 'toggle', label: 'Up runs inward',
    help: 'Off draws the bottom at the centre, top at the rim; on flips it, so the top is at the centre.' },
};

function warp(q, t, P) {
  move(q, q.lx, P.inward ? 1 - q.r : q.r, fract(q.a * round(P.repeats)));
}
