// The Studio's light view on a phone (SPEC "Timeline" > Phones): the tabs under the 3D view, a layer's settings
// opened from its row in the same panel, and More: the code editor, the 3D view's options and Full detail, which
// shows what the light view hides (css/phone.css keys off the Studio's data-detail and data-drill).
import '../../../css/phone.css';

import { signal } from '@preact/signals';

import { cx, humanize, pref, Switch } from '../kit.tsx';
import type { Preview } from '../preview.ts';
import type { Studio, Tab } from '../studio-store.ts';

const TABS: Tab[] = ['layers', 'time', 'groups', 'look', 'more'];

/** The phone's own state: Full detail (kept per browser) and the layer whose settings Layers shows. */
export function createPhone() {
  return { detail: signal(pref('studio.phoneDetail') === '1'), drill: signal<string | null>(null) };
}
export type Phone = ReturnType<typeof createPhone>;

/** The Studio's attributes for the light view: settings show while their layer stays the selected one. */
export const phoneAttrs = (st: Studio, ph: Phone) => ({ 'data-detail': ph.detail.value ? 'full' : 'light',
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

/** Over a layer's settings: back to the list, its name, and mute and solo a tap away. */
export function SettingsHead({ st, ph }: { st: Studio; ph: Phone }) {
  const l = st.selected.value;
  if (!l) return null;
  const toggle = (set: typeof st.muted, word: string) => <button type="button"
    class={cx('ms-btn', word.toLowerCase())} aria-pressed={set.value.has(l.id)} aria-label={`${word} ${l.title}`}
    onClick={() => st.toggle(set, l.id)}>{word}</button>;
  return (
    <div class="phone-head">
      <button type="button" class="btn small ghost phone-back" onClick={() => { ph.drill.value = null; }}>
        ‹ Layers</button>
      <h2 class="phone-title">{l.title || 'Layer'}</h2>
      <div class="phone-ms" role="group" aria-label="Mute and solo">
        {toggle(st.muted, 'Mute')}{toggle(st.solo, 'Solo')}</div>
    </div>);
}

/** More: what the light view keeps out of the way. */
export function MorePane({ st, pv, ph }: { st: Studio; pv: Preview; ph: Phone }) {
  const leds = pv.mode.value === 'points';
  return (
    <section class="pane pane-more" data-pane="more" aria-label="More"><div class="pane-body more-body">
      <h3 class="look-h">Editing</h3>
      <button type="button" class="btn more-code" onClick={() => st.setTab('code')}>Open the code editor</button>
      <Switch label="Full detail: blend, level, solo, moving, soften, automation" class="more-row"
        checked={ph.detail.value} onChange={(on) => {
          ph.detail.value = on;
          pref('studio.phoneDetail', on ? '1' : '0');
        }} />
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
