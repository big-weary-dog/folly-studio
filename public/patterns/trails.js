// Trails: whatever moves leaves a fading afterglow, like a long exposure.
//
// The filter remembers each LED's light (a buffer indexed by p.k) and lets it decay: after one
// second only `decay` of it is left. The chain shows the brighter of what it draws now and what
// is left. Trails are light (alpha 1), so lay the layer over others with add or max. Running time
// backward (a loop, a seek) starts the trails afresh.
const params = {
  decay: { value: 0.15, min: 0, max: 0.95, step: 0.01, label: 'Left after one second' },
};

let mem = new Float32Array(3 * 5000);
let last = NaN, keep = 0;

function frame(t, P) {
  const dt = t - last;
  keep = dt > 0 && dt < 1 ? pow(P.decay, dt) : 0;
  last = t;
}

function filter(c, q, t, P) {
  const o = 3 * q.k;
  if (o + 2 >= mem.length) {             // more LEDs than expected: grow once
    const more = new Float32Array(o + 3000);
    more.set(mem);
    mem = more;
  }
  for (let i = 0; i < 3; i++) {
    const now = c[i] * c[3], held = mem[o + i] * keep;
    c[i] = mem[o + i] = now > held ? now : held;
  }
  c[3] = 1;
  return c;
}
