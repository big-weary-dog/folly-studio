// Tendril: tendrils wander across the layer's façade (lz, ly, through every depth) on smooth noise; frame() keeps
// each head's last `length` seconds and LEDs light by distance to that trail, over the low colour at `sky`.
// tendrils, thick (plus energy), speed.
const params = {
  tendrils: { value: 4, min: 1, max: 6, step: 1 },
  length: { value: 1.5, min: 0.2, max: 4, step: 0.1, label: 'Trail (seconds)' },
  thick: { value: 0.08, min: 0.02, max: 0.3, step: 0.005, label: 'Thickness' },
  speed: { value: 0.2, min: 0.05, max: 1, step: 0.01, label: 'Wander' },
  sky: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Bed brightness' },
};

const K = 20, Y = new Float64Array(6 * K), Z = new Float64Array(6 * K);
let n = 0;
const at = (v) => clamp(0.5 + (v - 0.5) * 2.4);

function frame(t, P) {
  n = round(P.tendrils);
  for (let j = 0; j < n; j++) {
    for (let k = 0; k < K; k++) {
      const s = (t - k * P.length / K) * P.speed, o = j * K + k;
      Y[o] = at(noise(s + 31.7, j * 7.1, 1.9));
      Z[o] = at(noise(s - 17.3, j * 7.1, 3.7));
    }
  }
}

function pixel(p, t, P, G) {
  let best = 9, bk = 0;
  for (let o = 0; o < n * K; o++) {
    const dy = p.ly - Y[o], dz = p.lz - Z[o], d2 = dy * dy + dz * dz;
    if (d2 < best) { best = d2; bk = o % K; }
  }
  const age = bk / K, r = P.thick * (1 - 0.7 * age) * (0.7 + 0.6 * G.energy);
  const v = smoothstep(r, r * 0.2, sqrt(best));
  const c = mix(scale(pal('low', p.ly), P.sky), mix(pal('accent', age), pal('body', age), age), v);
  return mix(c, pal('high'), v * smoothstep(0.3, 0, age));
}
