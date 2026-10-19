// The pattern sandbox's page script (SPEC "Sandbox protocol"): the relay and the watchdog. It runs inline in
// sandbox.html, an <iframe sandbox="allow-scripts"> under a CSP of default-src 'none' (src/static.ts), so pattern
// code runs at an opaque origin with no network or storage. Vite builds it, and the Worker, into the page
// (tools/vite-sandbox.ts). Pattern code never runs on this page's thread, which it shares with the app: a
// `while (true) {}` would freeze the tab. It runs in a Worker made from a Blob, and this page relays and keeps time.
// On an overrun it terminates the worker, blames a layer (the one compiling, or each run alone in a throwaway
// worker), reports it as hung, and starts a fresh worker with the others. It exports nothing: it is a script.
import type { Rig } from '../../shared/schemas/rig.ts';
import type { Extra, FrameError, ToSandbox } from './runtime.ts';

type Layer = Extract<ToSandbox, { type: 'look' }>['layers'][number];
/** A request to the worker, as the relay tracks it: `at` is when the worker started on it. */
type Job = { at: number; overdue?: boolean; internal?: boolean; answered?: boolean; seq?: number; look?: Layer[];
  answerBy?: number } & ({ type: 'init'; msg: object } | { type: 'look'; layers: Layer[]; extra: Extra;
  compiling?: string } | { type: 'frame'; seq: number; t: number; answerBy: number; msg: object }
  | { type: 'render'; seq: number; start: number; fps: number; done: number; sentDone: number; sentAt: number;
    msg: object });
/** What the worker says: pattern code shares its thread and can post too, so every field is checked. */
type FromWorker = { type: 'ready' | 'compiled' | 'frame' | 'rendered' | 'progress' | 'compiling' | 'error';
  id?: string; seq?: number; done?: number; layers?: unknown; rgb?: unknown; errors?: unknown; ms?: number;
  layerMs?: unknown; channels?: unknown; frames?: number; channelCount?: number; request?: string; error?: unknown };
type Reported = { id?: string; ok?: unknown; error?: unknown; params?: unknown; modules?: unknown };
/** Why a layer is held back: it hung (until its code changes), or its top-level code did (`load`). */
type Paused = { error: string; code?: string; params?: object; load?: true };

const app = window.parent;
let port: MessagePort | null = null; // from the app's init: all else goes this way (window messages are slow)
const toApp = (msg: object, transfer: Transferable[] = []) => (port ? port.postMessage(msg, transfer)
  : app.postMessage(msg, '*', transfer));

const FRAME_BUDGET_MS = 1000;   // a frame (live or export) running longer than this has hung
const LOOK_BUDGET_MS = 700;     // compiling a look's new code
const INIT_BUDGET_MS = 6000;    // preparing the scene (no pattern code runs)
const ANSWER_MS = 1500;         // every frame request is answered by then (runtime.ts waits longer)
const PROBE_MS = 600;           // one layer alone: compile + one frame, once its scene is ready
const PROBE_START_MS = 5000;    // a probe worker that cannot even start is inconclusive
const PROBE_PARALLEL = 4;
const PROGRESS_EVERY = 40;      // export progress goes to the app every 40 frames or 250 ms
const PROGRESS_MS = 250;
const STRIKE_WINDOW_MS = 30000; // unexplained hangs: restart once, then pause the suspects
const TICK_MS = 100;
const FROZEN_GAP_MS = 600;      // a tick this late means this thread was busy or frozen: no blame

// The Worker's script: js/sandbox-worker.ts and the core, built as one classic script (tools/vite-sandbox.ts) into
// the data block. Classic, because module workers cannot start from a blob at an opaque origin; everything in it
// sits in one function scope, where pattern code (compiled with new Function, at global scope) cannot see it.
const workerSource = document.getElementById('pattern-worker')?.textContent ?? '';
const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
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

function startWorker() {
  let w: Worker;
  try {
    w = new Worker(workerUrl, { name: 'folly-patterns' });
  } catch (e) {
    toApp({ type: 'error', error: `The pattern worker could not start: ${(e as Error)?.message || e}` });
    return null;
  }
  w.onmessage = (e) => onWorker(w, e.data);
  w.onerror = (e) => { e.preventDefault(); };    // stray async errors from pattern code
  return w;
}

const layerId = (l: Layer, n: number) => (l && l.id !== undefined ? l.id : 'layer-' + n);
/** All of a layer's code, its modules' or its own: what a pause is keyed on. */
const codeOf = (l: Layer) => (Array.isArray(l.modules)
  ? l.modules.map((m) => (m && typeof m.code === 'string' ? m.code : '')).join('\u0000')
  : typeof l.code === 'string' ? l.code : '');
const lookExtra = (m: Extra): Extra => ({ globals: m.globals, automation: m.automation, bpm: m.bpm });
const enabled = (l: Layer) => l.enabled !== false
  && (typeof l.level === 'number' && Number.isFinite(l.level) ? l.level > 0 : true);

/** Why a layer is held back from the worker, or null. */
function paused(l: Layer): Paused | null {
  const load = loadHangs.get(codeOf(l));
  if (load) return { load: true, error: load };
  const h = hung.get(l.id);
  return h && h.code === codeOf(l) ? h : null;
}

function post(job: Job) {
  if (!worker) return;
  if (job.type === 'look') {
    job.compiling = undefined;
    sentLook = job.layers;
    worker.postMessage({ type: 'look', layers: job.layers.filter((l) => !paused(l)), ...job.extra });
  } else {
    if (job.type === 'frame' || job.type === 'render') job.look = sentLook;
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
      job = { type: 'look', at: 0, layers, extra: lookExtra(msg) };
      break;
    }
    case 'frame':
      job = { type: 'frame', at: 0, seq: msg.seq, t: +msg.t || 0, answerBy: now() + ANSWER_MS,
        msg: { type: 'frame', seq: msg.seq, t: +msg.t || 0 } };
      break;
    case 'render':
      job = { type: 'render', at: 0, seq: msg.seq, start: +msg.start || 0, fps: +msg.fps > 0 ? +msg.fps : 40,
        done: 0, sentDone: 0, sentAt: now(), msg };
      break;
    default:
      return;
  }
  if (held) { held.push(job); tickOn(); } else post(job);
}

const onApp = (msg: ToSandbox) => { if (msg && typeof msg === 'object' && typeof msg.type === 'string') fromApp(msg); };
window.addEventListener('message', (event) => {
  if (event.source !== app || event.data?.type !== 'init' || !event.ports[0]) return;
  port?.close();
  port = event.ports[0];
  port.onmessage = (e) => onApp(e.data);
  onApp(event.data);
});

function onWorker(w: Worker, m: FromWorker) {
  if (w !== worker || !m || typeof m !== 'object') return;
  const job = jobs[0];
  if (!job) return;
  switch (m.type) {
    case 'compiling':
      if (job.type === 'look') job.compiling = m.id;
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
      if (r && r.ok && r.params && typeof r.params === 'object') schemas.set(r.id, r.params);
    }
  }
  if (job.internal || job.answered) return;
  const fail = (error: string) => toApp({ type: 'error', seq: job.seq, request: job.type, error });
  if (m.type === 'ready') toApp({ type: 'ready' });
  else if (m.type === 'compiled' && job.type === 'look') {
    toApp({ type: 'compiled', layers: compiledReport(job.layers, m.layers) });
  }
  else if (m.type === 'frame') {
    const rgb = m.rgb instanceof Float32Array ? m.rgb : new Float32Array(count * 3);
    toApp({ type: 'frame', seq: job.seq, rgb, errors: withPaused(m.errors, job.look), ms: Number(m.ms) || 0,
      layerMs: m.layerMs }, [rgb.buffer]);
  } else if (m.type === 'rendered') {
    if (!(m.channels instanceof Uint8Array)) return fail('The sandbox returned no channel data.');
    toApp({ type: 'rendered', seq: job.seq, channels: m.channels, frames: m.frames, channelCount: m.channelCount,
      errors: withPaused(m.errors, job.look) }, [m.channels.buffer]);
  } else if (m.type === 'error') fail(String(m.error || 'error'));
}

/** The worker's report, plus paused layers in their places. */
function compiledReport(layers: Layer[], report: unknown) {
  const byId = new Map(((Array.isArray(report) ? report : []) as Reported[]).filter((r) => r && typeof r === 'object')
    .map((r) => [r.id, r] as const));
  return layers.map((l) => {
    const p = paused(l);
    if (p && p.load) return { id: l.id, ok: false, error: p.error, params: {} };
    if (p) return { id: l.id, ok: true, params: p.params || schemas.get(l.id) || {} };
    const r = byId.get(l.id);
    if (!r) return { id: l.id, ok: false, error: 'The sandbox did not report this layer.', params: {} };
    return { id: l.id, ok: !!r.ok, params: r.params && typeof r.params === 'object' ? r.params : {},
      modules: ((Array.isArray(r.modules) ? r.modules : []) as Reported[]).filter((x) => x && typeof x === 'object')
        .map((x) => ({ id: x.id, ok: !!x.ok, params: x.params && typeof x.params === 'object' ? x.params : {},
          ...(x.ok ? {} : { error: String(x.error || 'error') }) })),
      ...(r.ok ? {} : { error: String(r.error || 'error') }) };
  });
}

/** Frame errors, plus one for each paused layer that would be playing. */
function withPaused(errors: unknown, look?: Layer[]): FrameError[] {
  const out = (Array.isArray(errors) ? errors : []).filter((e) => e && typeof e === 'object')
    .map((e) => (e.module == null ? { id: e.id, error: String(e.error) }
      : { id: e.id, module: e.module, error: String(e.error) }));
  for (const l of look || []) {
    const p = enabled(l) && paused(l);
    if (p && !out.some((e) => e.id === l.id)) out.push({ id: l.id, error: p.error });
  }
  return out;
}

function answerBlack(job: Job) {
  job.answered = true;
  const rgb = new Float32Array(count * 3);
  toApp({ type: 'frame', seq: job.seq, rgb, errors: withPaused([], job.look || sentLook), ms: 0 }, [rgb.buffer]);
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
  for (const j of [...jobs, ...held || []]) if (j.type === 'frame' && !j.answered && t > j.answerBy) answerBlack(j);
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
    let culprits = suspects.length === 1 ? suspects : await probeAll(suspects, t);
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

/** Run each suspect alone for one frame at time t; resolve with the ones that hang. */
async function probeAll(layers: Layer[], t: number) {
  const out: Layer[] = [];
  for (let i = 0; i < layers.length; i += PROBE_PARALLEL) {
    const batch = layers.slice(i, i + PROBE_PARALLEL);
    const results = await Promise.all(batch.map((l) => probe(l, t)));
    batch.forEach((l, n) => { if (results[n] === 'hung') out.push(l); });
  }
  return out;
}

function probe(layer: Layer, t: number) {
  return new Promise<'hung' | 'ok' | 'unknown'>((resolve) => {
    let w: Worker;
    try { w = new Worker(workerUrl, { name: 'folly-probe' }); } catch { resolve('unknown'); return; }
    let started = false;
    let timeout = setTimeout(() => done('unknown'), PROBE_START_MS);
    function done(result: 'hung' | 'ok' | 'unknown') {
      clearTimeout(timeout);
      w.terminate();
      resolve(result);
    }
    w.onerror = (e) => { e.preventDefault(); };
    w.onmessage = (e) => {
      const m = e.data || {};
      if (!started && m.type === 'ready') {
        started = true;
        clearTimeout(timeout);
        timeout = setTimeout(() => done('hung'), PROBE_MS);
      } else if (started && m.type === 'frame' && m.seq === -1) done('ok');
      else if (m.type === 'error') done('ok');          // an error is not a hang
    };
    w.postMessage({ type: 'init', rig, library });
    w.postMessage({ type: 'look', layers: [layer], ...baseExtra });
    w.postMessage({ type: 'frame', seq: -1, t });
  });
}

if (!workerSource.trim()) {
  toApp({ type: 'error', error: 'The pattern worker is missing: sandbox.html was not built.' });
} else {
  worker = startWorker();     // parse the core while the app fetches the rig
  if (worker) toApp({ type: 'ready' });
}
