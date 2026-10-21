// The Light page, for admins (SPEC "Light and output", docs/LIGHT.md): how Studio draws the LEDs, calibrated so the
// previews show what the real lights show. The Pi's output transform is shown, not edited: the calibration never
// changes what the LEDs get. The Pi reads the same file, downloaded here, as pi/light.json.
import '../../css/pages.css';

import { useEffect, useState } from 'preact/hooks';

import { api, type Lights } from '../api.ts';
import { encode, LIGHT, LIGHT_LIMITS, type Light, lightByte, lightOf, shownLight } from '../core/light.ts';
import { cx, download, Field, Scrub, Switch, toast } from './kit.tsx';
import { onPi, setTitle } from './session.ts';

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
      <p class="lede">How Studio draws the LEDs. Calibrate it against the real lights (a photo of them beside the
        preview), so the previews show the colours that actually show up. It never changes what the LEDs get.</p>
      <Calibrate draft={draft} set={set} />
      <Preview draft={draft} set={set} />
      <Output light={draft} />
      <Controller draft={draft} set={set} />
      {onPi() && <LiveLooks />}
      <p class="form-error" role="alert" hidden={!error}>{error}</p>
      <div class="models-actions">
        <button class="btn ghost" type="button" onClick={() => download(`${JSON.stringify(saved, null, 2)}\n`,
          'light.json', 'application/json')}>Download for the Pi</button>
        <button class="btn ghost" type="button" disabled={busy}
          onClick={() => set({ calibration: LIGHT.calibration, preview: LIGHT.preview })}>Defaults</button>
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
    <caption>A value's light on the LEDs (white, before balance), and on the previews' screen, calibrated</caption>
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
    <p class="field-hint">The previews show each LED's light as the Pi's curve gives it, unrounded, calibrated, then
      these. They never change what the LEDs get.</p>
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

/** How the real LEDs look, so the previews draw them so: each colour's white, their response and saturation. */
function Calibrate({ draft, set }: { draft: Light; set: (p: Partial<Light>) => void }) {
  const C = draft.calibration;
  const edit = (patch: Partial<Light['calibration']>) => set({ calibration: { ...C, ...patch } });
  const L = LIGHT_LIMITS, pct = (v: number) => Math.round(v * 100);
  return <section class="models-panel" aria-label="Calibration">
    <p class="field-hint">How the real LEDs look against the swatches. 100 % everywhere draws them as the swatches.</p>
    {COLOURS.map((name, i) => <Field key={name} label={`${name} white`} class="end">{(id) => <Scrub id={id}
      min={L.white[0] * 100} max={L.white[1] * 100} step={1} unit="%" value={pct(C.white[i]!)}
      set={(v) => edit({ white: C.white.map((w, j) => (j === i ? v / 100 : w)) as Light['calibration']['white'] })} />}
    </Field>)}
    <Field label="Response" class="end" hint={<p class="field-hint">How the LEDs' light follows what they are sent:
      above 1 darker mid-tones and fades, below 1 brighter.</p>}>{(id) => <Scrub id={id} min={L.response[0]}
        max={L.response[1]} step={0.05} value={C.response} set={(response) => edit({ response })} />}</Field>
    <Field label="Saturation" class="end" hint={<p class="field-hint">How vivid their colours are against the screen's:
      LEDs' primaries run deeper than sRGB's.</p>}>{(id) => <Scrub id={id} min={L.saturation[0] * 100}
        max={L.saturation[1] * 100} step={5} unit="%" value={pct(C.saturation)}
        set={(v) => edit({ saturation: v / 100 })} />}</Field>
  </section>;
}

/** The Pi's output transform, as stored: what the LEDs get, which the calibration never changes. */
function Output({ light }: { light: Light }) {
  const list = (v: number[]) => v.map((x) => `${Math.round(x * 100)} %`).join(', ');
  return <section class="models-panel" aria-label="The Pi's output">
    <p class="field-hint">What the Pi sends, from <code>pi/light.json</code>: value<sup>{light.gamma}</sup>, balance
      {` ${list(light.balance)}`}, floor {light.floor}
      {light.trims.length ? `, trims ${light.trims.map((t) => `${t.tag} ${Math.round(t.level * 100)} %`).join(', ')}`
        : ''}. Fixed here; the previews draw it, then the calibration.</p>
    <Curve light={light} />
  </section>;
}
const MODES = { jukebox: 'Jukebox', live: 'Live Play' } as const;
/** On the Pi: whether Studio may play library looks live on the lights (SPEC-offline "Playing on the lights"), and
 * the mode (SPEC-liveplay "Modes"); saved as each is switched, apart from the settings above. */
function LiveLooks() {
  const [lights, setLights] = useState<Lights | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { api.lights().then(setLights, () => {}); }, []);
  const change = (next: Partial<Pick<Lights, 'liveLooks' | 'mode'>>, said: (l: Lights) => string) => {
    setBusy(true);
    api.saveLights(next).then((l) => { setLights(l); toast(said(l), { kind: 'ok' }); },
      (e) => toast(e.message, { kind: 'error' })).finally(() => setBusy(false));
  };
  return <section class="models-panel" aria-label="On the lights">
    <Switch label="Live library looks on the lights" class="end" checked={!!lights?.liveLooks}
      disabled={!lights || busy} onChange={(liveLooks) => change({ liveLooks }, (l) => (l.liveLooks
        ? 'Library looks play live.' : 'Only baked looks play on the lights.'))} />
    <p class="field-hint">On: a look made only of library modules plays live from Studio, its controls working.
      Off: only baked looks play.</p>
    <div class="import-tabs" role="group" aria-label="Mode">
      {Object.entries(MODES).map(([k, text]) => <button type="button" class="tab import-tab"
        aria-pressed={lights?.mode === k} disabled={!lights || busy}
        onClick={() => change({ mode: k as Lights['mode'] }, (l) => `The lights are in ${MODES[l.mode]}.`)}>
        {text}</button>)}</div>
    <p class="field-hint">Jukebox: guests queue looks, and each change is a full fade; no knobs, Master or Blackout.
      Live Play: whoever may control Live drives the playing look's knobs, Master, tempo and Blackout, one at a time.
      </p>
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
