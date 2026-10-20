// Modulation in place (SPEC "Param bindings", "Globals"): ∿'s popover beside the row, not a modal: every change
// applies as you make it, so the 3D view shows it, and Revert puts back what was there when it opened. A param can
// follow a modulator (a macro that moves), a fader or a look global, or share its own LFO as a new modulator; the
// modulator it follows is renamed and edited there, in its own nested popover (an LFO or tempo pulse, which may
// follow faders: one level only).
import type { ComponentChildren } from 'preact';
import { useId, useState } from 'preact/hooks';

import type { Binding, ParamValue } from '../../../shared/schemas/look.ts';
import { GLOBALS } from '../core/globals.ts';
import {
  type BindingForm, bindingForm, bindingText, fmt, GLYPHS, isBinding, makeBinding, type Param, RATES, SHAPES,
  shareLfo, tempoNote,
} from './bindings.ts';
import { cx, Field, humanize, placePopover } from './kit.tsx';
import { type ModCtx, NowBar, Wave } from './mod-live.tsx';

export { BoundChip, type ModCtx } from './mod-live.tsx';

/** The ∿ button and its popover. `put` sets the param's value (a binding, a number, or undefined: its default). */
export function ModButton({ p, value, now, ctx, put, label, title }: { p: Param; value: ParamValue | undefined;
  now: number; ctx: ModCtx; put: (v: ParamValue | undefined) => void; label: string; title: string }) {
  const pop = useId(), [open, setOpen] = useState(0);
  const place = (e: { newState: string; currentTarget: HTMLElement }) => placePopover(e, pop, 400, ctx.narrow);
  return <>
    <button type="button" class="param-mod" popovertarget={pop} aria-pressed={isBinding(value)} aria-label={label}
      title={title}>∿</button>
    <div id={pop} popover="auto" class={cx('mod-pop', ctx.narrow && 'sheet')} onBeforeToggle={place}
      onToggle={(e) => setOpen(e.newState === 'open' ? open + 1 : 0)}>
      {open > 0 && <ModPanel key={open} p={p} start={value} now={now} ctx={ctx} put={put} label={label} />}</div></>;
}

const KINDS: [BindingForm['mod'], string][] = [['lfo', 'LFO'], ['global', 'Modulator / macro'],
  ['envelope', 'Envelope'], ['beats', 'Tempo'], ['', 'Off']];
const SELF_KINDS: [BindingForm['mod'], string][] = [['lfo', 'LFO'], ['beats', 'Tempo'], ['global', 'Macro'],
  ['', 'Off: a fader']];

/** What a look offers to follow: its modulators (macros that move), faders (macros without a mod) and globals. */
function follows(ctx: ModCtx) {
  const macros = Object.entries(ctx.look().globals?.macros ?? {}).filter(([n]) => n !== ctx.self);
  return { modulators: ctx.self ? [] : macros.filter(([, m]) => m.mod), faders: macros.filter(([, m]) => !m.mod)
    .map(([n]) => n), globals: Object.keys(GLOBALS) };
}

/** The popover's body: what moves the param, each kind's fields, applied as they change. */
function ModPanel({ p, start, now, ctx, put, label }: { p: Param; start: ParamValue | undefined; now: number;
  ctx: ModCtx; put: (v: ParamValue | undefined) => void; label: string }) {
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
  const beats = f.unit === 'beats', tempo = tempoNote(parseFloat(f.per) || 0, bpm, p);
  const picked = modulators.find(([n]) => n === f.name)?.[1];
  function share() {
    const b = makeBinding(f, p);
    if (b?.mod !== 'lfo' || !ctx.share) return;
    const s = shareLfo(b, p, ''), name = ctx.share(s.mod, p.label);
    const binding = { ...s.binding, name } as Binding;
    setF(bindingForm(binding, p, [name], now, bpm));
    put(binding);
  }
  return <div class="mod-panel">
    <div class="mod-head"><strong>{label}</strong>
      <button type="button" class="btn small ghost" onClick={() => { setF(fresh()); put(start); }}>Revert</button>
      <button type="button" class="icon-btn" aria-label="Close"
        onClick={(e) => (e.currentTarget.closest('[popover]') as HTMLElement).hidePopover()}>×</button></div>
    <div class="mod-kinds" role="group" aria-label="Moved by">{seg('mod', ctx.self ? SELF_KINDS : KINDS)}</div>
    {f.mod === '' && <p class="mod-note">{ctx.self ? 'Nothing moves it: you, a lane or the Pi set it.'
      : 'Nothing moves it: its field sets it.'}</p>}
    {f.mod === 'lfo' && <>
      <Wave f={f} p={p} ctx={ctx} />
      <Field label="Shape"><span class="mod-pills">{seg('shape', SHAPES.map((s) => [s, `${GLYPHS[s]} ${s}`]))}
      </span></Field>
      {f.shape === 'hold' && <Field label="Hold">{num('hold', 'Hold: the share of each cycle held')}
        <span class="mod-note">of each cycle, half at each end</span></Field>}
      <Field label="Rate"><span class="mod-pills">
        {RATES.map(([t, r]) => <button type="button" class="btn small mod-seg" aria-pressed={beats
          && parseFloat(f.rate) === r} onClick={() => set({ unit: 'beats', rate: String(r) })}>{t}</button>)}
        <button type="button" class="btn small mod-seg" aria-pressed={!beats}
          onClick={() => set({ unit: 'hz', rate: beats ? fmt(parseFloat(f.rate) * bpm / 60) : f.rate })}>Hz</button>
      </span></Field>
      {beats ? <Field label="Every"><input type="number" step="any" class="mod-num" aria-label="Beats a cycle"
        value={fmt(1 / (parseFloat(f.rate) || 1))}
        onInput={(e) => { const n = parseFloat(e.currentTarget.value); if (n > 0) set({ rate: String(1 / n) }); }} />
        <span class="mod-note">beats a cycle, at {bpm} BPM</span></Field>
        : <Field label="Rate">{num('rate', 'Cycles a second')}<span class="mod-note">cycles a second (Hz)</span>
        </Field>}
      <Field label="Rate ×">{fader('pace', 'Rate times a fader')}<span class="mod-note">a fader speeds it up or slows
        it</span></Field>
      <Field label="Swing ×">{fader('amount', 'Swing times a fader')}<span class="mod-note">a fader scales its swing:
        0 holds it mid-way</span></Field>
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
      <List title="Look globals"><div class="mod-pills">{globals.map((g) => <button type="button"
        class="btn small mod-seg" aria-pressed={f.name === g} onClick={() => set({ name: g })}>{humanize(g)}</button>)}
      </div></List>
      <Field label="At its lowest">{num('from', 'At its lowest')}</Field>
      <Field label="At its highest">{num('to', 'At its highest')}{range}</Field></>}
    {f.mod === 'envelope' && <>
      <Field label="Outside clips">{num('eFrom', 'Outside clips')}</Field>
      <Field label="Fully in">{num('eTo', 'Fully in')}{range}</Field></>}
    {f.mod === 'beats' && <>
      <Field label="A beat">{num('per', 'How many a beat')}<span class={cx('mod-note', tempo.out && 'mod-warn')}>
        {tempo.text}</span></Field>
      <p class={cx('mod-note', tempo.out && 'mod-warn')}>{tempo.out
        ? `Out of range: it is held to ${fmt(p.min)}…${fmt(p.max)}. ` : ''}The look's BPM is on the Timeline.</p></>}
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
