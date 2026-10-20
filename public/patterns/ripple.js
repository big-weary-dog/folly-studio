// Ripple: drops land at random spots and spread rings at Speed, each fading as it grows: strong crests in the last of
// Colours, faint rings toward the first. Rings are round, measured in the layer's longer side; Drops is how many
// spread at once.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'Colours the rings: young rings near their drop take the last colour, wide fading ones drift to the first.' },
  speed: { value: 0.25, min: 0.05, max: 1, step: 0.01, label: 'Speed (layers a second)',
    help: 'How fast rings spread. Low swells gently; high sends rings racing out and new drops landing more often.' },
  drops: { value: 5, min: 1, max: 8, step: 1, label: 'Drops at once',
    help: 'How many rings spread at once, each from its own random spot. Low is a lone drop; high a downpour.' },
  width: { value: 0.05, min: 0.005, max: 0.15, step: 0.005, label: 'Ring width',
    help: 'How thick each ring is. Low draws fine sharp circles; high draws broad soft swells.' },
};

const REACH = 0.6;                                // how far a ring spreads before its drop lands again elsewhere
const CZ = new Float64Array(8), CY = new Float64Array(8), R = new Float64Array(8);
let on = 0;

function frame(t, P) {
  on = round(P.drops);
  for (let s = 0; s < on; s++) {
    const x = clock('speed') / REACH + rand(s, 7), c = floor(x);
    R[s] = (x - c) * REACH;
    CZ[s] = 0.1 + 0.8 * rand(s, c, 1);
    CY[s] = 0.1 + 0.8 * rand(s, c, 2);
  }
}

function pixel(p, t, P) {
  const u = 2 * max(p.sy, p.sz) || 1, z = (p.Z - p.oz) / u, y = (p.Y - p.oy) / u;     // round, in metres
  let v = 0;
  for (let s = 0; s < on; s++) {
    const d = hypot(z - (CZ[s] - 0.5) * 2 * p.sz / u, y - (CY[s] - 0.5) * 2 * p.sy / u);
    if (d > R[s] + 3 * P.width) continue;
    const x = (d - R[s]) / P.width;
    v += exp(-x * x) * exp(-R[s] * 3.2);
  }
  if (v < 0.004) return null;
  const c = pal('colours', 0.3 + 0.7 * min(1, v));
  c[3] = min(1, v);
  return c;
}
