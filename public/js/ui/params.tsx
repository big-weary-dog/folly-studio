// Controls for the selected module's `params` (SPEC "Pattern code"): numbers become scrub fields, `type: 'color'`
// colour picks (picks.tsx), `type: 'toggle'` switches, a row each. A number, or a pick's rotate, can be modulated
// (SPEC "Param bindings"): an LFO or a global (energy, a macro…) moves it every frame instead of its field; a speed's
// beat clock counts it per beat at the look's BPM.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

import type { Binding, ParamValue } from '../../../shared/schemas/look.ts';
import { readText, TEXT_MAX } from '../core/globals.ts';
import type { Picture } from '../core/picture.ts';
import { DEFAULT_PALETTE } from '../core/stdlib.ts';
import { BeatClock } from './beat-clock.tsx';
import {
  beatsAt, fmt, keepsTime, normaliseParam, optionText, type Param, perBeat, shownValue, upgradedOf,
} from './bindings.ts';
import { cx, Field, Scrub } from './kit.tsx';
import { addModulator, modulatorEdits } from './look-globals-edit.ts';
import { BoundChip, ModButton, type ModCtx } from './modulate.tsx';
import { type Colours, type Help, PickRow } from './picks.tsx';
import { PictureRow } from './picture-row.tsx';
import type { Studio } from './studio-store.ts';

const TITLE = 'Modulate: an LFO, a global or a macro moves it';

export function ParamsPanel({ st }: { st: Studio }) {
  const l = st.selected.value, m = st.module.value;
  const hint = (...kids: ComponentChildren[]) => <div class="params"><p class="pane-hint">{kids}</p></div>;
  if (!l || !m) return hint('Select a layer to see its settings.');
  const { schema, note, upgraded } = st.status.params(l.id, m);
  const entries = Object.entries(schema || {}).map(([k, raw]) => [k, normaliseParam(k, raw)] as const)
    .filter((e): e is [string, Param] => !!e[1]);
  if (note) return hint(note);
  if (!entries.length) {
    return hint('This pattern has no params. Declare ', <code>const params = {'{ … }'}</code>,
      ' in its code to set them here.');
  }
  // Params saved for an earlier version show (and are written on an edit) as its upgrade() reads them.
  const fresh = (saved: Record<string, ParamValue> = {}) => ({ ...saved, ...upgradedOf(upgraded, schema, saved) });
  const values = fresh(m.params);
  const set = (fn: (p: Record<string, ParamValue>) => void) => st.editModule(l.id, m.id, (mod) => {
    const params = fresh(mod.params);
    fn(params);
    return { params };
  });
  const colours = { palette: st.look.value.globals?.palette ?? DEFAULT_PALETTE };
  const ctx: ModCtx = { look: () => st.look.peek(), t: () => st.clock.t, clips: () => st.selected.peek()?.clips,
    narrow: st.narrow.value, share: (mod, hint) => addModulator(st, mod,
    l.groups?.length ? st.groupNames(l.groups).split(',')[0] : l.title ?? '', hint), edit: modulatorEdits(st) };
  return (
    <div class="params">
      {entries.map(([key, p]) => <Control key={`${l.id}/${m.id}/${key}`} name={key} p={p} values={values} set={set}
        colours={colours} narrow={st.narrow.value} ctx={ctx} />)}
      <div class="params-foot"><button type="button" class="btn small ghost"
        onClick={() => st.editModule(l.id, m.id, () => ({ params: {} }))}>Reset all to defaults</button></div>
    </div>);
}

/** A param's row: its label, then its control (a number's scrub field, or what modulates it, and its ∿; a pick). */
function Control({ name, p, values, set, ctx, colours, narrow }: { name: string; p: Param;
  values: Record<string, ParamValue>; set: (fn: (p: Record<string, ParamValue>) => void) => void;
  ctx: ModCtx; colours: Colours; narrow: boolean }) {
  const { has, bound, value } = shownValue(p, values, name), help = useHelp(p.label, p.help, narrow);
  const put = (v: ParamValue) => set((q) => { q[name] = v; });
  const putOr = (v: ParamValue | undefined) => set((q) => { if (v === undefined) delete q[name]; else q[name] = v; });
  if (p.kind === 'color') {
    const turn = { ...p, label: `${p.label}: rotate`, value: 0, min: 0, max: 1, step: 0.01 };
    return <PickRow label={p.label} value={values[name]} dflt={p.value as string} blend={p.blend ?? 'step'}
      colours={colours} narrow={narrow} help={help}
      put={putOr} turn={(now, put) => <ModButton p={turn} value={now} now={typeof now === 'number' ? now : 0} ctx={ctx}
        put={put} label={`Turn ${p.label}`} title={TITLE} />} />;
  }
  if (p.kind === 'picture') {
    return <PictureRow label={p.label} value={values[name]} dflt={p.value as Picture} palette={colours.palette}
      help={help} put={putOr} />;
  }
  const b = values[name] as Binding, beats = bound && b.mod === 'beats', k = beatsAt(ctx.look().bpm || 120, p);
  const label = beats ? perBeat(p.label) : p.label;
  const clock = keepsTime(name, p) && (!bound || beats) && <BeatClock on={beats} label={label}
    set={(on) => put(on ? { mod: 'beats', per: Number(fmt(value as number / k)) }
      : Math.min(p.max, Math.max(p.min, Number(fmt((b.mod === 'beats' ? b.per ?? 1 : 0) * k)))))} />;
  const field = (id: string) => (p.kind === 'number' ? <>
    {beats ? <Scrub id={id} min={p.min / k} max={p.max / k} step={0.01} value={b.per ?? 1} unit="/beat"
      set={(per) => put({ mod: 'beats', per })} />
      : bound ? <BoundChip b={b} p={p} ctx={ctx} />
      : <Scrub id={id} min={p.min} max={p.max} step={p.step} value={value as number} set={put} />}
    {clock}
    <ModButton p={p} value={values[name]} now={bound ? p.value as number : value as number} ctx={ctx} put={putOr}
      label={`Modulate ${label}`} title={TITLE} /></>
    : p.kind === 'text' ? <input type="text" id={id} class="param-text" value={value as string} maxLength={TEXT_MAX}
      spellcheck={false} autocomplete="off" onChange={(e) => {
        const v = readText(e.currentTarget.value);
        if (v === null) e.currentTarget.value = value as string; else put(v);
      }} />
    : p.kind === 'choice' ? <select id={id} class="param-choice" value={value as string}
      onChange={(e) => put(e.currentTarget.value)}>
      {p.options.map((o) => <option value={o}>{optionText(o, p.options)}</option>)}</select>
    : <input type="checkbox" id={id} class="switch" checked={value as boolean}
      onChange={(e) => put(e.currentTarget.checked)} />);
  // Unused, the reset keeps its place (hidden), so a field never moves under the pointer.
  return (
    <Field label={label} class={cx('param end', p.kind === 'toggle' && 'toggle')} title={help.title}
      hint={help.hint}>
      {(id) => <>{field(id)}{help.button}
        <button type="button" class={cx('param-reset', (!has || value === p.value) && 'unused')}
        title="Reset to default" aria-label={`Reset ${label} to default`}
        onClick={() => set((q) => { delete q[name]; })}>↺</button></>}</Field>);
}

/** A param's help (SPEC "Pattern code"): its row's hover text; on a touch screen, an ⓘ that opens it under the row. */
function useHelp(label: string, help: string | undefined, narrow: boolean): Help {
  const [open, setOpen] = useState(false);
  if (!help) return {};
  if (!narrow) return { title: help };
  return { hint: open && <p class="field-hint param-help">{help}</p>,
    button: <button type="button" class="param-info" aria-expanded={open} aria-label={`About ${label}`}
      onClick={() => setOpen(!open)}>ⓘ</button> };
}
