// Modulator lanes under the timeline's layers (SPEC "Timeline"): a lane per modulator, its value over the show (0..1
// of its range, as it plays), its name and what it drives in the lane's head, which opens it on the Look panel. The
// group folds to its head, kept per browser.
import { useMemo, useState } from 'preact/hooks';

import { prepareLook } from '../core/globals.ts';
import { cx, pref } from './kit.tsx';
import { macroUses, moveText } from './mod-uses.ts';
import type { Studio } from './studio-store.ts';
import type { TimelineState } from './timeline-state.ts';

const H = 30, PAD = 3, MAX_PTS = 3000;   // lane height, the room above and below the line (px), samples a lane

export function ModLanes({ st, tl }: { st: Studio; tl: TimelineState }) {
  const L = st.look.value, [open, setOpen] = useState(pref('studio.modLanes') !== '0');
  const mods = Object.entries(L.globals?.macros ?? {}).filter(([, m]) => m.mod);
  const w = tl.contentW.value || 1, pps = tl.pps.value;
  // The curves, sampled about a pixel apart across what scrolls: again only when the look or the zoom changes.
  const curves = useMemo(() => {
    const P = prepareLook(L), n = Math.min(MAX_PTS, Math.ceil(w)), y = (k: number) => (PAD + (1 - k) * (H - 2 * PAD))
      .toFixed(1);
    return new Map(mods.map(([name]) => [name, Array.from({ length: n + 1 }, (_, i) => {
      const x = (i / n) * w;
      return `${x.toFixed(1)},${y(P.normAt(name, x / pps))}`;
    }).join(' ')]));
  }, [L.globals, L.automation, L.bpm, w, pps]);
  if (!mods.length) return null;
  const uses = macroUses(L), fold = () => { setOpen(!open); pref('studio.modLanes', open ? '0' : '1'); };
  const look = (name: string) => {
    if (st.narrow.peek()) st.setTab('look'); else st.showDock('look');
    let tries = 20;
    const find = () => {
      const card = document.querySelector(`.mod-card[data-name="${name}"]`);
      if (!card) { if (--tries) requestAnimationFrame(find); return; }
      card.scrollIntoView({ block: 'nearest' });
      card.querySelector<HTMLElement>('.macro-name')?.focus({ preventScroll: true });
    };
    requestAnimationFrame(find);
  };
  return (
    <div class={cx('tl-mods', !open && 'folded')}>
      <div class="tl-auto-head"><button type="button" class="tl-corner tl-auto-corner tl-mods-fold" aria-expanded={open}
        onClick={fold}>{open ? '▾' : '▸'} Modulators</button>
        <div class="tl-auto-tools tl-mods-count">{mods.length === 1 ? 'one modulator' : `${mods.length} modulators`}, as
          they play</div></div>
      {open && mods.map(([name, m]) => {
        const drives = (uses.get(name) ?? []).map((u) => u.macro ?? st.look.peek().layers.find((l) => l.id === u.layer)
          ?.title ?? 'Layer'), names = [...new Set(drives)];
        const said = names.length ? `drives ${names.slice(0, 2).join(', ')}${names.length > 2
          ? ` +${names.length - 2}` : ''}` : 'drives nothing';
        return <div class="tl-row tl-auto-row tl-mod-row" data-name={name} key={name}>
          <button type="button" class="tl-name tl-mod-label" title={`${name}: ${moveText(m.mod!)}, ${said}. Open it on`
            + ' the Look panel'} onClick={() => look(name)}><span class="tl-mod-name">{name}</span>
            <span class="tl-mod-said">{said}</span></button>
          <div class="tl-lane tl-mod-lane">
            <svg class="tl-auto-svg" width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img"
              aria-label={`${name} over the show: ${moveText(m.mod!)}`}>
              <polyline class="tl-mod-line" points={curves.get(name) ?? ''} /></svg></div>
        </div>;
      })}
    </div>);
}
