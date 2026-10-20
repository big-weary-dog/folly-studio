// Fireflies: each light blinks on its own rhythm, a little faster or slower than Rate, and a blink pulls the lights
// it neighbours (links(): along the wiring, or between a tag's groups) toward their next blink, by Pull and more the
// nearer they were to it. Clusters fall into step, then strands and arches, until the whole map pulses together;
// every Scatter seconds the swarm is shaken back into disorder and searches for step again. By picks the lights: each
// LED, or each group of a tag blinking as one. A blink lasts Flash, in a colour from Colours for each light.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours',
    help: 'Each light blinks in its own colour from the list, picked at random. One colour for one swarm.' },
  pull: { value: 0.2, min: 0, max: 0.5, step: 0.01, label: 'Pull',
    help: 'How hard neighbours pull a light toward their rhythm. 0 never syncs; 0.2 syncs in seconds; high, at once.' },
  rate: { value: 40, min: 6, max: 90, step: 1, label: 'Rate (blinks a minute)',
    help: 'How often each light blinks, on average. In step the whole map blinks this often: keep it calm.' },
  spread: { value: 0.1, min: 0, max: 0.25, step: 0.01, label: 'Spread',
    help: 'How different each light\'s own rhythm is. 0 all alike; high, a wide mix that takes longer to agree.' },
  scatter: { value: 20, min: 0, max: 120, step: 1, label: 'Scatter (seconds)',
    help: 'How often the swarm is shaken back into disorder. 0 never: once in step it stays in step.' },
  by: { value: 'led', type: 'choice', label: 'By',
    options: ['led', 'arch', 'arch-main', 'arch-mini', 'tower', 'spire', 'spirelet', 'ring', 'rose', 'window'],
    help: 'led: every LED is a firefly; a tag: each of its groups (each arch, each spire) blinks as one.' },
  flash: { value: 0.35, min: 0.05, max: 1, step: 0.01, label: 'Flash (seconds)',
    help: 'How long a blink lasts. Short is a spark; long, a soft glow that fades.' },
};

const HZ = 60, WARM = 30 * HZ;          // steps a second; a jump further than WARM starts again WARM steps back
const NEAR = 0.03;         // a light's own share of the rhythm it feels, so that reaches about 1 / √NEAR links
let map = null, done = 0, phase, fired, zr, zi, nr, ni;

// A new swarm from step `from`: each light at a random point in its rhythm, none blinking.
function reset(L, from) {
  map = L; done = from;
  phase = new Float32Array(L.count); fired = new Int32Array(L.count).fill(-1e9);
  zr = new Float32Array(L.count); zi = new Float32Array(L.count); nr = new Float32Array(L.count);
  ni = new Float32Array(L.count);
  for (let j = 0; j < L.idx.length; j++) phase[L.idx[j]] = rand(L.idx[j], from, 3);
}

// Each light feels its neighbourhood's rhythm (a field passed along the map, link by link) and is pulled toward it:
// sped up when behind, held back when ahead (Kuramoto), so neighbours agree and agreement spreads.
function step(P, tick) {
  const { idx, off, nb } = map, base = P.rate / 60 / HZ, rc = cos(TAU * base), rs = sin(TAU * base);
  for (let j = 0; j < idx.length; j++) {           // the field moves on a step at the usual rate, so it never lags
    const u = idx[j], d = off[u + 1] - off[u];
    let sr = 0, si = 0;
    for (let e = off[u]; e < off[u + 1]; e++) { sr += zr[nb[e]]; si += zi[nb[e]]; }
    const own = d ? NEAR : 1, th = TAU * phase[u];
    nr[u] = (d ? (1 - own) * (sr * rc - si * rs) / d : 0) + own * cos(th);
    ni[u] = (d ? (1 - own) * (sr * rs + si * rc) / d : 0) + own * sin(th);
  }
  for (let j = 0; j < idx.length; j++) {
    const u = idx[j], th = TAU * phase[u];
    zr[u] = nr[u]; zi[u] = ni[u];
    phase[u] += base * (1 + P.spread * (2 * rand(u, 5) - 1) + 4 * P.pull * (zi[u] * cos(th) - zr[u] * sin(th)));
    if (phase[u] >= 1) { phase[u] -= 1; fired[u] = tick; }
    else if (phase[u] < 0) phase[u] += 1;
  }
}

// Every Scatter seconds a new swarm, so a frame sought to starts from the last scatter (or WARM back).
function frame(t, P) {
  const L = links(P.by === 'led' ? undefined : P.by), want = floor(t * HZ);
  const every = P.scatter > 0 ? max(1, round(P.scatter * HZ)) : 0;
  const from = max(every ? floor(want / every) * every : 0, want - WARM, 0);
  if (L !== map || want < done || done < from) reset(L, from);
  for (; done < want; done++) step(P, done);
}

function pixel(p, t, P) {
  const u = P.by === 'led' ? p.k : p.part(P.by);
  if (u < 0) return null;
  const age = (done - fired[u]) / HZ, f = age / P.flash;
  if (f >= 1) return null;
  const c = pal('colours', rand(u, 9));
  c[3] = (1 - f) * (1 - f);
  return c;
}
