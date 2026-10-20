// In turn: what is above it plays once per instance, each on its own clock from its own start, seen through a gate.
// Each is the parts of Tag (each group tagged it, or each smallest group of the one that is: each arch of the
// arches) or Drops landing at random spots, each in its own round frame spreading out to Reach. Starts come Every
// seconds: one instance after another (forward, back), at random, or all at once (together). The gate opens over
// Attack (flash: all at once; wipe and pass: a front crossing it in Direction), holds for Hold, then fades over
// Release (pass: a tail crosses after the front). Where drops overlap, the youngest drop that has reached a pixel
// takes it. The modules above run on the instance's time (their t and clock()), so they start with it; their LFOs
// still run on show time.
const params = {
  each: { value: 'groups', type: 'choice', options: ['groups', 'drops'], label: 'Each',
    help: 'groups: each part of Tag takes its turn; drops: drops land at random spots, each in its own round frame.' },
  tag: { value: 'arch', type: 'choice', label: 'Groups (tag)',
    options: ['arch', 'arch-main', 'arch-mini', 'arch-quad', 'tower', 'spire', 'spirelet', 'ring', 'rose', 'window',
      'front', 'back', 'left', 'right', 'ground-level', 'all'],
    help: 'Groups: which tagged groups take turns; a tag on one group (the arches) steps through its parts.' },
  drops: { value: 5, min: 1, max: 8, step: 1, label: 'Drops at once',
    help: 'Drops: how many are alive at once, each from its own spot. Low is a lone drop; high a downpour.' },
  reach: { value: 0.6, min: 0.1, max: 2, step: 0.05, label: 'Reach (share of the layer\'s longer side)',
    help: 'Drops: how far a drop spreads by its next start, the edge of its frame. Low is small rings; high wide.' },
  start: { value: 'forward', type: 'choice', options: ['forward', 'back', 'random', 'together'], label: 'Start',
    help: 'forward goes first to last and round; back goes last to first; random at random; together all at once.' },
  every: { value: 1, min: 0.05, max: 10, step: 0.05, label: 'Every (seconds from one start to the next)',
    help: 'How often one starts (together: all of them). Low races through them; high takes its time.' },
  gate: { value: 'wipe', type: 'choice', options: ['flash', 'wipe', 'pass'], label: 'Gate',
    help: 'flash shows it all at once; wipe reveals it in Direction; pass sends a band through and out in Direction.' },
  direction: { value: 'along', type: 'choice', options: ['up', 'down', 'out', 'in', 'along'], label: 'Direction',
    help: 'Which way a wipe or pass crosses: up or down the layer, out from or in to the middle, along each wire.' },
  attack: { value: 1, min: 0, max: 10, step: 0.05, label: 'Attack (seconds)',
    help: 'How long it takes to appear (wipe and pass: for the front to cross). 0 is instant; high a slow reveal.' },
  hold: { value: 0, min: 0, max: 10, step: 0.05, label: 'Hold (seconds)',
    help: 'How long it stays whole after its attack. 0 goes straight into the release; high lingers.' },
  release: { value: 1.5, min: 0, max: 10, step: 0.05, label: 'Release (seconds)',
    help: 'How long it takes to go (pass: for the tail to cross). 0 cuts it off; high leaves a long glowing wake.' },
};

const SOFT = 0.05;                                       // a wipe's edge, a share of the way across
const CY = new Float64Array(8), CZ = new Float64Array(8), AGE = new Float64Array(8);
let on = 0, R = 1, C = 1;

/** Where instance i of n starts in its cycle, 0..1. */
const offset = (i, n, start) => (start === 'forward' ? i / n : start === 'back' ? (n - 1 - i) / n
  : start === 'random' ? rand(i, 7) : 0);
/** Instance i of n at time t: its cycle's length (C), the cycle it is in, and its age in it (seconds). */
function cycle(i, n, t, P) {
  C = P.start === 'together' ? P.every : n * P.every;
  const x = t / C - offset(i, n, P.start), c = floor(x);
  return [c, (x - c) * C];
}

function frame(t, P) {
  if (P.each !== 'drops') return;
  const [lo, hi] = extent();
  on = round(P.drops);
  R = max(0.05, P.reach * max(hi[1] - lo[1], hi[2] - lo[2]));
  for (let s = 0; s < on; s++) {
    const [c, age] = cycle(s, on, t, P);
    AGE[s] = age;
    CY[s] = lo[1] + (0.1 + 0.8 * rand(s, c, 2)) * (hi[1] - lo[1]);
    CZ[s] = lo[2] + (0.1 + 0.8 * rand(s, c, 1)) * (hi[2] - lo[2]);
  }
}

/** How much of an instance shows at q, age seconds into it: the envelope, a front and tail crossing in Direction. */
function gateAt(q, age, P) {
  const x = toward(q, P.direction), front = (f) => clamp((f * (1 + SOFT) - x) / SOFT);
  const open = age / max(P.attack, 1e-6), shut = (age - P.attack - P.hold) / max(P.release, 1e-6);
  if (P.gate === 'flash') return min(clamp(open), 1 - clamp(shut));
  return front(open) * (P.gate === 'pass' ? 1 - front(shut) : 1 - clamp(shut));
}

function warp(q, t, P) {
  let age = 0;
  if (P.each === 'drops') {
    let best = -1;
    for (let s = 0; s < on; s++) {                       // the youngest drop that has spread this far
      const d = hypot(q.Y - CY[s], q.Z - CZ[s]) / R;
      if (d <= min(1, AGE[s] / C + 0.08) && (best < 0 || AGE[s] < AGE[best])) best = s;
    }
    if (best < 0) { q.gate = 0; return; }
    const dy = q.Y - CY[best], dz = q.Z - CZ[best];     // a new frame round the drop (SPEC "Modules")
    q.oy = q.cy = CY[best]; q.oz = q.cz = CZ[best]; q.sy = q.sz = q.sr = R;
    q.ly = 0.5 + dy / (2 * R); q.lz = 0.5 + dz / (2 * R);
    q.r = hypot(dy, dz) / R; q.a = fract(atan2(dz, dy) / TAU);
    age = AGE[best];
  } else {
    const g = q.part(P.tag);
    if (g < 0) { q.gate = 0; return; }
    age = cycle(g, q.parts(P.tag), t, P)[1];
  }
  q.gate *= gateAt(q, age, P);
  q.dt += age - t;                                       // the modules above run on the instance's own time
}
