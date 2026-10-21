// "Relay to the lights" (SPEC-live "Relay to the lights"), on the Live tab and in the editor's transport: on, this
// browser renders and the lights play its frames; the buffer it renders ahead; how it goes: the buffer held, the
// misses, the screen kept awake, or who relays instead.
import '../../css/relay.css';

import { cx, pref, Switch } from './kit.tsx';
import { BUFFERS, type Relay } from './relay-link.ts';

const BUFFER_PREF = 'studio.relayBuffer';

/** The buffer as last chosen on this browser (200 ms unless one of the others). */
export const savedBuffer = () => {
  const ms = Number(pref(BUFFER_PREF));
  return BUFFERS.includes(ms) ? ms : 200;
};

export function RelayPanel({ relay, label = 'Relay to the lights',
  title = 'This browser renders the look; the lights play its frames' }: { relay: Relay, label?: string,
  title?: string }) {
  const on = relay.on.value, holding = relay.holding.value, error = relay.error.value;
  const awake = relay.awake.value === 'yes' ? 'screen kept awake'
    : relay.awake.value === 'unsupported' ? 'keep this screen awake' : 'screen may sleep';
  return (
    <div class={cx('relay-panel', holding && 'on')} role="group" aria-label={label}>
      <Switch label={label} class="relay-switch" checked={on} onChange={() => relay.toggle()}
        title={title} />
      {on && <label class="relay-buffer">Buffer
        <select value={relay.buffer.value} onChange={(e) => {
          relay.buffer.value = Number(e.currentTarget.value);
          pref(BUFFER_PREF, e.currentTarget.value);
        }}>
          {BUFFERS.map((ms) => <option key={ms} value={ms}>{ms} ms</option>)}
        </select></label>}
      {on && (error ? <p class="relay-says error" role="status">{error}</p>
        : holding ? <p class="relay-says" role="status">
          <span class="relay-live">Relaying</span> · {relay.ahead.value} ms ahead · {relay.misses.value} missed
          · {awake}</p>
          : <p class="relay-says" role="status">Reaching the lights…</p>)}
      {!on && relay.by.value && <p class="relay-says">{relay.by.value} is relaying to the lights.</p>}
    </div>);
}
