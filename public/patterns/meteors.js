// Meteors: shooting stars race along every strand, trailing fading tails.
//
// u, i and n place each LED along its own wire (an arch, a spire strand, a canopy run, a quad
// face), so a meteor follows the structure itself. Every strand gets its own random start,
// pace and direction (rand(p.strand, ...) is stable), and a gap so heads arrive one by one.
const params = {
  speed: { value: 60, min: 5, max: 200, step: 1, label: 'LEDs per second' },
  count: { value: 2, min: 1, max: 4, step: 1, label: 'Meteors per strand' },
  tail: { value: 10, min: 2, max: 60, step: 1, label: 'Tail length (LEDs)' },
  gap: { value: 80, min: 0, max: 300, step: 1, label: 'Gap between laps (LEDs)' },
  both: { value: true, type: 'toggle', label: 'Both directions' },
  sky: { value: '#0a0a5c', type: 'color' },
  color: { value: '#00c8ff', type: 'color' },
  head: { value: '#ffffff', type: 'color' },
};

function pixel(p, t, P) {
  const s = p.strand;
  const reverse = P.both && rand(s, 7) < 0.5;
  const i = reverse ? p.n - 1 - p.i : p.i;               // LEDs from this run's start
  const lap = p.n + P.gap;
  let v = 0;
  for (let m = 0; m < P.count; m++) {
    const pace = P.speed * (0.7 + 0.6 * rand(s, m, 3));
    const headAt = fract(rand(s, m) + t * pace / lap) * lap;
    const behind = headAt - i;                            // LEDs behind the head
    if (behind >= 0) v = max(v, exp(-behind / P.tail));
  }
  const c = mix(P.color, P.head, smoothstep(0.75, 1, v));
  return mix(P.sky, c, v);
}
