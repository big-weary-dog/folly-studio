// The Light page, for admins: the light settings (SPEC "Light and output", docs/LIGHT.md), the one stored place for
// how the LEDs turn a colour value into light, and how the previews show it. Export, the bake checks and the previews
// read them; the Pi reads the same file, downloaded here, as pi/light.json.
import '../../css/pages.css';

import { useEffect, useState } from 'preact/hooks';

import { api } from '../api.ts';
import { encode, LIGHT, LIGHT_LIMITS, type Light, lightByte, lightOf, shownLight } from '../core/light.ts';
import { cx, download, Field, Scrub, toast } from './kit.tsx';
import { setTitle } from './session.ts';

const COLOURS = ['Red', 'Green', 'Blue'];
// The values the curve table shows: full, the usual dims, and the bottom where 8 bits run out.
const SAMPLES = [1, 0.75, 0.5, 0.25, 0.1, 0.06, 0.03];

export function LightPage() {
  const [saved, setSaved] = useState<Light | null>(null), [draft, setDraft] = useState<Light | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const take = (l: Light) => { setSaved(l); setDraft(structuredClone(l)); setError(''); };
  const fail = (err: unknown) => setError((err as Error).message);
  useEffect(() => { setTitle('Light'); api.light().then((l) => take(lightOf(l)), fail); }, []);
  if (!saved || !draft) {
    return <div class="page light-page"><h1 class="page-title">Light</h1>
      <p class={error ? 'form-error' : 'pane-hint'} role={error ? 'alert' : undefined}>{error || 'Loading…'}</p></div>;
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<Light>) => setDraft({ ...draft, ...patch });
  const pct = (set1: (v: number) => void) => (v: number) => set1(v / 100);
  async function save() {
    setBusy(true);
    try {
      take(lightOf(await api.saveLight(draft!)));
      toast('Light settings saved.', { kind: 'ok' });
    } catch (err) { fail(err); } finally { setBusy(false); }
  }
  return (
    <div class="page light-page">
      <h1 class="page-title">Light</h1>
      <p class="lede">How the LEDs turn a colour into light. Looks are made in colour values, as their swatches; the
        LEDs give light, so every value goes out as value<sup>gamma</sup>. Export, the bake checks and the previews
        use these now; the Pi uses them once its <code>pi/light.json</code> is this file.</p>
      <section class="models-panel" aria-label="The LEDs' curve">
        <Field label="Gamma" class="end" hint={<p class="field-hint">2.2 makes the LEDs match an sRGB screen; higher
          is darker mid-tones. Tune by eye at night, 2.2–2.6.</p>}>{(id) => <Scrub id={id} min={1} max={3}
          step={0.05} value={draft.gamma} set={(gamma) => set({ gamma })} />}</Field>
        {COLOURS.map((name, i) => <Field key={name} label={`${name} balance`} class="end">{(id) => <Scrub id={id}
          min={0} max={100} step={1} unit="%" value={Math.round(draft.balance[i]! * 100)}
          set={pct((v) => set({ balance: draft.balance.map((b, j) => (j === i ? v : b)) as Light['balance'] }))} />}
        </Field>)}
        <Field label="Floor" class="end" hint={<p class="field-hint">The least a lit channel sends, of 255. 0 lets
          values under about 6 % round to off, as the curve says; 1 keeps the faintest bed glowing.</p>}>
          {(id) => <Scrub id={id} min={0} max={16} step={1} value={draft.floor} set={(floor) => set({ floor })} />}
        </Field>
        <Curve light={draft} />
      </section>
      <Preview draft={draft} set={set} />
      <Trims draft={draft} set={set} />
      <Controller draft={draft} set={set} />
      <p class="form-error" role="alert" hidden={!error}>{error}</p>
      <div class="models-actions">
        <button class="btn ghost" type="button" onClick={() => download(`${JSON.stringify(saved, null, 2)}\n`,
          'light.json', 'application/json')}>Download for the Pi</button>
        <button class="btn ghost" type="button" disabled={busy} onClick={() => set(lightOf())}>Defaults</button>
        <button class="btn ghost" type="button" disabled={!dirty || busy}
          onClick={() => setDraft(structuredClone(saved))}>Revert</button>
        <button class={cx('btn primary', busy && 'busy')} type="button" disabled={!dirty || busy} onClick={save}>
          Save</button>
      </div>
    </div>);
}

/** What a value sends and how much light that is, white at full output: the curve, in numbers. */
function Curve({ light }: { light: Light }) {
  const byte = (v: number) => lightByte(v, light);
  return <table class="light-curve">
    <caption>A value's light on the LEDs (white, before balance), and on the previews' screen</caption>
    <thead><tr><th scope="row">Value</th>{SAMPLES.map((v) => <th key={v}>{`${Math.round(v * 100)}%`}</th>)}</tr>
    </thead>
    <tbody><tr><th scope="row">Sends</th>{SAMPLES.map((v) => <td key={v}>{byte(v)}</td>)}</tr>
      <tr><th scope="row">Light</th>{SAMPLES.map((v) => <td key={v}>{`${(byte(v) / 2.55).toFixed(1)}%`}</td>)}</tr>
      <tr><th scope="row">On screen</th>{SAMPLES.map((v) => <td key={v}>
        {Math.round(255 * encode(shownLight(v, light)))}</td>)}</tr>
    </tbody></table>;
}

/** How the previews show the light: the same curve, then these, the same in Points and Playa. */
function Preview({ draft, set }: { draft: Light; set: (p: Partial<Light>) => void }) {
  const P = draft.preview, edit = (patch: Partial<Light['preview']>) => set({ preview: { ...P, ...patch } });
  const [e0, e1] = LIGHT_LIMITS.exposure;
  const share = (key: 'bloom' | 'highlight' | 'focus', label: string, hint: string) => <Field label={label}
    class="end" hint={<p class="field-hint">{hint}</p>}>{(id) => <Scrub id={id} min={0} max={100} step={1} unit="%"
      value={Math.round(P[key] * 100)} set={(v) => edit({ [key]: v / 100 })} />}</Field>;
  return <section class="models-panel" aria-label="The previews">
    <p class="field-hint">The previews show each LED's light as this curve gives it, unrounded, then these. They never
      change what the LEDs get.</p>
    <Field label="Exposure" class="end" hint={<p class="field-hint">The screen light of full drive. 85 % keeps the
      brightest LED below Playa's shoulder, so every level shows in proportion; more is brighter, and compresses
      the top.</p>}>{(id) => <Scrub id={id} min={e0 * 100} max={e1 * 100} step={5} unit="%"
        value={Math.round(P.exposure * 100)} set={(v) => edit({ exposure: v / 100 })} />}</Field>
    {share('bloom', 'Bloom', 'Playa\'s glow round bright light, as a camera sees it. 0 is off: the LEDs\' own light '
      + 'alone.')}
    {share('highlight', 'Highlight dim', 'The light left on LEDs outside a hover highlight.')}
    {share('focus', 'Focus dim', 'The light left outside a layer\'s groups while you pick them: dim, still readable.')}
  </section>;
}

/** Each group's light × its level, after the curve (by the rig's group tags): to match a part that runs bright. */
function Trims({ draft, set }: { draft: Light; set: (p: Partial<Light>) => void }) {
  const edit = (i: number, patch: Partial<Light['trims'][number]>) => set({ trims: draft.trims
    .map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  return <section class="models-panel" aria-label="Group trims">
    <p class="field-hint">Trims: a group's light × its level, by tag (rose, spire…), after the curve, so a part that
      runs bright can match the rest. None by default.</p>
    {draft.trims.map((t, i) => <Field key={i} label={<input type="text" aria-label="Tag" value={t.tag} maxLength={40}
      onInput={(e) => edit(i, { tag: e.currentTarget.value })} />} class="end">{(id) => <>
      <Scrub id={id} min={0} max={100} step={1} unit="%" value={Math.round(t.level * 100)}
        set={(v) => edit(i, { level: v / 100 })} />
      <button class="btn ghost" type="button" onClick={() => set({ trims: draft.trims.filter((_, j) => j !== i) })}>
        Remove</button></>}</Field>)}
    <button class="btn ghost" type="button" onClick={() => set({ trims: [...draft.trims, { tag: '', level: 1 }] })}>
      Add a trim</button>
  </section>;
}

/** The controller's own settings, recorded so the explanation is complete; never applied here. */
function Controller({ draft, set }: { draft: Light; set: (p: Partial<Light>) => void }) {
  const edit = (i: number, patch: Partial<Light['controller'][number]>) => set({ controller: draft.controller
    .map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return <section class="models-panel" aria-label="The controller's own settings">
    <p class="field-hint">The controller's own settings, for the record: its port brightness is the electrical cap and
      its gamma must stay None (this page's curve is the only one). Studio never applies these. Defaults: the F48's,
      {` ${LIGHT.controller.map((c) => `ports ${c.ports} at ${c.brightness * 100} %`).join(', ')}`}.</p>
    {draft.controller.map((c, i) => <Field key={i} label={<input type="text" aria-label="Ports" value={c.ports}
      maxLength={40} onInput={(e) => edit(i, { ports: e.currentTarget.value })} />} class="end">{(id) => <>
      <Scrub id={id} min={0} max={100} step={1} unit="%" value={Math.round(c.brightness * 100)}
        set={(v) => edit(i, { brightness: v / 100 })} />
      <input type="text" aria-label="Gamma" value={c.gamma} maxLength={40}
        onInput={(e) => edit(i, { gamma: e.currentTarget.value })} /></>}</Field>)}
  </section>;
}
