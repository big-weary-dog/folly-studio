// The perf check's yardstick (test/e2e/perf.spec.js): runners differ about 2× in speed, so the worker's ms measure
// the runner as much as our code. In the sandbox's worker, the demo look's frames take turns with a fixed reference
// workload, a few ms each, in ABBA order within one task: whatever slows the worker meanwhile slows both alike, and
// the look is held to its cost as a multiple of the reference's.

/**
 * The reference: a pattern's worth of work at each of 4,870 LEDs (the Folly's count), five times over. Per-LED
 * inputs read from typed arrays as the core reads its scene, stdlib maths (a twist, a chase, a texture) and fresh
 * colour arrays, as stdlib's mix() makes, so the garbage collector and the caches get their share. Frozen: the
 * spec's MAX_RATIO and RUNNER_REF_MS were measured against exactly this code. Self-contained (no imports, no outer
 * names): its source text runs in the worker, where `reference()` builds the inputs once and returns the run.
 */
export function reference() {
  const n = 4870, tau = 2 * Math.PI;
  const at = (f) => Float64Array.from({ length: n }, (_, k) => f(k));
  const x = at((k) => (k % 70) / 69), y = at((k) => Math.floor(k / 70) / 69), z = at((k) => (k % 13) / 12);
  const a = at((k) => Math.atan2(y[k] - 0.5, x[k] - 0.5) / tau + 0.5);
  const r = at((k) => Math.hypot(x[k] - 0.5, y[k] - 0.5)), u = at((k) => (k % 97) / 96);
  const seed = at((k) => ((k * 2654435761) >>> 0) / 4294967296);
  const p = { lz: 0, ly: 0 }, kept = new Array(8);
  const sky = [0.04, 0.1, 0.35], glow = [0.9, 0.6, 0.2], white = [1, 1, 1];
  const mix = (c0, c1, v) => [c0[0] + (c1[0] - c0[0]) * v, c0[1] + (c1[1] - c0[1]) * v, c0[2] + (c1[2] - c0[2]) * v];
  const hash = (v) => { const h = Math.sin(v * 12.9898) * 43758.5453; return h - Math.floor(h); };
  const smooth = (v) => { const s = Math.min(1, Math.max(0, v)); return s * s * (3 - 2 * s); };
  return (t, out) => {
    for (let pass = 0; pass < 5; pass++, t += 0.025) {
      for (let k = 0; k < n; k++) {
        const turn = tau * (a[k] + 0.25 * r[k] + 0.05 * t);                          // a twist
        p.lz = 0.5 + 0.5 * r[k] * Math.sin(turn);
        p.ly = 0.5 + 0.5 * r[k] * Math.cos(turn);
        const v = Math.exp(-12 * Math.abs(((hash(seed[k]) + 0.3 * t) % 1) - u[k]));   // a chase
        const tex = smooth(hash(7.1 * p.lz + 3.3 * p.ly + z[k] + 0.1 * t));           // a texture
        const c = kept[k & 7] = mix(mix(sky, glow, tex), white, v);                 // kept: not optimised away
        out[k * 3] = c[0];
        out[k * 3 + 1] = c[1];
        out[k * 3 + 2] = c[2];
      }
    }
  };
}

/**
 * A timer for the reference (its source text too, given `reference`; it runs in the worker and on the page):
 * `time(t)` runs it once at time t and returns its ms, the first call after ten untimed runs, as the look's code is
 * warm by then.
 */
export function timer(reference) {
  const now = performance.now.bind(performance), out = new Float32Array(3 * 4870);
  let run = null;
  return (t) => {
    if (!run) {
      run = reference();
      for (let i = 0; i < 10; i++) run(t, out);
    }
    const t0 = now();
    run(t, out);
    return now() - t0;
  };
}

/**
 * In the worker, first in the probe's prelude (its source text too, given a `timer` and the worker's own
 * postMessage). On `perf-calibrate`: `pairs` of a look frame (the worker's own handler, at the last live frame's time)
 * and a reference run, ABBA, starting with either (`flip`); it answers `perf-calibrated` with each one's ms, a
 * frame's NaN if no layer ran (paused as hung). Returns what the prelude's postMessage checks first: true for a
 * calibration frame's reply, which stops here.
 */
export function calibrator(time, post) {
  const SEQ = -2;
  let t = 0, ms = 0;
  const frame = () => {
    self.dispatchEvent(new MessageEvent('message', { data: { type: 'frame', seq: SEQ, t } }));
    return ms;
  };
  self.addEventListener('message', (e) => {
    const m = e.data;
    if (m?.type === 'frame' && m.seq !== SEQ) t = m.t;
    if (m?.type !== 'perf-calibrate') return;
    const look = [], ref = [];
    for (let k = 0; k < m.pairs; k++) {
      const frameFirst = (k + m.flip) % 2 === 1;
      if (frameFirst) look.push(frame());
      ref.push(time(t));
      if (!frameFirst) look.push(frame());
    }
    post({ type: 'perf-calibrated', look, ref });
  });
  return (m) => !!m && m.type === 'frame' && m.seq === SEQ
    && ((ms = Object.keys(m.layerMs || {}).length ? m.ms : NaN), true);
}
