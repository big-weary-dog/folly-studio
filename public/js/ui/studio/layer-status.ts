// What the sandbox says about each layer and module: compile results, params schemas, runtime errors. Reading a state
// follows `rev`, which moves when they change.
import { signal } from '@preact/signals';

import type { Module } from '../../../../shared/schemas/look.ts';
import type { FrameError, Report } from '../../runtime.ts';
import type { Layer } from './model.ts';

type StateKind = 'ok' | 'off' | 'muted' | 'pending' | 'compile' | 'runtime';
export interface State { kind: StateKind; message?: string }
interface Problem { kind: 'compile' | 'runtime'; message: string }
export const ISSUE_LABELS: Record<string, string> = { compile: 'Compile error', runtime: 'Runtime error' };
const RUNTIME_ERROR_HOLD_MS = 1200;
const K = (layerId: string, moduleId: string) => `${layerId}/${moduleId}`;

export function createLayerStatus(layerById: (id: string) => Layer | null, silent: (id: string) => boolean) {
  const compiled = new Map<string, Report['modules'][number]>();    // module key → its newest report
  const layerErr = new Map<string, string>();                        // layer id → an error not of one module
  const runtimeErr = new Map<string, { error: string; module?: string; at: number }>();
  const rev = signal(0);
  let shownKey = '';

  const S = {
    rev,
    /** A compile report. */
    compiled(layers: Report[]) {
      for (const r of layers) {
        for (const mr of r.modules) compiled.set(K(r.id, mr.id), mr);
        if (!r.ok && r.modules.every((mr) => mr.ok)) layerErr.set(r.id, r.error || 'error'); else layerErr.delete(r.id);
        if (r.ok) runtimeErr.delete(r.id);
      }
      rev.value++;
    },

    /** A frame's errors; panels redraw only when what they show changed. */
    frameErrors(errors: readonly FrameError[]) {
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

    module(layerId: string, m: Module): State {
      void rev.value;     // what reads a state redraws when it changes
      const c = compiled.get(K(layerId, m.id));
      if (!c) return { kind: 'pending' };
      if (!c.ok) return { kind: 'compile', message: c.error || 'Compile error' };
      const rt = runtimeErr.get(layerId);
      if (rt && rt.module === m.id) return { kind: 'runtime', message: rt.error };
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
      if (rt) return { kind: 'runtime', message: rt.error };
      return { kind: silent(id) ? 'muted' : 'ok' };
    },

    /** The editor's problem for a module, or null. */
    problem(layerId: string, m: Module | null): Problem | null {
      void rev.value;
      if (!m) return null;
      const st = S.module(layerId, m);
      if (st.kind === 'compile') return { kind: 'compile', message: st.message || '' };
      const rt = runtimeErr.get(layerId);
      if (rt && (rt.module === m.id || rt.module == null)) return { kind: 'runtime', message: rt.error };
      const err = layerErr.get(layerId);
      return err ? { kind: 'compile', message: err } : null;
    },

    /** A module's params schema, the params its upgrade() adds to the saved ones (untrusted), and a note when there
     * is no schema. */
    params(layerId: string, m: Module) {
      void rev.value;
      const c = compiled.get(K(layerId, m.id));
      const note = !c ? 'Compiling…' : c.ok ? '' : 'Fix the code’s error to get its controls.';
      return { schema: c?.ok ? c.params : null, note, upgraded: c?.ok ? c.upgraded : undefined };
    },
  };
  return S;
}
