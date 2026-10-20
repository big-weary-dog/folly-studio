// Radial repeat: repeats what is above it in rings round the layer's centre, moving outward at Speed; Mirror flips
// every other ring, so there is no seam.
const params = {
  rings: { value: 3, min: 1, max: 12, step: 1, label: 'Rings',
    help: 'How many copies fit from the centre to the edge. One draws it once; more gives tight rings.' },
  speed: { value: 0.2, min: -2, max: 2, step: 0.01, label: 'Speed (rings a second)',
    help: 'How fast the rings move. Positive moves outward, negative inward; zero holds still.' },
  mirror: { value: true, type: 'toggle', label: 'Mirror',
    help: 'On flips every other ring so they join with no seam; off repeats each the same way, with a hard edge.' },
};

function warp(q, t, P) {
  const x = q.r * P.rings - clock('speed'), r = P.mirror ? tri(x / 2) : fract(x);
  turn(q, q.a, r);
}
