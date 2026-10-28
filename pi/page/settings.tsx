// Discrete, creator-offered settings share the bank's locks, paging and release action.
import { useState } from 'preact/hooks';
import type { Control } from '../src/protocol.ts';
import { PALETTE_ROLES } from '../../public/js/core/stdlib.ts';
import { optionText } from '../../public/js/ui/bindings.ts';
import { cx } from '../../public/js/ui/kit.tsx';
import { label, useFits } from './model.ts';
import type { PiSocket } from './socket.ts';

type Setting = Extract<Control, { kind: 'choice' | 'color' }>;
export function SettingStrip({ c, locked, sock }: { c: Setting, locked: boolean, sock: PiSocket }) {
  const [page, setPage] = useState(0), [ref, fits] = useFits(44, 4), per = Math.min(4, fits);
  const options = c.kind === 'choice' ? c.options : [...PALETTE_ROLES];
  const pages = Math.max(1, Math.ceil(options.length / per)), at = page % pages;
  const own = !options.includes(c.value as string);
  return <div class={cx('lp-strip lp-setting', c.held && 'held')}>
    <span class="lp-sl" title={c.label}>{c.setting}<small>{c.label}</small></span>
    <div class="lp-pal" role="group" aria-label={c.label} ref={ref as never}>
      {options.slice(at * per, at * per + per).map((value) => {
        const on = c.value === value;
        return <button key={value} type="button" class="lp-pb" disabled={locked} aria-pressed={on}
          onClick={() => sock.send({ type: 'set', name: c.name, value })}>
          <span>{on && '✓ '}{c.kind === 'choice' ? optionText(value, c.options) : label(value)}</span>
          {c.kind === 'color' && <span class="lp-swatches" aria-hidden="true">
            {(c.palette[value as typeof PALETTE_ROLES[number]] ?? []).map((hex) => <i style={{ background: hex }} />)}
          </span>}
        </button>;
      })}
    </div>
    {own && <span class="lp-own">The look's own</span>}
    <div class="lp-pal-foot">
      <button type="button" class="lp-rel" disabled={locked || !c.held}
        aria-label={`Let ${c.label} go back to the look's own`}
        onClick={() => sock.send({ type: 'release', name: c.name })}>↺</button>
      {pages > 1 && <button type="button" class="lp-pad lp-more" aria-label={`More ${c.label}`}
        onClick={() => setPage((at + 1) % pages)}>More ›</button>}
    </div>
  </div>;
}
