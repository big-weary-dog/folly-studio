// The Look panel (SPEC "Globals"): fields for the look's speed, level, hue, saturation and energy, a palette picker
// showing its roles, the look's modulators (look-mods.tsx), and faders (macros that do not move by themselves) to add,
// rename and set (their range: as the API or a generator gave it), each saying what it drives. Wide: a tab of the
// bottom dock; phones: the Look tab (faders are set there, not added). It keeps in look.globals only what differs
// from the defaults. Loaded when the Look tab first shows.
import { useId } from 'preact/hooks';

import { GLOBALS, macroNameOk } from '../core/globals.ts';
import { PALETTE_ROLES } from '../core/stdlib.ts';
import type { Globals, Palette } from '../../../shared/schemas/look.ts';
import { cx, Field, humanize, Scrub } from './kit.tsx';
import { renameMacro } from './look-globals-edit.ts';
import { Drives, ModulatorCards } from './look-mods.tsx';
import { macroUses, type Use } from './mod-uses.ts';
import type { Studio } from './studio-store.ts';

const HELP: Record<string, string> = { speed: 'How fast every pattern runs; changes never jump',
  level: 'Master brightness', hue: 'Turns every colour round the wheel', saturation: '0 is grey, 2 is vivid',
  energy: 'Calm to busy: patterns read it as G.energy' };
type Key = keyof typeof GLOBALS;
type Macro = NonNullable<Globals['macros']>[string];

export function GlobalsPanel({ st, palettes }: { st: Studio; palettes: (Palette & { theme: string })[] }) {
  const L = st.look.value, g: Globals = L.globals || {}, lanes = L.automation || {};
  const set = (fn: (g: Globals) => void) => st.editGlobals((x) => { fn(x); return x; });
  const house = palettes.find((p) => p.name === g.palette?.name), named = !!house;
  const pal = g.palette || palettes.find((p) => p.name === 'chapel');
  const uses = macroUses(L), all = Object.entries(g.macros || {}), mods = all.filter(([, m]) => m.mod);
  function addMacro() {
    const macros = { ...g.macros };
    let n = 1;
    while (macros[`macro${n}`]) n++;
    macros[`macro${n}`] = { value: 0.5, min: 0, max: 1 };
    set((x) => { x.macros = macros; });
  }
  return (
    <div class="look-globals">
      <section class="globals-values" aria-label="Globals">
        {(Object.entries(GLOBALS) as [Key, Macro][]).map(([key, d]) => <Row key={key} name={key} d={d}
          value={g[key] ?? d.value} automated={!!lanes[key]}
          set={(v) => set((x) => { if (v === d.value) delete x[key]; else x[key] = v; })} />)}
      </section>
      <section class="globals-palette" aria-label="Palette" data-tour="palette">
        <Field label="Palette">{(id) => <select class="palette-select" id={id} value={named ? g.palette?.name : ''}
          onChange={(e) => {
            const p = palettes.find((x) => x.name === e.currentTarget.value);
            set((x) => {
              const roles = PALETTE_ROLES.map((r: string) => [r, [...p?.[r as 'low'] || []]]);
              if (p) x.palette = { name: p.name, ...Object.fromEntries(roles) } as Palette;
              else delete x.palette;
            });
          }}>
          <option value="">Default (chapel)</option>
          {palettes.map((p) => <option value={p.name} title={p.theme}>{humanize(p.name)}</option>)}</select>}</Field>
        {house && <span class="field-hint">{house.theme}</span>}
        {PALETTE_ROLES.map((r: string) => <Field label={humanize(r)}>{(pal?.[r as 'low'] || []).map((c, i) =>
          <span class="swatch" title={`${r}${i + 1} · ${c}`} style={{ backgroundColor: c }} />)}</Field>)}
      </section>
      {mods.length > 0 && <section class="globals-mods" aria-label="Modulators">
        <div class="globals-h-row"><h3 class="globals-h">Modulators</h3>
          <span class="mod-note">macros that move by themselves; params follow them in step</span></div>
        <ModulatorCards st={st} mods={mods} uses={uses} /></section>}
      <section class="globals-macros" aria-label="Faders">
        <div class="globals-h-row"><h3 class="globals-h">{mods.length ? 'Faders' : 'Macros'}</h3>
          <button type="button" class="btn small wide-only" onClick={addMacro}>+ Macro</button></div>
        <ul class="macro-list">{all.filter(([, m]) => !m.mod).map(([name, m]) => <MacroRow key={name} name={name}
          m={m} automated={!!lanes[name]} uses={uses.get(name) ?? []} st={st}
          rename={(to) => st.edit((look) => renameMacro(look, name, to))}
          set={(value) => set((x) => { x.macros = { ...x.macros, [name]: { ...m, value } }; })}
          taken={(to) => !macroNameOk(to) || !!g.macros?.[to]} />)}</ul>
      </section>
    </div>);
}

function Row({ name, d, value, automated, set }: { name: string; d: Macro; value: number; automated: boolean;
  set: (v: number) => void }) {
  return (
    <Field label={humanize(name)} class="end" title={HELP[name]}>{(id) => <>
      <span class="globals-auto" hidden={!automated}>automated</span>
      <Scrub id={id} min={d.min} max={d.max} step={name === 'speed' ? 0.05 : 0.01} value={value} set={set}
        disabled={automated} />
      <button type="button" class={cx('param-reset', value === d.value && 'unused')} title="Reset to default"
        aria-label={`Reset ${name} to default`} onClick={() => set(d.value)}>↺</button></>}</Field>);
}

function MacroRow({ name, m, automated, rename, set, taken, uses, st }: { name: string; m: Macro; automated: boolean;
  rename: (to: string | null) => void; set: (v: number) => void; taken: (to: string) => boolean; uses: Use[];
  st: Studio }) {
  const id = useId();
  return (   // a field whose label is its name, to edit
    <li class="field macro">
      <input type="text" class="macro-name" value={name} maxlength={32} spellcheck={false}
        aria-label={`Name of macro ${name}`} onChange={(e) => {
          const to = e.currentTarget.value.trim();
          if (to === name) return;
          if (taken(to)) e.currentTarget.value = name; else rename(to);
        }} />
      <div class="field-control"><label for={id} class="sr-only">{name} value</label>
        {automated && <span class="globals-auto">automated</span>}
        <Scrub id={id} min={m.min} max={m.max} step={(m.max - m.min) / 100} value={m.value} set={set}
          disabled={automated} />
        <button type="button" class="icon-btn wide-only" aria-label={`Delete ${name}`} onClick={() => rename(null)}>
          ×</button></div>
      <Drives st={st} uses={uses} />
    </li>);
}
