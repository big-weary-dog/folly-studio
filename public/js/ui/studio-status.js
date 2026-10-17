// What the sandbox says about each layer: its compile results, the last code that compiled (which
// keeps running while new code is broken), its params schema and its runtime errors.
const RUNTIME_ERROR_HOLD_MS = 1200;
const HUNG_RE = /^Pattern hung\b/;    // the sandbox's message for a layer it paused
export const ISSUE_LABELS = { compile: 'Compile error', runtime: 'Runtime error', hung: 'Hung' };

/** createLayerStatus({ layerById, silent(id) }) */
export function createLayerStatus({ layerById, silent }) {
  const compiled = new Map();     // id → { ok, error, params, code } (latest reply)
  const good = new Map();         // id → last code that compiled
  const bad = new Map();          // id → { code, error } for the newest code that failed to compile
  const schemas = new Map();      // id → last good params schema
  const runtimeErr = new Map();   // id → { error, at }
  let shownKey = '';

  return {
    /** The sandbox's compile report → true when a layer falls back to its last good code (send the look again). */
    compiled(layers) {
      let fallback = false;
      for (const r of layers) {
        const l = layerById(r.id);
        compiled.set(r.id, { ok: !!r.ok, error: r.error || '', params: r.params || null, code: r.code });
        if (r.ok) {
          good.set(r.id, r.code);
          if (r.params) schemas.set(r.id, r.params);
          if (l && r.code === l.code) bad.delete(r.id);
          runtimeErr.delete(r.id);
        } else {
          bad.set(r.id, { code: r.code, error: r.error || 'Compile error' });
          if (good.has(r.id) && good.get(r.id) !== r.code && l && l.code === r.code) fallback = true;
        }
      }
      return fallback;
    },

    /** A frame's errors → true when what the panels show changed. */
    frameErrors(errors) {
      if (!errors.length && !runtimeErr.size) return false;      // the usual case: nothing to do
      const now = performance.now();
      for (const e of errors) runtimeErr.set(e.id, { error: String(e.error || 'error'), at: now });
      let key = '';
      for (const [id, e] of runtimeErr) {
        if (now - e.at > RUNTIME_ERROR_HOLD_MS) runtimeErr.delete(id);
        else key += `${id}${e.error}|`;
      }
      if (key === shownKey) return false;
      shownKey = key;
      return true;
    },

    /** The code the sandbox should run: the layer's own, or its last good code while the new one fails. */
    codeFor(l) {
      const b = bad.get(l.id);
      return b && b.code === l.code && good.has(l.id) ? good.get(l.id) : l.code;
    },

    /** { kind: ok | muted | pending | compile | runtime | hung, message? } */
    of(id) {
      const l = layerById(id);
      const b = bad.get(id);
      if (b && l && b.code === l.code) return { kind: 'compile', message: b.error };
      const c = compiled.get(id);
      if (!c || !l || c.code !== l.code) return { kind: 'pending', message: b ? b.error : '' };
      const rt = runtimeErr.get(id);
      if (rt) return { kind: HUNG_RE.test(rt.error) ? 'hung' : 'runtime', message: rt.error };
      return { kind: silent(id) ? 'muted' : 'ok' };
    },

    /** What the code editor shows for a layer: null or { kind: compile | runtime | hung, message, running? }. */
    problem(id) {
      const st = this.of(id);
      const kind = HUNG_RE.test(st.message || '') ? 'hung' : 'compile';
      if (st.kind === 'hung' || st.kind === 'runtime') return { kind: st.kind, message: st.message };
      if (st.kind === 'compile' || (st.kind === 'pending' && st.message)) {
        return { kind, message: st.message, running: good.has(id) };
      }
      return null;
    },

    /** The params panel's schema for a layer, and a note when it has none to show. */
    params(id) {
      const c = compiled.get(id);
      const schema = (c && c.ok && c.params) || schemas.get(id) || null;
      const note = bad.has(id) && !schemas.get(id) ? 'Fix the code’s error to get its controls.'
        : !c && !schema ? 'Compiling…' : '';
      return { schema, note: note ? { message: note } : undefined };
    },
  };
}
