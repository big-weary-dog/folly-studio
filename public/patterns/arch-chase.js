// Arch chase: the arches light one after another at Speed, each filling along its wire behind a head of the last
// colour, then fading. Arches is how many take turns (5 goes bay by bay, front to back).
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'Which palette colours each arch along its wire as it fills; the last colour lights the moving head.' },
  speed: { value: 1, min: 0.25, max: 6, step: 0.05, label: 'Speed (arches a second)',
    help: 'How fast the chase passes from arch to arch. Low steps slowly; high races round.' },
  count: { value: 5, min: 2, max: 40, step: 1, label: 'Count (arches in turn)',
    help: 'How many arches take turns before the chase repeats; arches that many apart light together.' },
  fade: { value: 1.5, min: 0.2, max: 6, step: 0.1, label: 'Fade (turns)',
    help: 'How long a lit arch takes to die away. Low snaps off behind the head; high leaves a long glowing trail.' },
};

function pixel(p, t, P) {
  const n = round(P.count), x = clock('speed'), turn = floor(x), f = x - turn, head = f * 1.3;
  const age = (((turn - p.fixture) % n) + n) % n + f;            // turns since this arch's began
  const lit = age < 1 ? smoothstep(head, head - 0.05, p.u) : exp(-(age - 1) / P.fade);
  if (lit < 0.004) return null;
  const c = age < 1 ? mix(pal('colours', p.u), pal('colours', 1), exp(-((p.u - head) ** 2) * 600))
    : pal('colours', p.u);
  c[3] = lit;
  return c;
}
