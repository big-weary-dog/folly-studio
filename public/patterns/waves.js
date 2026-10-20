// Waves: water on the rig's neighbour map (links()): each LED holds a height and how fast it is moving, pulled toward
// its neighbours' mean (waveStep), so ripples travel along the strands, cross where they touch, add where crests
// meet, cancel where a crest meets a trough, and bounce off the ends of each strand. Drops land at random, Size links
// wide; Settle calms the water. Height picks the colour, troughs the first of Colours and crests the last, and how
// far it is from calm how much it shows: calm water is clear.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'From the troughs (first) through the middle to the crests (last). Calm water shows nothing.' },
  drops: { value: 3, min: 0, max: 10, step: 0.1, label: 'Drops (a second)',
    help: 'How many drops land a second, across the layer. 0 lets the water settle to calm.' },
  speed: { value: 20, min: 1, max: 60, step: 1, label: 'Speed (LEDs a second)',
    help: 'How fast ripples travel, in LEDs a second along a strand. Low rolls slowly; high races.' },
  settle: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Settle',
    help: 'How quickly the water calms. 0 sloshes on and on; 1 lets each drop die out in about a second.' },
  bounce: { value: 0.7, min: 0, max: 1, step: 0.01, label: 'Bounce',
    help: 'How much of a ripple comes back off the end of a strand. 0 lets it run out; 1 bounces it all back.' },
  size: { value: 4, min: 1, max: 12, step: 1, label: 'Size (LEDs)',
    help: 'How wide each drop is, in LEDs from its middle. Small makes fine ripples; large, long swells.' },
};

const HZ = 60, WARM = 20 * HZ;          // steps a second; a jump further than WARM starts again WARM steps back
const LEAK = 1 - 0.3 / HZ;
let map = null, done = 0, h, v, ring, hop;

function reset(L, from) {
  map = L; done = from;
  h = new Float32Array(L.count); v = new Float32Array(L.count);
  ring = new Int32Array(L.count); hop = new Int32Array(L.count).fill(-1);
}

// A drop at LED k0: a smooth bump Size links wide, found link by link (hop: base + links from k0, for this drop).
function drop(k0, size, base) {
  const { off, nb } = map;
  let n = 1, i = 0;
  ring[0] = k0; hop[k0] = base;
  while (i < n) {
    const k = ring[i++], d = (hop[k] - base) / size;
    h[k] += 0.8 * (1 - d * d) * (1 - d * d);
    if (hop[k] - base >= size) continue;
    for (let e = off[k]; e < off[k + 1]; e++) {
      const j = nb[e];
      if (hop[j] < base) { hop[j] = hop[k] + 1; ring[n++] = j; }
    }
  }
}

function frame(t, P) {
  const L = links(), want = floor(t * HZ);
  if (L !== map || want < done || want - done > WARM) reset(L, max(0, want - WARM));
  const m = L.idx.length, size = round(P.size), chance = P.drops / HZ;
  for (; done < want; done++) {
    if (m && rand(done, 1) < chance) drop(L.idx[floor(rand(done, 2) * m)], size, done * 16);
    waveStep(L, h, v, P.speed / HZ, P.settle * P.settle * 4 / HZ, P.bounce);
    for (let j = 0; j < m; j++) h[L.idx[j]] *= LEAK;           // what drops add drains away, so calm stays clear
  }
}

function pixel(p, t, P) {
  const y = h[p.k], a = smoothstep(0.02, 0.25, abs(y));
  if (a <= 0) return null;
  const c = pal('colours', clamp(0.5 + 1.5 * y));
  c[3] = a;
  return c;
}
