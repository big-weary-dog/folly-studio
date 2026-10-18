// What the sandbox says about each layer and module: compile results, the last code that compiled (it runs while new
// code is broken), params schemas, runtime errors. Reading a state follows `rev`, which moves when they change.
import { signal } from '@preact/signals';

import type { Layer, Module } from '../types.ts';

export type StateKind = 'ok' | 'off' | 'muted' | 'pending' | 'compile' | 'runtime' | 'hung';
export interface State { kind: StateKind; message?: string }
export interface Problem { kind: 'compile' | 'runtime' | 'hung'; message: string; running?: boolean }
/** A compile report from the sandbox (SPEC "Sandbox protocol"). */
export interface Compiled {
  id: string; ok: boolean; error?: string;
  modules?: { id: string; ok: boolean; error?: string; params?: Record<string, unknown> | null; code: string }[];
}
export const ISSUE_LABELS: Record<string, string> = { compile: 'Compile error', runtime: 'Runtime error',
  hung: 'Hung' };
const RUNTIME_ERROR_HOLD_MS = 1200;
const HUNG_RE = /^Pattern hung\b/;    // the sandbox's message for a layer it paused
const hungOr = (msg: string, kind: 'compile' | 'runtime') => (HUNG_RE.test(msg) ? 'hung' : kind);
const K = (layerId: string, moduleId: string) => `${layerId}/${moduleId}`;

export function createLayerStatus(layerById: (id: string) => Layer | null, silent: (id: string) => boolean) {
  const compiled = new Map<string, { ok: boolean; params: Record<string, unknown> | null; code: string }>();
  const good = new Map<string, string>();                            // module key → last code that compiled
  const bad = new Map<string, { code: string; error: string }>();    // module key → newest code that failed
  const schemas = new Map<string, Record<string, unknown>>();        // module key → last good params schema
  const layerErr = new Map<string, string>();                        // layer id → an error not of one module
  const runtimeErr = new Map<string, { error: string; module?: string; at: number }>();
  const rev = signal(0);
  let shownKey = '';

  const S = {
    rev,
    /** A compile report → true when a module falls back to its last good code (send the look again). */
    compiled(layers: Compiled[]) {
      let fallback = false;
      for (const r of layers) {
        const l = layerById(r.id);
        let moduleFailed = false;
        for (const mr of r.modules || []) {
          const key = K(r.id, mr.id), m = l?.modules.find((x) => x.id === mr.id);
          compiled.set(key, { ok: !!mr.ok, params: mr.params || null, code: mr.code });
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
      rev.value++;
      return fallback;
    },

    /** A frame's errors; panels redraw only when what they show changed. */
    frameErrors(errors: { id: string; error?: unknown; module?: string }[]) {
      if (!errors.length && !runtimeErr.size) return;      // the usual case: nothing to do
      const now = performance.now();
      for (const e of errors) runtimeErr.set(e.id, { error: String(e.error || 'error'), module: e.module, at: now });
      let key = '';
      for (const [id, e] of runtimeErr) {
        if (now - e.at > RUNTIME_ERROR_HOLD_MS) runtimeErr.delete(id);
        else key += `${id}${e.error}|`;
      }
      if (key !== shownKey) { shownKey = key; rev.value++; }
    },

    /** The code to run: the module's own, or its last good code while the new one fails. */
    codeFor(layerId: string, m: Module) {
      const key = K(layerId, m.id), b = bad.get(key);
      return b && b.code === m.code && good.has(key) ? good.get(key) as string : m.code;
    },

    module(layerId: string, m: Module): State {
      void rev.value;     // what reads a state redraws when it changes
      const key = K(layerId, m.id), b = bad.get(key);
      if (b && b.code === m.code) return { kind: 'compile', message: b.error };
      const c = compiled.get(key);
      if (!c || c.code !== m.code) return { kind: 'pending', message: b ? b.error : '' };
      const rt = runtimeErr.get(layerId);
      if (rt && rt.module === m.id) return { kind: hungOr(rt.error, 'runtime'), message: rt.error };
      return { kind: m.enabled === false ? 'off' : 'ok' };
    },

    of(id: string): State {
      void rev.value;
      const l = layerById(id);
      if (!l) return { kind: 'pending' };
      let pending: State | null = null;
      for (const m of l.modules) {
        const st = S.module(id, m);
        if (st.kind === 'compile' && m.enabled !== false) {
          return { kind: 'compile', message: `${m.title}: ${st.message}` };
        }
        if (st.kind === 'pending') pending ||= st;
      }
      if (layerErr.has(id)) return { kind: 'compile', message: layerErr.get(id) };
      if (pending) return pending;
      const rt = runtimeErr.get(id);
      if (rt) return { kind: hungOr(rt.error, 'runtime'), message: rt.error };
      return { kind: silent(id) ? 'muted' : 'ok' };
    },

    /** The editor's problem for a module, or null. */
    problem(layerId: string, m: Module | null): Problem | null {
      void rev.value;
      if (!m) return null;
      const st = S.module(layerId, m), key = K(layerId, m.id);
      if (st.kind === 'compile' || (st.kind === 'pending' && st.message)) {
        return { kind: hungOr(st.message || '', 'compile'), message: st.message || '', running: good.has(key) };
      }
      const rt = runtimeErr.get(layerId);
      if (rt && (rt.module === m.id || rt.module == null)) {
        return { kind: hungOr(rt.error, 'runtime'), message: rt.error };
      }
      const err = layerErr.get(layerId);
      return err ? { kind: 'compile', message: err } : null;
    },

    /** A module's params schema, and a note when there is none. */
    params(layerId: string, m: Module) {
      void rev.value;
      const key = K(layerId, m.id), c = compiled.get(key);
      const schema = (c?.ok && c.params) || schemas.get(key) || null;
      const note = bad.has(key) && !schemas.get(key) ? 'Fix the code’s error to get its controls.'
        : !c && !schema ? 'Compiling…' : '';
      return { schema, note };
    },
  };
  return S;
}
