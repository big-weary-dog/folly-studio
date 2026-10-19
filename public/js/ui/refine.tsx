// Refining a look with a model (SPEC-generators "Refine"): a follow-up request, a critique of its frames, or a
// runtime error to fix. The look is saved first, the model's revision replaces it on the server (as an edit, with a
// version), and what changed shows here with an undo that puts back what was there. One refinement at a time.
import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';

import { api, statusOf } from '../api.ts';
import type { Idea, Look } from '../../../shared/schemas/api.ts';
import type { ModelChoices } from '../../../shared/schemas/models.ts';
import { signedOut } from './session.ts';
import { Field, toast } from './kit.tsx';
import { saveBody, type Studio } from './studio-store.ts';

type Ask = { text?: string, critique?: true, fix?: { layer: string, error: string } };
type Run = { lookId: string, busy: boolean, by?: string, changes?: string[], before?: ReturnType<typeof saveBody>,
  error?: string };
const run = signal<Run | null>(null);
const model = signal('');   // '' → the model that made the look
let choices: Promise<ModelChoices> | null = null;

const pending = (i: Idea) => i.status === 'queued' || i.status === 'generating';

/** The look as the server now has it, in place of the one being edited. */
async function reload(st: Studio, id: string) {
  const { look } = await api.look(id);
  if (st.lookId.peek() === id && st.data.rig) st.setup(st.data.rig, st.data.library, look as Look);
}

/** Ask for a refinement of the open look: save it, wait for the model, take its revision. */
export async function refine(st: Studio, ask: Ask) {
  if (run.peek()?.busy) return;
  if (st.copyOnSave.peek()) {
    toast('This look belongs to someone else. Save your own copy first, then refine it.', { kind: 'warn' });
    return;
  }
  if (!st.lookId.peek() || st.dirty.peek()) await st.save();
  const id = st.lookId.peek();
  if (!id || st.dirty.peek()) return;
  const before = saveBody(st.look.peek());
  run.value = { lookId: id, busy: true };
  try {
    let { idea } = await api.refine(id, { ...ask, ...(model.peek() ? { model: model.peek() } : {}) });
    run.value = { ...run.peek()!, by: idea.by };
    while (pending(idea)) ({ idea = idea } = await api.idea(idea.id, `${idea.status}@${idea.updatedAt}`));
    if (idea.status === 'failed') throw new Error(idea.error || 'The refinement failed.');
    const changes = idea.changes ?? [];
    if (changes.length) await reload(st, id);
    run.value = { lookId: id, busy: false, by: idea.by, changes, before };
  } catch (err) {
    if (statusOf(err) === 401) return signedOut();
    run.value = { lookId: id, busy: false, error: (err as Error).message };
  }
}

async function undo(st: Studio, r: Run) {
  try {
    await api.updateLook(r.lookId, r.before!);
    await reload(st, r.lookId);
    run.value = null;
    toast('Put back as it was.', { kind: 'ok' });
  } catch (err) {
    if (statusOf(err) === 401) return signedOut();
    toast(`Could not undo: ${(err as Error).message}`, { kind: 'error' });
  }
}

/** "Ask <model> to fix": a runtime error sent to the model with the look. */
export function FixButton({ st, layer, error }: { st: Studio, layer: string, error: string }) {
  const r = run.value, mine = st.server.value && !st.copyOnSave.value;
  if (!mine) return null;
  return <button type="button" class="btn small refine-fix" disabled={!!r?.busy}
    onClick={() => refine(st, { fix: { layer: layer.slice(0, 80), error: error.slice(0, 400) } })}>
    {r?.busy ? 'Fixing…' : 'Ask the AI to fix it'}</button>;
}

/** The refine box: the request, the model, Refine and Critique, and the last refinement's changes with Undo. */
export function RefinePanel({ st }: { st: Studio }) {
  const [text, setText] = useState(''), [list, setList] = useState<ModelChoices | null>(null);
  useEffect(() => {
    (choices ??= api.models()).then(setList, () => { choices = null; });
  }, []);
  if (st.copyOnSave.value || !st.server.value) return null;
  const r = run.value?.lookId === st.lookId.value ? run.value : null, busy = !!r?.busy;
  const picked = list?.models.find((m) => m.id === model.value), offline = picked && !picked.paid;
  const submit = (e: Event) => {
    e.preventDefault();
    if (text.trim().length >= 2) refine(st, { text: text.trim() }).then(() => { if (!run.peek()?.error) setText(''); });
  };
  return (
    <section class="refine" aria-label="Refine with AI">
      <h3 class="look-h">Refine with AI</h3>
      <form class="refine-form" onSubmit={submit}>
        <textarea class="refine-text" rows={2} maxlength={1000} placeholder="Slower, and only on the arches"
          aria-label="What to change" value={text} disabled={busy}
          onInput={(e) => setText(e.currentTarget.value)} />
        <div class="refine-row">
          {list && <Field label="Model">{(id) => <select id={id} value={model.value} disabled={busy}
            onChange={(e) => { model.value = e.currentTarget.value; }}>
            <option value="">The one that made it</option>
            {list.models.map((m) => <option value={m.id}>{m.label}</option>)}</select>}</Field>}
          <button type="submit" class="btn small primary" disabled={busy || text.trim().length < 2}>
            {busy ? `Refining${r?.by ? ` with ${r.by}` : ''}…` : 'Refine'}</button>
          <button type="button" class="btn small" disabled={busy || offline}
            title="The model watches a few seconds of the look and revises it toward the idea"
            onClick={() => refine(st, { critique: true })}>Critique</button>
        </div>
      </form>
      {r?.error && <p class="refine-error" role="status">{r.error}</p>}
      {r && !busy && r.changes && <div class="refine-done" role="status">
        <p>{r.changes.length ? `${r.by ?? 'The model'} changed:` : `${r.by ?? 'The model'} changed nothing.`}</p>
        {r.changes.length > 0 && <><ul class="refine-changes">{r.changes.map((c) => <li>{c}</li>)}</ul>
          <button type="button" class="btn small" onClick={() => undo(st, r)}>Undo</button></>}
      </div>}
    </section>);
}
