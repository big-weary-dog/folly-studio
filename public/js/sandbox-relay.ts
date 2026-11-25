// The pattern sandbox's relay and watchdog (SPEC "Sandbox protocol"), on the app page. Pattern code never runs on
// this thread, which a `while (true) {}` would freeze: it runs in a module Worker (sandbox-worker.ts) served under a
// CSP of its own, with no network (src/static.ts). The relay passes messages and keeps time. On an overrun it
// terminates the worker, blames a layer (the one compiling, or each run alone: sandbox-probe.ts), reports it as
// hung, and starts a fresh worker with the others.
import { extrasOf } from '../../shared/plays.ts';
import type { Rig } from '../../shared/schemas/rig.ts';
import type { Extra, ToSandbox } from './runtime.ts';
import {
  compiledReport, enabled, frameAnswer, frameErrors, type FromWorker, type Layer, type Paused, renderedAnswer, text,
} from './sandbox-messages.ts';
import { openProber } from './sandbox-probe.ts';

/** A request to the worker, as the relay tracks it: `at` is when the worker started on it. */
type Job = { at: number; overdue?: boolean; internal?: boolean; answered?: boolean; seq?: number; look?: Layer[];
  answerBy?: number } & ({ type: 'init'; msg: object } | { type: 'look'; layers: Layer[]; extra: Extra;
  compiling?: string } | { type: 'frame'; seq: number; t: number; answerBy: number }
  | { type: 'render'; seq: number; start: number; fps: number; done: number; sentDone: number; sentAt: number;
    bytes: number; msg: object });

const FRAME_BUDGET_MS = 1000;   // a frame (live or export) running longer than this has hung
const LOOK_BUDGET_MS = 700;     // compiling a look's new code
const INIT_BUDGET_MS = 6000;    // preparing the scene (no pattern code runs)
const ANSWER_MS = 1500;         // every frame request is answered by then (runtime.ts waits longer)
const PROGRESS_EVERY = 40;      // export progress goes to the app every 40 frames or 250 ms
const PROGRESS_MS = 250;
const STRIKE_WINDOW_MS = 30000; // unexplained hangs: restart once, then pause the suspects
const TICK_MS = 100;
const FROZEN_GAP_MS = 600;      // a tick this late means this thread was busy or frozen: no blame

/** The relay: `post` takes the app's messages, `toApp` gets its answers; `close` ends it, its workers too. */
export type Sandbox = { post: (msg: ToSandbox) => void; close: () => void };

/** A pattern worker: one place for the URL, so the build emits it once (sandbox-worker-<hash>.js). */
const spawnWorker = (name: string) => new Worker(new URL('./sandbox-worker.ts', import.meta.url),
  { type: 'module', name });

export function openSandbox(send: (msg: object) => void): Sandbox {
  const now = () => performance.now();

  let rig: Rig | null = null;
  let library: { name: string; code: string }[] = [];   // library sources for use(), from init
  let count = 0;
  let worker: Worker | null = null;
  let jobs: Job[] = [];       // sent to `worker`, oldest first; the head is what it is working on
  let held: Job[] | null = null;  // jobs that arrived while finding a culprit (null when not recovering)
  let sentLook: Layer[] = []; // layers of the newest look given to the worker (as the app sent them)
  let baseLook: Layer[] = []; // layers of the newest look the worker finished
  let baseExtra: Extra = {};  // and its globals, automation and bpm
  const hung = new Map<string, Paused>();       // id -> paused until its code changes
  const loadHangs = new Map<string, string>();  // code -> error, for code whose top level hung (deterministic)
  const schemas = new Map<string, object>();    // id -> last params schema, reported for paused layers
  let strikes: number[] = [];
  let timer = 0;
  let lastTick = 0;
  let closed = false;
  const prober = openProber(spawnWorker);
  const toApp = (msg: object) => { if (!closed) send(msg); };
  const frameMsg = { type: 'frame', seq: 0, t: 0 };   // every frame request, filled in as it goes

  function close() {
    closed = true;
    prober.close();
    worker?.terminate();
    worker = null;
    jobs = [];
    held = null;
    clearInterval(timer);
    timer = 0;
  }

  function startWorker() {
    let w: Worker, spoke = false;
    try {
      w = spawnWorker('folly-patterns');
    } catch (e) {
      toApp({ type: 'error', error: `The pattern worker could not start: ${(e as Error)?.message || e}` });
      return null;
    }
    w.onmessage = (e) => { spoke = true; onWorker(w, e.data); };
    w.onerror = (e) => {
      e.preventDefault();       // stray async errors from pattern code
      if (spoke || w !== worker) return;
      toApp({ type: 'error', error: 'The pattern worker could not load. Reload the page to try again.' });
      close();                  // its script did not load: a fresh one would not either
    };
    return w;
  }

  const layerId = (l: Layer, n: number) => (l && l.id !== undefined ? l.id : 'layer-' + n);
  /** All of a layer's code, its modules' or its own: what a pause is keyed on. */
  const codeOf = (l: Layer) => (Array.isArray(l.modules)
    ? l.modules.map((m) => (m && typeof m.code === 'string' ? m.code : '')).join('\u0000')
    : typeof l.code === 'string' ? l.code : '');

  /** Why a layer is held back from the worker, or null. */
  function paused(l: Layer): Paused | null {
    const load = loadHangs.get(codeOf(l));
    if (load) return { load: true, error: load };
    const h = hung.get(l.id);
    return h && h.code === codeOf(l) ? h : null;
  }
  /** `paused`, or null while no layer is: a frame then skips the look. */
  const pausedOf = () => (hung.size || loadHangs.size ? paused : null);

  function post(job: Job) {
    if (!worker) return;
    if (job.type === 'look') {
      job.compiling = undefined;
      sentLook = job.layers;
      worker.postMessage({ type: 'look', layers: job.layers.filter((l) => !paused(l)), ...job.extra });
    } else if (job.type === 'frame') {
      job.look = sentLook;
      frameMsg.seq = job.seq;
      frameMsg.t = job.t;
      worker.postMessage(frameMsg);   // cloned now, so the object is reused
    } else {
      if (job.type === 'render') job.look = sentLook;
      worker.postMessage(job.msg);
    }
    if (!jobs.length) job.at = now();
    jobs.push(job);
    tickOn();
  }

  function fromApp(msg: ToSandbox) {
    let job: Job;
    switch (msg.type) {
      case 'init':
        worker ??= startWorker();
        rig = msg.rig;
        library = Array.isArray(msg.library) ? msg.library : [];
        count = rig && rig.count > 0 ? rig.count | 0 : 0;
        job = { type: 'init', at: 0, msg: { type: 'init', rig, library } };
        break;
      case 'look': {
        // Layer objects pass through intact (clips, params, …); only a missing id is filled in.
        const layers = (Array.isArray(msg.layers) ? msg.layers : [])
          .filter((l) => l && typeof l === 'object')
          .map((l, n) => (l.id !== undefined ? l : { ...l, id: layerId(l, n) }));
        for (const [id, h] of hung) {
          const l = layers.find((x) => x.id === id);
          if (!l || codeOf(l) !== h.code) hung.delete(id);  // edited or gone: give it another go
        }
        job = { type: 'look', at: 0, layers, extra: extrasOf(msg) };
        break;
      }
      case 'frame':
        job = { type: 'frame', at: 0, seq: msg.seq, t: +msg.t || 0, answerBy: now() + ANSWER_MS };
        break;
      case 'render':
        job = { type: 'render', at: 0, seq: msg.seq, start: +msg.start || 0, fps: +msg.fps > 0 ? +msg.fps : 40,
          done: 0, sentDone: 0, sentAt: now(), msg, bytes: Math.max(0, Math.floor(+msg.frames || 0))
            * (rig ? rig.output.universes * rig.output.channelsPerUniverse : 0) };
        break;
      default:
        return;
    }
    if (held) { held.push(job); tickOn(); } else post(job);
  }


  function onWorker(w: Worker, m: FromWorker) {
    if (w !== worker || !m || typeof m !== 'object') return;
    const job = jobs[0];
    if (!job) return;
    switch (m.type) {
      case 'compiling':
        if (job.type === 'look' && typeof m.id === 'string') job.compiling = m.id;
        return;
      case 'progress':
        if (job.type !== 'render' || m.seq !== job.seq || !(Number(m.done) > job.done)) return;
        job.done = Number(m.done);
        job.at = now();
        if (!job.answered && (job.done - job.sentDone >= PROGRESS_EVERY || job.at - job.sentAt >= PROGRESS_MS)) {
          job.sentDone = job.done;
          job.sentAt = job.at;
          toApp({ type: 'progress', seq: job.seq, done: job.done });
        }
        return;
      case 'ready': if (job.type !== 'init') return; break;
      case 'compiled': if (job.type !== 'look') return; break;
      case 'frame': if (job.type !== 'frame' || m.seq !== job.seq) return; break;
      case 'rendered': if (job.type !== 'render' || m.seq !== job.seq) return; break;
      case 'error': if (m.request !== job.type) return; break;
      default: return;
    }
    jobs.shift();
    if (jobs.length) jobs[0].at = now();     // the next job's clock starts now
    finish(job, m);
  }

  function finish(job: Job, m: FromWorker) {
    if (job.type === 'look' && m.type === 'compiled') {
      baseLook = job.layers;
      baseExtra = job.extra;
      for (const r of Array.isArray(m.layers) ? m.layers : []) {
        if (r && r.ok && typeof r.id === 'string' && r.params && typeof r.params === 'object') {
          schemas.set(r.id, r.params);
        }
      }
    }
    if (job.internal || job.answered) return;
    const fail = (error: string) => toApp({ type: 'error', seq: job.seq, request: job.type, error });
    if (m.type === 'ready') toApp({ type: 'ready' });
    else if (m.type === 'compiled' && job.type === 'look') {
      toApp({ type: 'compiled', layers: compiledReport(job.layers, m.layers, pausedOf(), schemas) });
    } else if (m.type === 'frame' && job.type === 'frame') {
      toApp(frameAnswer(m, job.seq, count, job.look || [], pausedOf()));
    } else if (m.type === 'rendered' && job.type === 'render') {
      const answer = renderedAnswer(m, job.seq, job.bytes, job.look || [], pausedOf());
      if (typeof answer === 'string') fail(answer); else toApp(answer);
    } else if (m.type === 'error') fail(text(m.error));
  }

  function answerBlack(job: Job) {
    job.answered = true;
    const rgb = new Float32Array(count * 3);
    toApp({ type: 'frame', seq: job.seq, rgb, errors: frameErrors([], job.look || sentLook, pausedOf()), ms: 0 });
  }

  function tickOn() {
    if (timer) return;
    lastTick = now();
    timer = window.setInterval(tick, TICK_MS);
  }

  function tick() {
    const t = now();
    const gap = t - lastTick;
    lastTick = t;
    if (gap > FROZEN_GAP_MS) {
      // This thread (shared with the app) was busy, throttled or frozen. Whatever the worker did
      // meanwhile may still be queued for us, so restart the clocks instead of blaming patterns.
      for (const j of jobs) { j.at += gap; j.overdue = false; if (j.answerBy) j.answerBy += gap; }
      for (const j of held || []) if (j.answerBy) j.answerBy += gap;
      return;
    }
    for (const j of jobs) if (j.type === 'frame' && !j.answered && t > j.answerBy) answerBlack(j);
    for (const j of held || []) if (j.type === 'frame' && !j.answered && t > j.answerBy) answerBlack(j);
    const head = jobs[0];
    if (head && !held) {
      const budget = head.type === 'init' ? INIT_BUDGET_MS : head.type === 'look' ? LOOK_BUDGET_MS : FRAME_BUDGET_MS;
      if (t - head.at > budget) {
        // Overdue on two ticks in a row: a reply already queued behind this tick gets its chance.
        if (head.overdue) { onHang(head); return; }
        head.overdue = true;
      }
    }
    if (!jobs.length && !held) { clearInterval(timer); timer = 0; }
  }

  async function onHang(job: Job) {
    if (worker) worker.terminate();
    worker = null;
    const pending = jobs;
    jobs = [];
    held = [];
    let renderError = '';
    if (job.type === 'look') {
      // The worker says which layer it was compiling; top-level code hangs the same way each time.
      const l = job.layers.find((x) => x.id === job.compiling);
      if (l) {
        remember(loadHangs, codeOf(l), 'Pattern hung while loading: its top-level code ran for over 1 s, '
          + 'so this version is paused. Edit the code to try again.');
      }
    } else if (job.type === 'frame' || job.type === 'render') {
      const t = job.type === 'frame' ? job.t : job.start + job.done / job.fps;
      const suspects = (job.look || []).filter((l) => enabled(l) && !paused(l));
      let culprits = suspects.length === 1 ? suspects : await prober.probeAll(suspects, t,
        (l) => [{ type: 'init', rig, library }, { type: 'look', layers: [l], ...baseExtra }]);
      if (closed) return;
      let error = `Pattern hung: a frame took over 1 s (at ${t.toFixed(2)} s), so this layer is paused. `
        + 'Edit its code to try again.';
      if (!culprits.length && suspects.length) {
        strikes = strikes.filter((s) => now() - s < STRIKE_WINDOW_MS);
        strikes.push(now());
        if (strikes.length >= 2) {
          strikes = [];
          culprits = suspects;
          error = 'Pattern hung: frames kept taking over 1 s but no single layer hangs on its own, so the look may be '
            + 'too heavy for this device. Paused; edit the code to try again.';
        } else if (job.type === 'frame') {
          const error = 'A frame took over 1 s, so the pattern engine restarted.';
          toApp({ type: 'error', seq: job.seq, request: 'frame', error });
        }
      }
      for (const l of culprits) hung.set(l.id, { code: codeOf(l), error, params: schemas.get(l.id) });
      if (job.type === 'render') {
        const names = culprits.map((l) => `“${l.title || l.id}”`).join(', ');
        renderError = culprits.length ? `Export stopped: ${names} hung at ${t.toFixed(2)} s and `
          + `${culprits.length > 1 ? 'are' : 'is'} paused now. Fix the code and export again.`
          : 'Export stopped: a frame took over 1 s. Try again, or simplify the look.';
      }
    }
    restart(pending, job, renderError);
  }

  function remember<K, V>(map: Map<K, V>, key: K, value: V) {
    map.delete(key);
    map.set(key, value);
    while (map.size > 16) map.delete(map.keys().next().value!);
  }

  function restart(pending: Job[], hungJob: Job, renderError: string) {
    const queue = held || [];
    held = null;
    worker = startWorker();
    if (!worker) return;
    if (rig) post({ type: 'init', at: 0, internal: true, msg: { type: 'init', rig, library } });
    post({ type: 'look', at: 0, internal: true, layers: baseLook, extra: baseExtra });
    for (const j of pending) {
      if (j.internal || j.answered) continue;
      if (j === hungJob && j.type === 'render') {
        const error = renderError || 'Export stopped: the pattern engine restarted.';
        toApp({ type: 'error', seq: j.seq, request: 'render', error });
        continue;
      }
      j.overdue = false;
      if (j.type === 'render') { j.done = 0; j.sentDone = 0; }
      post(j);
    }
    for (const j of queue) if (!j.answered) post(j);
  }

  return {
    post: (msg) => { if (!closed && msg && typeof msg === 'object' && typeof msg.type === 'string') fromApp(msg); },
    close,
  };
}
