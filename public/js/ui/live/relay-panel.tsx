// The Live tab's "Relay to the lights" (SPEC-live "Relay to the lights"): on, this browser renders what the lights
// play and they play its frames; the buffer it renders ahead; how it goes: the buffer held, the misses, the screen
// kept awake, or who relays instead.
import { cx, pref, Switch } from '../kit.tsx';
import { BUFFERS, type Relay } from './relay.ts';

const BUFFER_PREF = 'studio.relayBuffer';

/** The buffer as last chosen on this browser (200 ms unless one of the others). */
export const savedBuffer = () => {
  const ms = Number(pref(BUFFER_PREF));
  return BUFFERS.includes(ms) ? ms : 200;
};

export function RelayPanel({ relay }: { relay: Relay }) {
  const on = relay.on.value, holding = relay.holding.value, error = relay.error.value;
  const awake = relay.awake.value === 'yes' ? 'screen kept awake'
    : relay.awake.value === 'unsupported' ? 'keep this screen awake' : 'screen may sleep';
  return (
    <div class={cx('relay-panel', holding && 'on')} role="group" aria-label="Relay to the lights">
      <Switch label="Relay to the lights" class="relay-switch" checked={on} onChange={() => relay.toggle()}
        title="This browser renders the look; the lights play its frames" />
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
