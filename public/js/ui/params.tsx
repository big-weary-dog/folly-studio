// Controls for the selected module's `params` (SPEC "Pattern code"): numbers become sliders, `type: 'color'` colour
// pickers, `type: 'toggle'` switches. A number can be modulated (SPEC "Param bindings"): an LFO, a global (energy, a
// macro…) or the clip envelope moves it every frame instead of its slider.
import type { ComponentChildren } from 'preact';
import { useId, useRef, useState } from 'preact/hooks';

import type { ParamValue } from '../../../shared/schemas/look.ts';
import {
  type BindingForm, bindingForm, bindingText, decimals, fmt, isBinding, makeBinding, normaliseParam, type Param, SHAPES,
  shownValue,
} from './bindings.ts';
import { Field, humanize, openDialog } from './kit.tsx';
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
      ' in its code to get sliders here.');
  }
  const values = m.params || {};
  const set = (fn: (p: Record<string, ParamValue>) => void) => st.editModule(l.id, m.id, (mod) => {
    const params = { ...mod.params };
    fn(params);
    return { params };
  });
  return (
    <div class="params">
      {entries.map(([key, p]) => <Control key={`${l.id}/${m.id}/${key}`} name={key} p={p} values={values} set={set}
        globals={() => [...GLOBAL_NAMES, ...Object.keys(st.look.peek().globals?.macros || {})]} />)}
      <div class="params-foot"><button type="button" class="btn small ghost"
        onClick={() => st.editModule(l.id, m.id, () => ({ params: {} }))}>Reset all to defaults</button></div>
    </div>);
}

function Control({ name, p, values, set, globals }: { name: string; p: Param; values: Record<string, ParamValue>;
  set: (fn: (p: Record<string, ParamValue>) => void) => void; globals: () => string[] }) {
  const id = useId(), box = useRef<HTMLInputElement>(null), { has, bound, value } = shownValue(p, values, name);
  const put = (v: ParamValue) => set((q) => { q[name] = v; });
  let field;
  if (p.kind === 'number') {
    const fixed = (v: number) => v.toFixed(decimals(p.step));
    field = <>
      <input type="range" id={id} min={p.min} max={p.max} step={p.step} disabled={bound}
        value={bound ? undefined : String(value)} onInput={(e) => put(Number(e.currentTarget.value))} />
      <input type="number" class="param-num" ref={box} min={p.min} max={p.max} step={p.step}
        aria-label={`${p.label} value`} disabled={bound}
        value={document.activeElement === box.current ? undefined : bound ? '' : fixed(value as number)}
        onChange={(e) => {
          const v = parseFloat(e.currentTarget.value);
          put(Number.isFinite(v) ? v : p.value);
        }} />
      <span class="param-chip" hidden={!bound}>{bound && bindingText(values[name] as never)}</span></>;
  } else if (p.kind === 'color') {
    field = <><input type="color" id={id} class="param-color" value={value as string}
      onInput={(e) => put(e.currentTarget.value)} /><span class="param-hex">{value as string}</span></>;
  } else {
    field = <input type="checkbox" id={id} class="switch" checked={value as boolean}
      onChange={(e) => put(e.currentTarget.checked)} />;
  }
  return (
    <div class={`param param-${p.kind}`}>
      <div class="param-head"><label for={id}>{p.label}</label>
        {p.kind === 'number' && <button type="button" class="param-mod" aria-pressed={bound}
          aria-label={`Modulate ${p.label}`} title="Modulate: an LFO, a global or the clip envelope"
          onClick={() => modulate(p, values[name], globals(), (b) => set((q) => {
            if (b) q[name] = b; else delete q[name];
          }))}>
          ∿</button>}
        <button type="button" class="param-reset" title="Reset to default" aria-label={`Reset ${p.label} to default`}
          hidden={!has || value === p.value} onClick={() => set((q) => { delete q[name]; })}>↺</button></div>
      <div class="param-field">{field}</div>
    </div>);
}

/** The modulate dialog for a number param: an LFO, a global or the clip envelope, or nothing. */
function modulate(p: Param, now: ParamValue | undefined, globals: string[], apply: (b: ReturnType<typeof makeBinding>)
  => void) {
  return openDialog({ title: `Modulate ${p.label}`, className: 'modulate-dialog', body: (close) => {
    const [f, setF] = useState(() => bindingForm(isBinding(now) ? now : {}, p, globals));
    const select = (k: keyof BindingForm, opts: string[][]) => (id: string) => <select id={id} value={f[k]}
      onChange={(e) => setF({ ...f, [k]: e.currentTarget.value })}>
      {opts.map(([v, t]) => <option value={v}>{t}</option>)}</select>;
    const field = (label: string, k: keyof BindingForm) => <Field label={label}>{(id) => <input id={id} type="number"
      step="any" value={f[k]} onInput={(e) => setF({ ...f, [k]: e.currentTarget.value })} />}</Field>;
    return <>
      <p class="dialog-text">{`Range ${fmt(p.min)} to ${fmt(p.max)}. A modulated value is held to it.`}</p>
      <Field label="Moved by">{select('mod', [['', 'Nothing: the slider sets it'], ['lfo', 'An LFO'],
        ['global', 'A global'], ['envelope', 'The clip envelope']])}</Field>
      <div class="mod-fields" hidden={f.mod !== 'lfo'}>
        <div class="mod-row"><Field label="Shape">{select('shape', SHAPES.map((s) => [s, humanize(s)]))}</Field>
          {field('Cycles', 'rate')}
          <Field label="Per">{select('unit', [['hz', 'a second (Hz)'], ['beats', 'a beat']])}</Field></div>
        <div class="mod-row">{field('Centre', 'center')}{field('Depth (±)', 'depth')}</div></div>
      <div class="mod-fields" hidden={f.mod !== 'global'}>
        <Field label="Global">{select('name', globals.map((g) => [g, humanize(g)]))}</Field>
        <div class="mod-row">{field('At its lowest', 'from')}{field('At its highest', 'to')}</div></div>
      <div class="mod-fields" hidden={f.mod !== 'envelope'}>
        <div class="mod-row">{field('Outside clips', 'eFrom')}{field('Fully in', 'eTo')}</div></div>
      <div class="dialog-actions">
        <button type="button" class="btn ghost" onClick={() => close()}>Cancel</button>
        <button type="button" class="btn primary" onClick={() => { close(); apply(makeBinding(f, p)); }}>Apply</button>
      </div>
    </>;
  } });
}
