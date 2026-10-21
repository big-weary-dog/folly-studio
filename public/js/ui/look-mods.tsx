// The Look panel's modulators and what each macro drives (SPEC "Composition"): a card per modulator (its name to
// rename, how it moves, its value now, ∿ to edit it, × to delete it) and a chip per param it drives, which selects
// that layer and module and opens the param's ∿.
import type { Globals } from '../../../shared/schemas/look.ts';
import { fmt, GLYPHS, normaliseParam, type Param } from './bindings.ts';
import { automate } from './automation-edit.ts';
import { humanize } from './kit.tsx';
import { modulatorEdits, renameMacro } from './look-globals-edit.ts';
import { ModButton, type ModCtx } from './modulate.tsx';
import { NowBar } from './mod-live.tsx';
import { moveText, type Use, useText } from './mod-uses.ts';
import type { Studio } from './studio-store.ts';

type Macro = NonNullable<Globals['macros']>[string];

/** Where a use is: "Rose › Speed" (the layer's title, the param's label), or the macro it moves; the label. */
function placeOf(st: Studio, u: Use) {
  if (u.macro) return { place: u.macro, label: '' };
  const l = st.look.peek().layers.find((x) => x.id === u.layer), m = l?.modules.find((x) => x.id === u.module);
  const p = l && m ? normaliseParam(u.key!, st.status.params(l.id, m).schema?.[u.key!]) : null;
  const label = p?.label ?? humanize(u.key!);
  return { place: `${l?.title || 'Layer'} › ${label}`, label };
}

/** Selects the use's layer and module, shows its params and opens the param's ∿ (a phone: Layers, its settings). */
export function jump(st: Studio, u: Use, label: string) {
  if (!u.layer || !u.module) return;
  st.select(u.layer);
  st.pickModule(u.module);
  if (st.narrow.peek()) st.setTab('layers');
  else if (st.side.peek() === 'layers') st.showSide('split');
  let tries = 20;
  const open = () => {
    if (st.narrow.peek()) (document.querySelector('.layer.selected .layer-name') as HTMLElement | null)?.click();
    const mod = [...document.querySelectorAll<HTMLElement>('.pane-params .param-mod')].find((b) =>
      [`Modulate ${label}`, `Turn ${label}`].includes(b.getAttribute('aria-label') ?? ''));
    if (mod) { mod.scrollIntoView({ block: 'nearest' }); mod.click(); } else if (--tries) requestAnimationFrame(open);
  };
  requestAnimationFrame(open);
}

/** A chip per use: a param's jumps to it; another macro's (its swing or pace) just says so. */
export function Drives({ st, uses }: { st: Studio; uses: Use[] }) {
  if (!uses.length) return null;
  return <div class="mod-drives" role="group" aria-label="What it drives">{uses.map((u) => {
    const { place, label } = placeOf(st, u), text = useText(u, place), b = u.b;
    const range = u.how === 'follows' && b.mod === 'global' && b.from !== undefined && b.to !== undefined
      ? `${fmt(b.from)}…${fmt(b.to)}` : '';
    return u.layer ? <button type="button" class="mod-tag" title={`Open ${text}`}
      onClick={() => jump(st, u, label)}>{text}{range && <span class="mod-tag-range">{range}</span>}</button>
      : <span class="mod-tag">{text}</span>;
  })}</div>;
}

/** The look's modulators, a card each. */
export function ModulatorCards({ st, mods, uses }: { st: Studio; mods: [string, Macro][];
  uses: Map<string, Use[]> }) {
  const edit = modulatorEdits(st);
  return <ul class="mod-cards">{mods.map(([name, m]) => <Card key={name} st={st} name={name} m={m}
    uses={uses.get(name) ?? []} edit={edit} />)}</ul>;
}

function Card({ st, name, m, uses, edit }: { st: Studio; name: string; m: Macro; uses: Use[];
  edit: ReturnType<typeof modulatorEdits> }) {
  const ctx: ModCtx = { look: () => st.look.peek(), t: () => st.clock.t, clips: () => null, narrow: st.narrow.value,
    self: name, automate: (range, now) => automate(st, range, now, { macro: name }) };
  const p: Param = { kind: 'number', label: name, value: m.value, min: m.min, max: m.max,
    step: (m.max - m.min) / 100, options: [] };
  const mod = m.mod!;
  return <li class="mod-card" data-name={name}>
    <div class="mod-card-head">
      <input type="text" class="macro-name" value={name} maxlength={32} spellcheck={false}
        aria-label={`Rename ${name}`} onChange={(e) => {
          const to = e.currentTarget.value.trim();
          if (to !== name && !edit.rename(name, to)) e.currentTarget.value = name;
        }} />
      <span class="mod-glyph" aria-hidden="true">{mod.mod === 'lfo' ? GLYPHS[mod.shape ?? 'sine'] : '♩'}</span>
      <span class="mod-how">{moveText(mod).replace(/^\S+ /, '')}</span>
      <NowBar ctx={ctx} name={name} />
      <ModButton p={p} value={mod} now={m.value} ctx={ctx} put={(v) => edit.mod(name, v)} label={`Edit ${name}`}
        title={`How ${name} moves, for every param that follows it`} />
      <button type="button" class="icon-btn wide-only" aria-label={`Delete ${name}`}
        title="Delete it: the params that follow it go back to their fields"
        onClick={() => st.edit((L) => renameMacro(L, name, null))}>×</button></div>
    {uses.length ? <Drives st={st} uses={uses} /> : <p class="mod-note">Drives nothing yet: on a param, ∿ › Modulator
      follows it.</p>}
  </li>;
}
