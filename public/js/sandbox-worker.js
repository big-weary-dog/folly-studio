// The sandbox's worker (SPEC "Sandbox protocol"): runs the look's layers, each a chain of modules, on the core.
// The server inlines it, bundled with the core, into sandbox.html, which starts it as a Worker from a Blob.
import {
  compileModule, layerModules, prepareLayer, prepareLook, prepareScene, renderFrame, setLibrary, toChannels,
} from './pattern-core.js';

const post = self.postMessage.bind(self);   // captured before any pattern code can touch it
let scene = null;
let prepared = [];                            // render order, bottom first
let globals = null;                           // { globals, automation, bpm } of the newest look
let live = null;                              // its prepared globals, the clock kept continuous across looks
let layerMs = {};                             // layer id → its ms last frame: one object, refilled each frame
// layer id + module id -> { code, kind, compiled, error }: the same code keeps its instance and state
const compiledByKey = new Map();
const now = () => performance.now();
const message = (e) => (e && e.message ? e.message : String(e));

function onInit(msg) {
  scene = prepareScene(msg.rig);
  setLibrary(msg.library);
  prepared = [];
  compiledByKey.clear();
  post({ type: 'ready' });
}

/** One module compiled (or its error), reusing the last compile while its code and kind stay the same. */
function compiled(layerId, m, keep) {
  const key = `${layerId}\u0000${m.id}`, kind = m.kind ?? 'source';
  keep.add(key);
  let entry = compiledByKey.get(key);
  if (!entry || entry.code !== m.code || entry.kind !== kind) {
    entry = { code: m.code, kind, compiled: null, error: '' };
    compiledByKey.set(key, entry);
    post({ type: 'compiling', id: layerId });   // so a hang can be pinned on this layer
    try { entry.compiled = compileModule(m.code, kind); } catch (e) { entry.error = message(e); }
  }
  return entry;
}

function onLook(msg) {
  const layers = Array.isArray(msg.layers) ? msg.layers : [];
  const report = [], next = [], keep = new Set();
  for (const layer of layers) {
    const id = layer.id, modular = Array.isArray(layer.modules);
    const modules = [], list = [];
    let error = scene ? '' : 'sandbox has no rig yet (send init first)', params = null;
    for (const m of scene ? layerModules(layer) : []) {
      const entry = compiled(id, m, keep);
      const schema = entry.compiled ? entry.compiled.params : {};
      if ((m.kind ?? 'source') === 'source' && !params) params = schema;
      modules.push(entry.compiled ? { id: m.id, ok: true, params: schema }
        : { id: m.id, ok: false, error: entry.error, params: schema });
      if (!entry.compiled && m.enabled !== false) {
        error ||= modular ? `${m.title || m.id}: ${entry.error}` : entry.error;
      }
      list.push(m.enabled === false ? null : entry.compiled);
    }
    try {
      if (error) throw new Error(error);
      next.push(prepareLayer(scene, layer, list));
    } catch (e) {
      error = message(e);
    }
    report.push({ id, ok: !error, ...(error ? { error } : {}), params: params || {}, modules });
  }
  for (const key of [...compiledByKey.keys()]) if (!keep.has(key)) compiledByKey.delete(key);
  prepared = next;
  layerMs = Object.fromEntries(next.map((L) => [L.id, 0]));
  globals = { globals: msg.globals, automation: msg.automation, bpm: msg.bpm };
  live = prepareLook(globals, live);
  post({ type: 'compiled', layers: report });
}

function onFrame(msg) {
  const started = now();
  const rgb = new Float32Array(scene ? scene.count * 3 : 0);
  const errors = scene ? renderFrame(scene, prepared, +msg.t || 0, rgb, live || undefined).errors : [];
  for (let i = 0; i < prepared.length; i++) layerMs[prepared[i].id] = prepared[i].ms;
  post({ type: 'frame', seq: msg.seq, rgb, errors, ms: now() - started, layerMs }, [rgb.buffer]);
}

function onRender(msg) {
  if (!scene) throw new Error('sandbox has no rig yet (send init first)');
  const frames = Math.max(0, Math.floor(+msg.frames || 0));
  const fps = +msg.fps > 0 ? +msg.fps : scene.fps;
  const start = +msg.start || 0;
  const opts = { gamma: msg.gamma, brightness: msg.brightness };
  const size = scene.frameChannels;
  const channels = new Uint8Array(frames * size);
  const rgb = new Float32Array(scene.count * 3);
  const seen = new Map();                     // id -> first error, across the render
  const look = prepareLook(globals);          // a fresh clock: an export is what a bake renders
  for (let f = 0; f < frames; f++) {
    const { errors } = renderFrame(scene, prepared, start + f / fps, rgb, look);
    for (const e of errors) if (!seen.has(e.id)) seen.set(e.id, e.error);
    toChannels(scene, rgb, channels.subarray(f * size, (f + 1) * size), opts);
    post({ type: 'progress', seq: msg.seq, done: f + 1 });   // the page's watchdog counts these
  }
  const errors = [...seen].map(([id, error]) => ({ id, error }));
  post({ type: 'rendered', seq: msg.seq, channels, frames, channelCount: size, errors }, [channels.buffer]);
}

const HANDLERS = { init: onInit, look: onLook, frame: onFrame, render: onRender };
self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  try {
    if (Object.hasOwn(HANDLERS, msg.type)) HANDLERS[msg.type](msg);
  } catch (e) {
    post({ type: 'error', seq: msg.seq, request: msg.type, error: message(e) });
  }
});
