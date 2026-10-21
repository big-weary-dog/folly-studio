// The Models panel, for admins: which models people may pick for an idea, each one's effort, the default, and whether
// each can run on this server (its key set, its CLI found). Saving writes the registry file (SPEC "Models"), which the
// server also reads again whenever it is edited by hand.
import '../../css/pages.css';

import { useEffect, useState } from 'preact/hooks';

import { api } from '../api.ts';
import type { AdminModels, ModelEntry, ModelsConfig, ModelState } from '../../../shared/schemas/models.ts';
import { cx, Field, toast } from './kit.tsx';
import { setTitle } from './session.ts';

export function Models() {
  const [data, setData] = useState<AdminModels | null>(null), [draft, setDraft] = useState<ModelsConfig | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const take = (d: AdminModels) => { setData(d); setDraft(structuredClone(d.config)); setError(''); };
  const fail = (err: unknown) => setError((err as Error).message);
  useEffect(() => { setTitle('Models'); api.adminModels().then(take, fail); }, []);
  if (!data || !draft) {
    return <div class="page models-page"><h1 class="page-title">Models</h1>
      <p class={error ? 'form-error' : 'pane-hint'} role={error ? 'alert' : undefined}>{error || 'Loading…'}</p></div>;
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.config);
  const stateOf = (id: string) => data.models.find((st) => st.id === id);
  const edit = (id: string, patch: Partial<ModelEntry>) => setDraft({ ...draft,
    models: draft.models.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  async function save() {
    setBusy(true);
    try {
      take(await api.saveModels(draft!));
      toast('Models saved.', { kind: 'ok' });
    } catch (err) { fail(err); } finally { setBusy(false); }
  }
  return (
    <div class="page models-page">
      <h1 class="page-title">Models</h1>
      <p class="lede">The models people can pick when they describe an idea. Saving writes <code>{data.file}</code>;
        edits to that file apply without a restart.</p>
      {data.problem && <p class="form-error" role="alert">{data.problem}</p>}
      <section class="models-panel" aria-label="Models">
        <Field label="Default" hint={<p class="field-hint">Preselected in the idea form when it is on and can run.</p>}>
          {(id) => <select id={id} value={draft.default} onChange={(e) => setDraft({ ...draft,
            default: e.currentTarget.value })}>
            {draft.models.map((m) => <option key={m.id} value={m.id}>
              {stateOf(m.id)?.available === false ? `${m.label} (cannot run here)` : m.label}</option>)}</select>}
        </Field>
        {draft.models.map((m) => <ModelRow key={m.id} m={m} state={stateOf(m.id)}
          efforts={data.efforts[m.via]} edit={(patch) => edit(m.id, patch)} />)}
      </section>
      <p class="form-error" role="alert" hidden={!error}>{error}</p>
      <div class="models-actions">
        <button class="btn ghost" type="button" disabled={!dirty || busy}
          onClick={() => setDraft(structuredClone(data.config))}>Revert</button>
        <button class={cx('btn primary', busy && 'busy')} type="button" disabled={!dirty || busy} onClick={save}>
          Save</button>
      </div>
    </div>);
}

/** One model, one row: its name and switch, its effort; beneath, what it runs on and whether it can run here. */
function ModelRow({ m, state, efforts, edit }: { m: ModelEntry; state?: ModelState; efforts: readonly string[];
  edit: (patch: Partial<ModelEntry>) => void }) {
  const what = [m.via, m.model].filter(Boolean).join(' · ');
  const hint = <p class={cx('field-hint', state && (!state.available ? 'model-off' : state.warn ? 'model-warn'
    : 'model-ok'))}>
    {what}{state ? ` — ${state.note}` : ''}</p>;
  return (
    <Field label={m.label} class="model-row" hint={hint}>{(id) => <>
      {efforts.length > 0 && <select aria-label={`${m.label}: effort`} value={m.effort ?? ''}
        onChange={(e) => edit({ effort: e.currentTarget.value || undefined })}>
        <option value="">Default effort</option>
        {efforts.map((e) => <option key={e} value={e}>{`Effort: ${e}`}</option>)}</select>}
      <input id={id} type="checkbox" class="switch" checked={m.enabled} title={m.enabled ? 'On' : 'Off'}
        onChange={(e) => edit({ enabled: e.currentTarget.checked })} />
    </>}</Field>);
}
