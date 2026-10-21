// "To the lights" in the editor's transport (SPEC-live "From Studio's editor"): it opens the relay's switch, buffer
// and how it goes; on, the lights play the look being edited. Curators on the Pi, admins on a hosted Studio.
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useState } from 'preact/hooks';

import { cx, placePopover } from './kit.tsx';
import type { Preview } from './preview.ts';
import { RelayPanel, savedBuffer } from './relay-panel.tsx';
import { createStudioRelay } from './relay-studio.ts';
import type { Studio } from './studio-store.ts';

/** The button (its label, `children`) and its popover, open at once when `open` (the click that loaded it). */
export function ToLights({ st, pv, open, children }: { st: Studio, pv: Preview, open: boolean,
  children: ComponentChildren }) {
  const pop = useId();
  const [relay] = useState(() => {
    const r = createStudioRelay(st, pv);
    r.buffer.value = savedBuffer();
    return r;
  });
  useEffect(() => {
    if (open) document.getElementById(pop)?.showPopover();
    return () => relay.stop();
  }, []);
  const on = relay.on.value, holding = relay.holding.value;
  return <>
    <button type="button" class={cx('btn small tp-lights', on && 'on', holding && 'live')} popovertarget={pop}
      title={on ? 'Relaying to the lights: the buffer, how it goes, or off'
        : 'Play the look as you edit it on the lights'} aria-label="To the lights">{children}</button>
    <div id={pop} popover="auto" class={cx('tp-lights-pop', st.narrow.value && 'sheet')}
      onBeforeToggle={(e) => placePopover(e, pop, 320, st.narrow.peek())}>
      <RelayPanel relay={relay} label="To the lights"
        title="The lights play the look as it stands here, saved or not, over whatever they play" /></div></>;
}
