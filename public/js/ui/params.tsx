// Controls for the selected module's `params` (SPEC "Pattern code"): numbers become scrub fields, `type: 'color'`
// colour picks (picks.tsx), `type: 'toggle'` switches, a row each. A number, or a pick's rotate, can be modulated
// (SPEC "Param bindings"): an LFO, a global (energy, a macro…) or the clip envelope moves it every frame instead of its
// field.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

import type { ParamValue } from '../../../shared/schemas/look.ts';
import { DEFAULT_PALETTE } from '../core/stdlib.ts';
import {
  type BindingForm, bindingForm, bindingText, fmt, isBinding, makeBinding, normaliseParam, type Param, SHAPES,
  shownValue,
} from './bindings.ts';
import { cx, Field, humanize, openDialog, Scrub } from './kit.tsx';
import { type Colours, PickRow } from './picks.tsx';
import type { Studio } from './studio-store.ts';

const GLOBAL_NAMES = ['energy', 'speed', 'level', 'hue', 'saturation'];

export function ParamsPanel({ st }: { st: Studio }) {
  const l = st.selected.value, m = st.module.value;
  const hint = (...kids: ComponentChildren[]) => <div class="params"><p class="pane-hint">{kids}</p></div>;
  if (!l || !m) return hint('Select a layer to see its settings.');
  const { schema, note } = st.status.params(l.id, m);
  const entries = Object.entries(schema || {}).map(([k, raw]) => [k, normaliseParam(k, raw)] as const)
    .filter((e): e is [string, Param] => !!e[1]);
  if (note) return hint(note);
  if (!entries.length) {
    return hint('This pattern has no params. Declare ', <code>const params = {'{ … }'}</code>,
      ' in its code to set them here.');
  }
  const values = m.params || {};
  const set = (fn: (p: Record<string, ParamValue>) => void) => st.editModule(l.id, m.id, (mod) => {
    const params = { ...mod.params };
    fn(params);
    return { params };
  });
  const colours = { palette: st.look.value.globals?.palette ?? DEFAULT_PALETTE };
  return (
    <div class="params">
      {entries.map(([key, p]) => <Control key={`${l.id}/${m.id}/${key}`} name={key} p={p} values={values} set={set}
        colours={colours} narrow={st.narrow.value}
        globals={() => [...GLOBAL_NAMES, ...Object.keys(st.look.peek().globals?.macros || {})]} />)}
      <div class="params-foot"><button type="button" class="btn small ghost"
        onClick={() => st.editModule(l.id, m.id, () => ({ params: {} }))}>Reset all to defaults</button></div>
    </div>);
}

/** A param's row: its label, then its control (a number's scrub field, or what modulates it, and its ∿; a pick). */
function Control({ name, p, values, set, globals, colours, narrow }: { name: string; p: Param;
  values: Record<string, ParamValue>; set: (fn: (p: Record<string, ParamValue>) => void) => void;
  globals: () => string[]; colours: Colours; narrow: boolean }) {
  const { has, bound, value } = shownValue(p, values, name);
  const put = (v: ParamValue) => set((q) => { q[name] = v; });
  if (p.kind === 'color') {
    const turn = { ...p, label: `${p.label}: rotate`, value: 0, min: 0, max: 1, step: 0.01 };
    return <PickRow label={p.label} value={values[name]} dflt={p.value as string} blend={p.blend ?? 'step'}
      colours={colours} narrow={narrow}
      put={(v) => set((q) => { if (v === undefined) delete q[name]; else q[name] = v; })}
      modulate={(now, apply) => modulate({ ...turn, value: typeof now === 'number' ? now : 0 }, now, globals(), apply,
        'Turns 0 to 1, wrapping: one turn walks every colour of the pick once.')} />;
  }
  const field = (id: string) => (p.kind === 'number' ? <>
    {bound ? <span class="param-chip">{bindingText(values[name] as never)}</span>
      : <Scrub id={id} min={p.min} max={p.max} step={p.step} value={value as number} set={put} />}
    <button type="button" class="param-mod" aria-pressed={bound} aria-label={`Modulate ${p.label}`}
      title="Modulate: an LFO, a global or the clip envelope"
      onClick={() => modulate(p, values[name], globals(), (b) => set((q) => {
        if (b) q[name] = b; else delete q[name];
      }))}>∿</button></>
    : p.kind === 'choice' ? <select id={id} class="param-choice" value={value as string}
      onChange={(e) => put(e.currentTarget.value)}>
      {p.options.map((o) => <option value={o}>{humanize(o)}</option>)}</select>
    : <input type="checkbox" id={id} class="switch" checked={value as boolean}
      onChange={(e) => put(e.currentTarget.checked)} />);
  // Unused, the reset keeps its place (hidden), so a field never moves under the pointer.
  return (
    <Field label={p.label} class={cx('param end', p.kind === 'toggle' && 'toggle')}>
      {(id) => <>{field(id)}<button type="button" class={cx('param-reset', (!has || value === p.value) && 'unused')}
        title="Reset to default" aria-label={`Reset ${p.label} to default`}
        onClick={() => set((q) => { delete q[name]; })}>↺</button></>}</Field>);
}

/** The modulate dialog for a number param (or a pick's rotate): an LFO, a global or the clip envelope, or nothing. */
function modulate(p: Param, now: ParamValue | undefined, globals: string[], apply: (b: ReturnType<typeof makeBinding>)
  => void, range = `Range ${fmt(p.min)} to ${fmt(p.max)}. A modulated value is held to it.`) {
  return openDialog({ title: `Modulate ${p.label}`, className: 'modulate-dialog', body: (close) => {
    const [f, setF] = useState(() => bindingForm(isBinding(now) ? now : {}, p, globals));
    const select = (k: keyof BindingForm, opts: string[][]) => (id: string) => <select id={id} value={f[k]}
      onChange={(e) => setF({ ...f, [k]: e.currentTarget.value })}>
      {opts.map(([v, t]) => <option value={v}>{t}</option>)}</select>;
    const field = (label: string, k: keyof BindingForm) => <Field label={label}>{(id) => <input id={id} type="number"
      step="any" value={f[k]} onInput={(e) => setF({ ...f, [k]: e.currentTarget.value })} />}</Field>;
    return <>
      <p class="dialog-text">{range}</p>
      <Field label="Moved by">{select('mod', [['', 'Nothing: its field sets it'], ['lfo', 'An LFO'],
        ['global', 'A global'], ['envelope', 'The clip envelope']])}</Field>
      <div class="mod-fields" hidden={f.mod !== 'lfo'}>
        <Field label="Shape">{select('shape', SHAPES.map((s) => [s, humanize(s)]))}</Field>
        <div class="mod-fields" hidden={f.shape !== 'hold'}>{field('Hold (share of each cycle)', 'hold')}</div>
        {field('Cycles', 'rate')}
        <Field label="Per">{select('unit', [['hz', 'a second (Hz)'], ['beats', 'a beat']])}</Field>
        {field('Centre', 'center')}{field('Depth (±)', 'depth')}</div>
      <div class="mod-fields" hidden={f.mod !== 'global'}>
        <Field label="Global">{select('name', globals.map((g) => [g, humanize(g)]))}</Field>
        {field('At its lowest', 'from')}{field('At its highest', 'to')}</div>
      <div class="mod-fields" hidden={f.mod !== 'envelope'}>{field('Outside clips', 'eFrom')}{field('Fully in', 'eTo')}
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn ghost" onClick={() => close()}>Cancel</button>
        <button type="button" class="btn primary" onClick={() => { close(); apply(makeBinding(f, p)); }}>Apply</button>
      </div>
    </>;
  } });
}
