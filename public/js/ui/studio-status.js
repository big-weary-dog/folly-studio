// What the sandbox says about each layer and each of its modules: compile results, the last code that compiled
// (which keeps running while new code is broken), params schemas, and runtime errors.
const RUNTIME_ERROR_HOLD_MS = 1200;
const HUNG_RE = /^Pattern hung\b/;    // the sandbox's message for a layer it paused
export const ISSUE_LABELS = { compile: 'Compile error', runtime: 'Runtime error', hung: 'Hung' };
const K = (layerId, moduleId) => `${layerId}/${moduleId}`;

/** createLayerStatus({ layerById, silent(id) }) */
export function createLayerStatus({ layerById, silent }) {
  const compiled = new Map();     // module key → { ok, error, params, code } (latest reply)
  const good = new Map();         // module key → last code that compiled
  const bad = new Map();          // module key → { code, error } for the newest code that failed to compile
  const schemas = new Map();      // module key → last good params schema
  const layerErr = new Map();     // layer id → an error not of one module (a group, say)
  const runtimeErr = new Map();   // layer id → { error, module, at }
  let shownKey = '';
  const moduleIn = (l, id) => (l && l.modules ? l.modules.find((m) => m.id === id) : null);

  const S = {
    /** The sandbox's compile report → true when a module falls back to its last good code (send the look again). */
    compiled(layers) {
      let fallback = false;
      for (const r of layers) {
        const l = layerById(r.id);
        let moduleFailed = false;
        for (const mr of r.modules || []) {
          const key = K(r.id, mr.id), m = moduleIn(l, mr.id);
          compiled.set(key, { ok: !!mr.ok, error: mr.error || '', params: mr.params || null, code: mr.code });
          if (mr.ok) {
            good.set(key, mr.code);
            if (mr.params) schemas.set(key, mr.params);
            if (m && m.code === mr.code) bad.delete(key);
          } else {
            moduleFailed = true;
            bad.set(key, { code: mr.code, error: mr.error || 'Compile error' });
            if (good.has(key) && good.get(key) !== mr.code && m && m.code === mr.code) fallback = true;
          }
        }
        if (!r.ok && !moduleFailed) layerErr.set(r.id, r.error || 'error'); else layerErr.delete(r.id);
        if (r.ok) runtimeErr.delete(r.id);
      }
      return fallback;
    },

    /** A frame's errors → true when what the panels show changed. */
    frameErrors(errors) {
      if (!errors.length && !runtimeErr.size) return false;      // the usual case: nothing to do
      const now = performance.now();
      for (const e of errors) runtimeErr.set(e.id, { error: String(e.error || 'error'), module: e.module, at: now });
      let key = '';
      for (const [id, e] of runtimeErr) {
        if (now - e.at > RUNTIME_ERROR_HOLD_MS) runtimeErr.delete(id);
        else key += `${id}${e.error}|`;
      }
      if (key === shownKey) return false;
      shownKey = key;
      return true;
    },

    /** The code the sandbox should run for a module: its own, or its last good code while the new one fails. */
    codeFor(layerId, m) {
      const key = K(layerId, m.id), b = bad.get(key);
      return b && b.code === m.code && good.has(key) ? good.get(key) : m.code;
    },

    /** A module's state: { kind: ok | off | pending | compile | runtime | hung, message? }. */
    module(layerId, m) {
      const key = K(layerId, m.id), b = bad.get(key);
      if (b && b.code === m.code) return { kind: 'compile', message: b.error };
      const c = compiled.get(key);
      if (!c || c.code !== m.code) return { kind: 'pending', message: b ? b.error : '' };
      const rt = runtimeErr.get(layerId);
      if (rt && rt.module === m.id) return { kind: HUNG_RE.test(rt.error) ? 'hung' : 'runtime', message: rt.error };
      return { kind: m.enabled === false ? 'off' : 'ok' };
    },

    /** A layer's state: { kind: ok | muted | pending | compile | runtime | hung, message? }. */
    of(id) {
      const l = layerById(id);
      if (!l) return { kind: 'pending' };
      let pending = null;
      for (const m of l.modules || []) {
        const st = S.module(id, m);
        if (st.kind === 'compile' && m.enabled !== false) {
          return { kind: 'compile', message: `${m.title}: ${st.message}` };
        }
        if (st.kind === 'pending') pending ||= st;
      }
      if (layerErr.has(id)) return { kind: 'compile', message: layerErr.get(id) };
      if (pending) return pending;
      const rt = runtimeErr.get(id);
      if (rt) return { kind: HUNG_RE.test(rt.error) ? 'hung' : 'runtime', message: rt.error };
      return { kind: silent(id) ? 'muted' : 'ok' };
    },

    /** What the code editor shows for a module: null or { kind: compile | runtime | hung, message, running? }. */
    problem(layerId, m) {
      if (!m) return null;
      const st = S.module(layerId, m), key = K(layerId, m.id);
      if (st.kind === 'compile' || (st.kind === 'pending' && st.message)) {
        return { kind: HUNG_RE.test(st.message) ? 'hung' : 'compile', message: st.message, running: good.has(key) };
      }
      const rt = runtimeErr.get(layerId);
      if (rt && (rt.module === m.id || rt.module == null)) {
        return { kind: HUNG_RE.test(rt.error) ? 'hung' : 'runtime', message: rt.error };
      }
      return layerErr.has(layerId) ? { kind: 'compile', message: layerErr.get(layerId) } : null;
    },

    /** The params panel's schema for a module, and a note when it has none to show. */
    params(layerId, m) {
      const key = K(layerId, m.id), c = compiled.get(key);
      const schema = (c && c.ok && c.params) || schemas.get(key) || null;
      const note = bad.has(key) && !schemas.get(key) ? 'Fix the code’s error to get its controls.'
        : !c && !schema ? 'Compiling…' : '';
      return { schema, note: note ? { message: note } : undefined };
    },
  };
  return S;
}
