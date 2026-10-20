// Wildfire: light spreads from LED to neighbouring LED (links(): along each strand and across to strands it touches)
// like fire through a dry forest. A step at a time, at Speed, an LED catches from burning neighbours within Reach
// links, by Spread for each; it burns for Burn, rests for Rest, then can catch again; Sparks start fires by
// themselves. Fronts creep along the strands, jump where they touch and curl round loops. Burning runs from the last
// of Colours (fresh flame) to the middle; resting fades from the middle to the first.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'From the resting embers (first) to the fresh flame (last). Order it dark to bright.' },
  spread: { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Spread',
    help: 'The chance a burning LED lights each neighbour a step. Low gives scattered flickers; high, fronts.' },
  burn: { value: 0.4, min: 0.05, max: 3, step: 0.01, label: 'Burn (seconds)',
    help: 'How long an LED stays alight. Short gives thin fronts; long, thick bands of flame.' },
  rest: { value: 1.5, min: 0.1, max: 10, step: 0.1, label: 'Rest (seconds)',
    help: 'How long a burnt LED waits before it can catch again. Short lets fires chase each other round loops.' },
  sparks: { value: 2, min: 0, max: 5, step: 0.05, label: 'Sparks (a second)',
    help: 'How many new fires start by themselves a second, across the layer. 0 lets the fires die out.' },
  speed: { value: 20, min: 0, max: 60, step: 1, label: 'Speed (steps a second)',
    help: 'How many steps a second the fire takes, one LED a step along a strand. 0 freezes it.' },
  reach: { value: 1, min: 1, max: 4, step: 1, label: 'Reach (links)',
    help: 'How many links away a burning LED can light another. 1 creeps LED by LED; more leaps ahead in sparks.' },
};

const WARM = 600;                // steps: a jump further than this starts again this many steps back
let map = null, done = 0, state, left, len, near;     // per LED: 0 ready, 1 burning, 2 resting; steps left of how many

function reset(L, from) {
  map = L; done = from;
  state = new Uint8Array(L.count); left = new Int16Array(L.count); len = new Int16Array(L.count);
  near = new Uint8Array(L.count);
  for (let j = 0; j < L.idx.length; j++) if (rand(L.idx[j], from, 3) < 3 / L.idx.length) light(L.idx[j], 1, 6);
}
const light = (k, s, n) => { state[k] = s; left[k] = len[k] = n; };

function step(P, tick) {
  const { idx, off, nb } = map, reach = round(P.reach), m = idx.length;
  const burn = max(1, round(P.burn * P.speed)), rest = max(1, round(P.rest * P.speed));
  const spark = P.speed > 0 ? P.sparks / (P.speed * m) : 0;
  for (let j = 0; j < m; j++) near[idx[j]] = state[idx[j]] === 1 ? 0 : 255;
  for (let r = 1; r < reach; r++) {            // links to the nearest burning LED, up to reach − 1
    for (let j = 0; j < m; j++) {
      const k = idx[j];
      if (near[k] !== 255) continue;
      for (let e = off[k]; e < off[k + 1]; e++) if (near[nb[e]] === r - 1) { near[k] = r; break; }
    }
  }
  for (let j = 0; j < m; j++) {
    const k = idx[j];
    if (state[k]) {
      if (--left[k] > 0) continue;
      if (state[k] === 1) light(k, 2, rest);
      else state[k] = 0;
      continue;
    }
    let n = 0;
    for (let e = off[k]; e < off[k + 1]; e++) if (near[nb[e]] < reach) n++;
    if (rand(k, tick, 1) < 1 - pow(1 - P.spread, n) || rand(k, tick, 2) < spark) light(k, 1, burn);
  }
}

function frame(t, P) {
  const L = links(), want = floor(clock('speed'));
  if (L !== map || want < done || want - done > WARM) reset(L, max(0, want - WARM));
  for (; done < want; done++) step(P, done);
}

function pixel(p, t, P) {
  const s = state[p.k];
  if (!s) return null;
  const f = clamp((len[p.k] - left[p.k] + fract(clock('speed'))) / len[p.k]);
  const c = pal('colours', s === 1 ? 1 - f / 2 : (1 - f) / 2);
  c[3] = s === 1 ? 1 : (1 - f) * (1 - f);
  return c;
}
