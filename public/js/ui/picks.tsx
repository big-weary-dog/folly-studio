// Colour picks in the Studio (SPEC "Palettes"): a colour param's row (its pick in a field the size of a number's, its
// colours lit along it; the field opens the pick tile, ∿ turns it, ↺), and the tile: the palette by role, a popover
// on a wide screen; on a phone a sheet with the palette's roles and custom colours, the rest shown when set.
import type { ComponentChildren } from 'preact';
import { useId, useState } from 'preact/hooks';

import type { Binding, Pick } from '../../../shared/schemas/look.ts';
import { type PickBlend, plainRoles, stopsFor } from '../core/picks.ts';
import { DEFAULT_PALETTE, type PaletteHex, paletteColours } from '../core/stdlib.ts';
import { bindingText, fmt, isBinding } from './bindings.ts';
import { cx, Field, humanize, placePopover, Scrub, Switch } from './kit.tsx';
import {
  addColour, CUSTOM_MAX, editText, editValue, type PickEdit, readEdit, rolesOf, roleState, toggleRole, toggleSlot,
  toggleToken,
} from './pick-model.ts';

/** What picks resolve against here: the look's palette. */
export type Colours = { palette: PaletteHex };
type Put = (v: Pick | undefined) => void;
const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
const hexOf = (c: readonly number[]) => `#${byte(c[0])}${byte(c[1])}${byte(c[2])}`;

/** The colours a pick plays (its value, else its default) on this palette, as hex. */
function played(c: Colours, value: unknown, dflt: unknown, blend: PickBlend) {
  const R = plainRoles(paletteColours(c.palette) ?? paletteColours(DEFAULT_PALETTE)!);
  return stopsFor(value, dflt, R, blend).map(hexOf);
}

/** Colours as glass: a pane each (step), or one ramp (smooth). */
const Strip = ({ stops, smooth }: { stops: string[]; smooth: boolean }) => {
  const ramp = smooth && stops.length > 1;
  return <span class="pick-strip" aria-hidden="true"
    style={ramp ? { background: `linear-gradient(90deg, ${stops.join(', ')})` } : undefined}>
    {!ramp && stops.map((c) => <i style={{ background: c }} />)}</span>;
};

type Tile = { title: string; value: unknown; dflt: string; blend: PickBlend; colours: Colours; narrow: boolean;
  put: Put };
/** A button that opens the pick tile beside it (a sheet on a phone). */
function PickButton({ id, label, class: cls, children, ...tile }: Tile & { id?: string; label: string; class: string;
  children: ComponentChildren }) {
  const pop = useId();
  const place = (e: { newState: string; currentTarget: HTMLElement }) => placePopover(e, pop, 320, tile.narrow);
  return <>
    <button type="button" id={id} class={cls} popovertarget={pop} aria-label={label} title={label}>{children}</button>
    <div id={pop} popover="auto" class={cx('pick-pop', tile.narrow && 'sheet')} onBeforeToggle={place}>
      <PickTile {...tile} /></div></>;
}

/** A swatch that opens the browser's chooser (Chrome's has no OK, and says only `input` while it is open), and + to
 * add the colour it shows. */
function CustomColour({ add }: { add: (hex: string) => void }) {
  const [hex, setHex] = useState('#ffffff');
  return <span class="pick-custom"><input type="color" class="pick-swatch" value={hex} aria-label="Custom colour"
    title="Choose a colour" onInput={(e) => setHex(e.currentTarget.value)} />
    <button type="button" class="btn small" aria-label="Add colour" title="Add this colour"
      onClick={() => add(hex)}>+</button></span>;
}

/** The tile: a row per role (all of it, or a slot each), custom colours (it adds up to CUSTOM_MAX); then on a wide
 * screen the whole palette, rainbow, whether roles alternate, blend, range and rotate, which a phone shows when set. */
function PickTile({ title, value, dflt, blend, colours, narrow, put }: Tile) {
  const edit = readEdit(value, dflt), set = (e: PickEdit) => put(editValue(e, blend));
  const smooth = (edit.blend ?? blend) === 'smooth', turn = edit.rotate, [from, to] = edit.range ?? [0, 1];
  const toggle = (t: string, text: string) => <button type="button" class="btn small" aria-pressed={edit.tokens
    .includes(t)} onClick={() => set(toggleToken(edit, t))}>{text}</button>;
  const custom = edit.tokens.filter((t) => t.startsWith('#'));
  const cells = (list: string[], on: (i: number) => boolean, click: (i: number) => void, name: (i: number) => string) =>
    <span class="pick-cells">{list.map((c, i) => <button type="button" class="pick-cell" style={{ background: c }}
      aria-pressed={on(i)} title={`${name(i)} · ${c}`} aria-label={name(i)} onClick={() => click(i)} />)}</span>;
  const chips = [edit.tokens.includes('all') && 'Whole palette', edit.tokens.includes('rainbow') && 'Rainbow',
    edit.blend && humanize(edit.blend), edit.range && `Range ${fmt(from)}–${fmt(to)}`,
    turn !== undefined && `Rotate ${isBinding(turn) ? bindingText(turn) : fmt(turn)}`].filter(Boolean);
  return <div class="pick-tile">
    <div class="pick-head"><strong>{title}</strong>
      <Strip stops={played(colours, value, dflt, blend)} smooth={smooth} />
      <button type="button" class="icon-btn" aria-label="Close"
        onClick={(e) => (e.currentTarget.closest('[popover]') as HTMLElement).hidePopover()}>×</button></div>
    {rolesOf(colours.palette).map(({ role, colours: list }) => {
      const s = roleState(edit, role);
      return <div class="pick-role"><label class="pick-whole"><input type="checkbox" checked={s.whole}
        indeterminate={!s.whole && s.slots.size > 0}
        onChange={(e) => { e.currentTarget.checked = s.whole; set(toggleRole(edit, role)); }} />{role}</label>
      {cells([...list], (i) => s.whole || s.slots.has(i + 1), (i) => set(toggleSlot(edit, role, i + 1, list.length)),
        (i) => `${role}${i + 1}`)}</div>;
    })}
    <div class="pick-role"><span class="pick-whole">custom</span>
      <span class="pick-cells">{custom.map((c) => <button type="button" class="pick-cell pick-own"
        style={{ background: c }} title={`Remove ${c}`} aria-label={`Remove ${c}`}
        onClick={() => set(toggleToken(edit, c))}>×</button>)}</span>
      {custom.length < CUSTOM_MAX && <CustomColour add={(hex) => set(addColour(edit, hex))} />}</div>
    {!narrow && <div class="pick-more">{toggle('all', 'Whole palette')}{toggle('rainbow', 'Rainbow')}</div>}
    {narrow ? chips.length > 0 && <p class="pick-chips">{chips.map((c) => <span class="param-chip">{c}</span>)}</p> : <>
      <Switch label="Alternate roles" class="pick-deal" checked={edit.deal} title="Deal the roles in turn (/)"
        onChange={(on) => set({ ...edit, deal: on })} />
      <Field label="Blend">{(['step', 'smooth'] as const).map((b) => <button type="button" class="btn small pick-seg"
        aria-pressed={(edit.blend ?? blend) === b} onClick={() => set({ ...edit, blend: b })}>{humanize(b)}</button>)}
      </Field>
      <Field label="Range" class="end">{(id) => <>
        <Scrub id={id} label="Range from" min={0} max={1} step={0.01} value={from}
          set={(v) => set({ ...edit, range: [Math.min(v, to), to] })} />
        <Scrub label="Range to" min={0} max={1} step={0.01} value={to}
          set={(v) => set({ ...edit, range: [from, Math.max(v, from)] })} /></>}</Field>
      <Field label="Rotate" class="end">{(id) => (isBinding(turn) ? <span class="param-chip">{bindingText(turn)}</span>
        : <Scrub id={id} min={0} max={1} step={0.01} value={turn ?? 0}
          set={(v) => set({ ...edit, rotate: v || undefined })} />)}</Field></>}
    <div class="pick-foot"><button type="button" class="btn small ghost" disabled={value === undefined}
      onClick={() => put(undefined)}>Reset</button></div>
  </div>;
}

/** An empty button's place in a param's row, so the rows' boxes and buttons line up in columns. */
export const Slot = () => <span class="param-slot" aria-hidden="true" />;
/** A param's help as its row shows it (params.tsx useHelp): hover text, or an ⓘ and the text it opens. */
export type Help = { title?: string; button?: ComponentChildren; hint?: ComponentChildren };
type Turn = (now: number | Binding | undefined, put: (v: unknown) => void) => ComponentChildren;
/** A colour param's row: its pick and colours (the tile), ∿ to move its rotate (`turn`: the button and its popover),
 * ↺ to reset it. */
export function PickRow({ label, turn, help = {}, tour, ...tile }: Omit<Tile, 'title'> & { label: string;
  turn: Turn; help?: Help; tour?: string }) {
  const edit = readEdit(tile.value, tile.dflt), own = tile.value !== undefined;
  const smooth = (edit.blend ?? tile.blend) === 'smooth';
  const rotate = (v: unknown) => tile.put(editValue({ ...edit, rotate: typeof v === 'number' || isBinding(v) ? v
    : undefined }, tile.blend));
  return <Field label={label} class="param end pick" title={help.title} hint={help.hint} tour={tour}>{(id) => <>
    <PickButton {...tile} id={id} title={label} label={`${label}: ${editText(edit)}`} class="pick-btn">
      <span class="pick-text">{editText(edit).replace(/\//g, ' / ')}</span>
      <Strip stops={played(tile.colours, tile.value, tile.dflt, tile.blend)} smooth={smooth} />
    </PickButton>
    <Slot />{turn(edit.rotate, rotate)}{help.button}
    <button type="button" class={cx('param-reset', !own && 'unused')} title="Reset to default"
      aria-label={`Reset ${label} to default`} onClick={() => tile.put(undefined)}>↺</button></>}</Field>;
}
