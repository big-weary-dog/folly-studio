// The Studio's light view on a phone (SPEC-studio "Phones"): the tabs under the 3D view, a layer's settings
// opened from its row in the same panel, and More: the 3D view's options.
import '../../../css/phone.css';

import { signal } from '@preact/signals';

import { cx, humanize, Switch } from '../kit.tsx';
import type { Preview } from '../preview.ts';
import type { Studio, Tab } from '../studio-store.ts';

const TABS: Tab[] = ['layers', 'look', 'more'];

/** The layer whose settings Layers shows. */
export function createPhone() {
  return { drill: signal<string | null>(null) };
}
type Phone = ReturnType<typeof createPhone>;

/** The Studio's attributes for the light view: settings show while their layer stays the selected one. */
export const phoneAttrs = (st: Studio, ph: Phone) => ({ 'data-detail': 'light',
  'data-drill': ph.drill.value && ph.drill.value === st.selectedId.value ? '' : undefined });

/** The tabs; the code editor is opened from More, so More stays lit while it shows. */
export function PhoneTabs({ st, ph }: { st: Studio; ph: Phone }) {
  const tab = st.tab.value;
  return (
    <nav class="studio-tabs" aria-label="Studio panels">
      {TABS.map((id) => <button type="button" class="tab" data-tab={id}
        aria-pressed={tab === id || (id === 'more' && tab === 'code')}
        onClick={() => { if (id === 'layers' && tab === 'layers') ph.drill.value = null; st.setTab(id); }}>
        {humanize(id)}</button>)}</nav>);
}

/** Tapping a layer's name (which selects it first) opens its settings. */
export const openOnTap = (st: Studio, ph: Phone) => (e: MouseEvent) => {
  if ((e.target as Element).closest('.layer-name')) ph.drill.value = st.selectedId.peek();
};

/** Over a layer's settings: back, name, mute, and a menu for solo and the selected module's reset. */
export function SettingsHead({ st, ph }: { st: Studio; ph: Phone }) {
  const l = st.selected.value;
  if (!l) return null;
  const toggle = (set: typeof st.muted, word: string) => <button type="button"
    class={cx('ms-btn', word.toLowerCase())} aria-pressed={set.value.has(l.id)} aria-label={`${word} ${l.title}`}
    title={`${word} in the preview and preview FSEQ export`}
    onClick={() => st.toggle(set, l.id)}>{word}</button>;
  return (
    <div class="phone-head">
      <button type="button" class="btn small ghost phone-back" onClick={() => { ph.drill.value = null; }}>
        ‹ Layers</button>
      <h2 class="phone-title">{l.title || 'Layer'}</h2>
      <div class="phone-ms" role="group" aria-label="Layer actions">
        {toggle(st.muted, 'Mute')}
        <details class="phone-layer-menu"><summary aria-label="Layer menu">•••</summary>
          <div class="phone-layer-actions">{toggle(st.solo, 'Solo')}
            <button class="btn small ghost" type="button" disabled={!st.module.value}
              onClick={() => {
                const m = st.module.peek();
                if (m) st.editModule(l.id, m.id, () => ({ params: {} }));
              }}>Reset all to defaults</button>
          </div>
        </details></div>
    </div>);
}

/** More: what the light view keeps out of the way. */
export function MorePane({ pv }: { pv: Preview }) {
  const leds = pv.mode.value === 'points';
  return (
    <section class="pane pane-more" data-pane="more" aria-label="More"><div class="pane-body more-body">
      <h3 class="look-h">3D view</h3>
      <Switch label="Show unlit: unlit LEDs, faintly" class="more-row" checked={pv.ghost.value}
        onChange={(on) => pv.setGhost(on)} />
      <Switch label="LEDs: every LED a dot in its exact colour, the lightest view" class="more-row" checked={leds}
        onChange={(on) => pv.setMode(on ? 'points' : 'playa')} />
      <div class="field more-row" hidden={leds}><span>Quality</span>
        <button type="button" class="btn small" onClick={pv.nextQuality}>{humanize(pv.quality.value)}
          {pv.quality.value === 'auto' && pv.tier.value ? ` (${pv.tier.value})` : ''}</button></div>
    </div></section>);
}
