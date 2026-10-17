// The sandbox's worker (SPEC "Sandbox protocol"): runs the look's layers on the core. The server
// inlines it, bundled with the core, into sandbox.html, which starts it as a Worker from a Blob.
import { compilePattern, prepareLayer, prepareScene, renderFrame, toChannels } from './pattern-core.js';

const post = self.postMessage.bind(self);   // captured before any pattern code can touch it
let scene = null;
let prepared = [];                            // render order, bottom first
const compiledById = new Map();               // id -> { code, compiled, error }: same code keeps its state
const now = () => performance.now();
const message = (e) => (e && e.message ? e.message : String(e));

function onInit(msg) {
  scene = prepareScene(msg.cathedral);
  prepared = [];
  compiledById.clear();
  post({ type: 'ready' });
}

function onLook(msg) {
  const layers = Array.isArray(msg.layers) ? msg.layers : [];
  const report = [], next = [], keep = new Set();
  for (const layer of layers) {
    const id = layer.id;
    keep.add(id);
    let entry = compiledById.get(id);
    try {
      if (!scene) throw new Error('sandbox has no cathedral yet (send init first)');
      if (!entry || entry.code !== layer.code) {
        entry = { code: layer.code, compiled: null, error: '' };
        compiledById.set(id, entry);
        post({ type: 'compiling', id });      // so a hang can be pinned on this layer
        entry.compiled = compilePattern(layer.code);
      }
      if (!entry.compiled) throw new Error(entry.error || 'pattern did not compile');
      next.push(prepareLayer(scene, layer, entry.compiled));
      report.push({ id, ok: true, params: entry.compiled.params });
    } catch (e) {
      if (entry && !entry.compiled) entry.error = message(e);
      report.push({ id, ok: false, error: message(e), params: entry?.compiled ? entry.compiled.params : {} });
    }
  }
  for (const id of [...compiledById.keys()]) if (!keep.has(id)) compiledById.delete(id);
  prepared = next;
  post({ type: 'compiled', layers: report });
}

function onFrame(msg) {
  const started = now();
  const rgb = new Float32Array(scene ? scene.count * 3 : 0);
  const errors = scene ? renderFrame(scene, prepared, +msg.t || 0, rgb).errors : [];
  post({ type: 'frame', seq: msg.seq, rgb, errors, ms: now() - started }, [rgb.buffer]);
}

function onRender(msg) {
  if (!scene) throw new Error('sandbox has no cathedral yet (send init first)');
  const frames = Math.max(0, Math.floor(+msg.frames || 0));
  const fps = +msg.fps > 0 ? +msg.fps : 40;
  const start = +msg.start || 0;
  const opts = { gamma: msg.gamma, brightness: msg.brightness };
  const size = scene.frameChannels;
  const channels = new Uint8Array(frames * size);
  const rgb = new Float32Array(scene.count * 3);
  const seen = new Map();                     // id -> first error, across the render
  for (let f = 0; f < frames; f++) {
    const { errors } = renderFrame(scene, prepared, start + f / fps, rgb);
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
