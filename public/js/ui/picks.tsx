// Colour picks in the Studio (SPEC "Palettes"): a colour param's row (its pick in a field the size of a number's, its
// colours lit along it; the field opens the pick tile, ∿ turns it, ↺), and the tile: the palette by role, a popover
// on a wide screen; on a phone a sheet with the palette's roles and a custom colour, the rest shown when set.
import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';

import type { Binding, Pick } from '../../../shared/schemas/look.ts';
import { type PickBlend, plainRoles, stopsFor } from '../core/picks.ts';
import { DEFAULT_PALETTE, type PaletteHex, paletteColours } from '../core/stdlib.ts';
import { bindingText, fmt, isBinding } from './bindings.ts';
import { cx, Field, humanize, Scrub, Switch } from './kit.tsx';
import {
  editText, editValue, type PickEdit, readEdit, rolesOf, roleState, toggleRole, toggleSlot, toggleToken,
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
  // In the side panel: to its left, over the 3D view, level with the button, so it never covers the panel (its
  // + Module). Elsewhere: below the button, or above it when the room is there. The width is the tile's (CSS), so
  // nothing is measured.
  const place = (e: { newState: string; currentTarget: HTMLElement }) => {
    const s = e.currentTarget.style;
    if (e.newState !== 'open' || tile.narrow) { s.top = s.left = s.bottom = s.maxHeight = ''; return; }
    const btn = document.querySelector(`[popovertarget="${pop}"]`) as HTMLElement, r = btn.getBoundingClientRect();
    const side = btn.closest('.side')?.getBoundingClientRect();
    if (side && side.left >= 336) {
      const top = Math.max(8, Math.min(r.top, innerHeight - 420));
      Object.assign(s, { left: `${side.left - 328}px`, top: `${top}px`, bottom: '',
        maxHeight: `${innerHeight - top - 8}px` });
      return;
    }
    const below = innerHeight - r.bottom, up = below < 300 && r.top > below;
    s.left = `${Math.max(8, Math.min(r.left, innerWidth - 328))}px`;
    s.top = up ? '' : `${r.bottom + 4}px`;
    s.bottom = up ? `${innerHeight - r.top + 4}px` : '';
    s.maxHeight = `${(up ? r.top : below) - 12}px`;
  };
  return <>
    <button type="button" id={id} class={cls} popovertarget={pop} aria-label={label} title={label}>{children}</button>
    <div id={pop} popover="auto" class={cx('pick-pop', tile.narrow && 'sheet')} onBeforeToggle={place}>
      <PickTile {...tile} /></div></>;
}

/** The tile: a row per role (all of it, or a slot each), custom colours; then on a wide screen the whole palette,
 * rainbow, whether roles alternate, blend, range and rotate, which a phone shows only when set. */
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
    {custom.length > 0 && <div class="pick-role"><span class="pick-whole">custom</span>
      {cells(custom, () => true, (i) => set(toggleToken(edit, custom[i])), (i) => `Remove ${custom[i]}`)}</div>}
    <div class="pick-more">{!narrow && <>{toggle('all', 'Whole palette')}{toggle('rainbow', 'Rainbow')}</>}
      <label class="btn small pick-custom">+ Custom colour<input type="color" value="#ffffff"
        onChange={(e) => set({ ...edit, tokens: [...edit.tokens, e.currentTarget.value] })} /></label></div>
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

/** A param's help as its row shows it (params.tsx useHelp): hover text, or an ⓘ and the text it opens. */
export type Help = { title?: string; button?: ComponentChildren; hint?: ComponentChildren };
type Modulate = (now: number | Binding | undefined, apply: (b: Binding | null) => void) => void;
/** A colour param's row: its pick and colours (the tile), ∿ to move its rotate, ↺ to reset it. */
export function PickRow({ label, modulate, help = {}, ...tile }: Omit<Tile, 'title'> & { label: string;
  modulate: Modulate; help?: Help }) {
  const edit = readEdit(tile.value, tile.dflt), own = tile.value !== undefined;
  const smooth = (edit.blend ?? tile.blend) === 'smooth';
  const turn = (rotate?: Binding) => tile.put(editValue({ ...edit, rotate }, tile.blend));
  return <Field label={label} class="param end pick" title={help.title} hint={help.hint}>{(id) => <>
    <PickButton {...tile} id={id} title={label} label={`${label}: ${editText(edit)}`} class="pick-btn">
      <span class="pick-text">{editText(edit).replace(/\//g, ' / ')}</span>
      <Strip stops={played(tile.colours, tile.value, tile.dflt, tile.blend)} smooth={smooth} />
    </PickButton>
    <button type="button" class="param-mod" aria-pressed={isBinding(edit.rotate)} aria-label={`Turn ${label}`}
      title="Turn its colours: an LFO, a global or the clip envelope moves its rotate"
      onClick={() => modulate(edit.rotate, (b) => turn(b ?? undefined))}>∿</button>{help.button}
    <button type="button" class={cx('param-reset', !own && 'unused')} title="Reset to default"
      aria-label={`Reset ${label} to default`} onClick={() => tile.put(undefined)}>↺</button></>}</Field>;
}
