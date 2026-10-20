// Modulation in place (SPEC "Param bindings", "Globals"): ∿ opens a drawer beside the 3D view, not a modal: every
// change applies as you make it, so the view shows it, and Revert puts back what was there when it opened. A param
// can follow a modulator (a macro that moves), a fader or a look global, or share its own LFO as a new modulator;
// the modulator it follows is renamed and edited there, in a drawer of its own over this one (an LFO, which may
// follow faders: one level only). A speed keeps time with the beat by the clock on its field, not here; a binding
// to the clip envelope or a tempo pulse from before shows as old, with Off.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

import type { Binding, ParamValue } from '../../../shared/schemas/look.ts';
import { GLOBALS } from '../core/globals.ts';
import {
  type BindingForm, bindingForm, bindingText, fmt, GLYPHS, isBinding, makeBinding, type Param, RATES, SHAPES,
  shareLfo,
} from './bindings.ts';
import { BeatClock } from './beat-clock.tsx';
import { Drawer, useDrawer } from './drawer.tsx';
import { Field, humanize } from './kit.tsx';
import { type ModCtx, NowBar, Wave } from './mod-live.tsx';

export { BoundChip, type ModCtx } from './mod-live.tsx';

/** The ∿ button and its drawer. `put` sets the param's value (a binding, a number, or undefined: its default). */
export function ModButton({ p, value, now, ctx, put, label, title }: { p: Param; value: ParamValue | undefined;
  now: number; ctx: ModCtx; put: (v: ParamValue | undefined) => void; label: string; title: string }) {
  const d = useDrawer(), [at, setAt] = useState({ n: 0, start: value });   // what was there when it opened
  const restart = (start: ParamValue | undefined) => setAt({ n: at.n + 1, start });
  return <>
    <button type="button" class="param-mod" aria-pressed={isBinding(value) && value.mod !== 'beats'}
      aria-expanded={d.open} aria-label={label} title={title}
      onClick={() => { if (!d.open) restart(value); d.toggle(); }}>∿</button>
    <Drawer d={d} title={label} class="mod-drawer" actions={<button type="button" class="btn small ghost"
      onClick={() => { put(at.start); restart(at.start); }}>Revert</button>}>
      <ModPanel key={at.n} p={p} start={at.start} now={now} ctx={ctx} put={put} /></Drawer></>;
}

const KINDS: [BindingForm['mod'], string][] = [['lfo', 'LFO'], ['global', 'Macro'], ['', 'Off']];
const SELF_KINDS: [BindingForm['mod'], string][] = [['lfo', 'LFO'], ['global', 'Macro'], ['', 'Off: a fader']];

/** What a look offers to follow: its modulators (macros that move), faders (macros without a mod) and globals. */
function follows(ctx: ModCtx) {
  const macros = Object.entries(ctx.look().globals?.macros ?? {}).filter(([n]) => n !== ctx.self);
  return { modulators: ctx.self ? [] : macros.filter(([, m]) => m.mod), faders: macros.filter(([, m]) => !m.mod)
    .map(([n]) => n), globals: Object.keys(GLOBALS) };
}

/** The popover's body: what moves the param, each kind's fields, applied as they change. */
function ModPanel({ p, start, now, ctx, put }: { p: Param; start: ParamValue | undefined; now: number;
  ctx: ModCtx; put: (v: ParamValue | undefined) => void }) {
  const bpm = ctx.look().bpm || 120, { modulators, faders, globals } = follows(ctx);
  const names = [...modulators.map(([n]) => n), ...faders, ...globals];
  const fresh = () => bindingForm(isBinding(start) ? start : {}, p, names, now, bpm);
  const [f, setF] = useState(fresh);
  const set = (patch: Partial<BindingForm>) => {
    const next = { ...f, ...patch };
    setF(next);
    put(makeBinding(next, p) ?? (isBinding(start) ? undefined : start));
  };
  const seg = (k: keyof BindingForm, opts: [string, string][]) => opts.map(([v, t]) => <button type="button"
    class="btn small mod-seg" aria-pressed={f[k] === v} onClick={() => set({ [k]: v })}>{t}</button>);
  const num = (k: keyof BindingForm, name: string) => <input type="number" step="any" class="mod-num"
    aria-label={name} value={f[k]} onInput={(e) => set({ [k]: e.currentTarget.value })} />;
  const fader = (k: 'amount' | 'pace', name: string) => <select class="mod-fader" aria-label={name} value={f[k]}
    onChange={(e) => set({ [k]: e.currentTarget.value })}><option value="">none</option>
    {[...faders, ...globals].map((g) => <option value={g}>{globals.includes(g) ? humanize(g) : g}</option>)}</select>;
  const range = <span class="mod-note">of {fmt(p.min)}…{fmt(p.max)}</span>;
  const beats = f.unit === 'beats', rate = parseFloat(f.rate) || 1;
  const picked = modulators.find(([n]) => n === f.name)?.[1];
  const old = f.mod === 'envelope' ? 'Clip fade (old): the layer\'s clip fade moves it.'
    : f.mod === 'beats' && ctx.self ? 'Tempo pulse (old): it counts up with the beats.' : '';
  function share() {
    const b = makeBinding(f, p);
    if (b?.mod !== 'lfo' || !ctx.share) return;
    const s = shareLfo(b, p, ''), name = ctx.share(s.mod, p.label);
    const binding = { ...s.binding, name } as Binding;
    setF(bindingForm(binding, p, [name], now, bpm));
    put(binding);
  }
  return <div class="mod-panel">
    <div class="mod-kinds mod-segs" role="group" aria-label="Moved by">{seg('mod', ctx.self ? SELF_KINDS : KINDS)}
    </div>
    {old && <p class="mod-note mod-old">{old}<button type="button" class="btn small"
      onClick={() => set({ mod: '' })}>Off</button></p>}
    {f.mod === 'beats' && !ctx.self && <p class="mod-note">In time with the beat: the clock beside its field sets
      it per beat.</p>}
    {f.mod === '' && <p class="mod-note">{ctx.self ? 'Nothing moves it: you, a lane or the Pi set it.'
      : 'Nothing moves it: its field sets it.'}</p>}
    {f.mod === 'lfo' && <>
      <Wave f={f} p={p} ctx={ctx} />
      <Field label="Shape"><span class="mod-segs">{seg('shape', SHAPES.map((s) => [s, `${GLYPHS[s]} ${s}`]))}
      </span></Field>
      {f.shape === 'hold' && <Field label="Hold">{num('hold', 'Hold: the share of each cycle held')}
        <span class="mod-note">of each cycle, half at each end</span></Field>}
      <Field label="Rate">{beats ? <input type="number" step="any" class="mod-num" aria-label="Beats a cycle"
        value={fmt(1 / rate)}
        onInput={(e) => { const n = parseFloat(e.currentTarget.value); if (n > 0) set({ rate: String(1 / n) }); }} />
        : num('rate', 'Cycles a second')}
        <BeatClock on={beats} label="Rate" set={(on) => set(on ? { unit: 'beats', rate: String(rate * 60 / bpm) }
          : { unit: 'hz', rate: fmt(rate * bpm / 60) })} />
        <span class="mod-note">{beats ? `beats a cycle at ${bpm} BPM` : 'cycles a second (Hz)'}</span></Field>
      {beats && <Field label=""><span class="mod-segs">{RATES.map(([t, r]) => <button type="button"
        class="btn small mod-seg" aria-pressed={rate === r} onClick={() => set({ rate: String(r) })}>{t}</button>)}
      </span></Field>}
      <Field label="Rate ×">{fader('pace', 'Rate times a fader')}<span class="mod-note">speeds it up or slows it</span>
      </Field>
      <Field label="Swing ×">{fader('amount', 'Swing times a fader')}<span class="mod-note">scales its swing; 0 holds
        it</span></Field>
      <Field label="Between">{num('lo', 'From')}<span class="mod-note">and</span>{num('hi', 'To')}{range}</Field>
      {ctx.share && <button type="button" class="btn small mod-share" onClick={share}
        title="A new modulator moves this param; bind others to it to keep them in step">
        ⇪ Share this LFO as a modulator…</button>}</>}
    {f.mod === 'global' && <>
      {modulators.length > 0 && <List title="Modulators">{modulators.map(([n, m]) => <Pick f={f} n={n} set={set}
        glyph={m.mod?.mod === 'lfo' ? GLYPHS[m.mod.shape ?? 'sine'] : '♩'}
        text={`${n} · ${bindingText(m.mod!, { min: 0, max: 1 }).replace(/ · [^·]*$/, '').replace(/^\S+ /, '')}`}
        ctx={ctx} />)}</List>}
      {picked && ctx.edit && <ModulatorEdit key={f.name} name={f.name} m={picked} ctx={ctx}
        renamed={(to) => set({ name: to })} />}
      {faders.length > 0 && <List title="Faders">{faders.map((n) => <Pick f={f} n={n} set={set} glyph="◆"
        text={n} ctx={ctx} />)}</List>}
      <List title="Look globals"><div class="mod-segs">{globals.map((g) => <button type="button"
        class="btn small mod-seg" aria-pressed={f.name === g} onClick={() => set({ name: g })}>{humanize(g)}</button>)}
      </div></List>
      <Field label="Between" title="The param at the fader's lowest, and at its highest">{num('from', 'At its lowest')}
        <span class="mod-note">and</span>{num('to', 'At its highest')}{range}</Field></>}
  </div>;
}

type Macro = NonNullable<NonNullable<ReturnType<ModCtx['look']>['globals']>['macros']>[string];

/** The modulator a param follows: its name to rename, and ∿ for how it moves (every param following it changes). */
function ModulatorEdit({ name, m, ctx, renamed }: { name: string; m: Macro; ctx: ModCtx;
  renamed: (to: string) => void }) {
  const p: Param = { kind: 'number', label: name, value: m.value, min: m.min, max: m.max,
    step: (m.max - m.min) / 100, options: [] };
  return <div class="mod-edit">
    <input type="text" class="mod-name" value={name} maxlength={32} spellcheck={false} aria-label={`Rename ${name}`}
      onChange={(e) => {
        const to = e.currentTarget.value.trim();
        if (to === name) return;
        if (ctx.edit!.rename(name, to)) renamed(to); else e.currentTarget.value = name;
      }} />
    <span class="mod-note">moves every param that follows it</span>
    <ModButton p={p} value={m.mod ?? m.value} now={m.value} ctx={{ ...ctx, self: name }}
      put={(v) => ctx.edit!.mod(name, v)} label={`Edit ${name}`} title={`How ${name} moves`} /></div>;
}

function List({ title, children }: { title: string; children: ComponentChildren }) {
  return <div class="mod-list" role="group" aria-label={title}><div class="mod-list-h">{title}</div>{children}</div>;
}

/** A modulator or fader to follow: its name and how it moves, and its value now. */
function Pick({ f, n, set, glyph, text, ctx }: { f: BindingForm; n: string; set: (p: Partial<BindingForm>) => void;
  glyph: string; text: string; ctx: ModCtx }) {
  return <button type="button" class="mod-pick" aria-pressed={f.name === n} onClick={() => set({ name: n })}>
    <span class="mod-glyph">{glyph}</span><span class="mod-pick-text">{text}</span><NowBar ctx={ctx} name={n} />
  </button>;
}
