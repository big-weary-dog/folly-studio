// Tendril: tendrils wander the layer at Speed, each trailing a body that tapers behind it: the last of Colours at its
// head, the first at its tail. Length is how long a trail it keeps.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'Colours each tendril: the head takes the last colour, its body fades back to the first at the tail.' },
  speed: { value: 0.2, min: 0.05, max: 1, step: 0.01, label: 'Speed (wanders a second)',
    help: 'How fast tendrils wander. Low drifts lazily; high darts about.' },
  tendrils: { value: 4, min: 1, max: 6, step: 1, label: 'Tendrils',
    help: 'How many wander at once. 1 is a lone tendril; 6 a tangle.' },
  length: { value: 0.3, min: 0.05, max: 1, step: 0.01, label: 'Length',
    help: 'How long a trail each keeps behind its head. Low is a short worm; high a long snaking body.' },
  width: { value: 0.08, min: 0.02, max: 0.3, step: 0.005, label: 'Width',
    help: 'How thick the head is (the body tapers behind it). Low is a thin thread; high a fat, bold stroke.' },
};

const K = 20, Y = new Float64Array(6 * K), Z = new Float64Array(6 * K);
let n = 0;
const at = (v) => clamp(0.5 + (v - 0.5) * 2.4);

// Each tendril's last K points along its noise path: the head now, the rest behind it.
function frame(t, P) {
  n = round(P.tendrils);
  for (let j = 0; j < n; j++) {
    for (let k = 0; k < K; k++) {
      const s = clock('speed') - k * P.length / K, o = j * K + k;
      Y[o] = at(noise(s + 31.7, j * 7.1, 1.9));
      Z[o] = at(noise(s - 17.3, j * 7.1, 3.7));
    }
  }
}

function pixel(p, t, P) {
  let best = 9, bk = 0;
  for (let o = 0; o < n * K; o++) {
    const dy = p.ly - Y[o], dz = p.lz - Z[o], d2 = dy * dy + dz * dz;
    if (d2 < best) { best = d2; bk = o % K; }
  }
  const age = bk / K, r = P.width * (1 - 0.7 * age), v = smoothstep(r, r * 0.2, sqrt(best));
  if (v <= 0.002) return null;
  const c = pal('colours', 1 - age);
  c[3] = v;
  return c;
}
