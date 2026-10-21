// Play on the lights (SPEC-offline "Playing on the lights"): a saved look to the engine's queue, now, next or at its
// end; live when it is library-only, else as its bake; off, saying why, when it cannot play. Play now only in Live
// Play (SPEC-liveplay "Modes"), for those who drive.
import { useEffect, useState } from 'preact/hooks';

import { api, type At, type Lights } from '../api.ts';
import { openDialog, toast } from './kit.tsx';

const DONE: Record<At, string> = { now: 'is playing on the lights', next: 'plays next', end: 'is in the queue' };

/** `dirty`: the editor has unsaved changes, so what would play is not what is shown. */
export function openPlayLights(look: { id: string, title: string }, dirty = false) {
  return openDialog({ title: 'Play on the lights', className: 'lights-dialog',
    body: (close) => <PlayLights look={look} dirty={dirty} done={() => close()} /> });
}

function PlayLights({ look, dirty, done }: { look: { id: string, title: string }, dirty: boolean,
  done: () => void }) {
  const [lights, setLights] = useState<Lights | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.lights(look.id).then(setLights, (e) => setError(e.message)); }, [look.id]);
  const play = lights?.play;
  const why = dirty ? 'Save first: the lights play the saved look.'
    : lights && !lights.engine ? 'The lights\' engine is not running.' : play?.error ?? '';
  const send = (at: At) => {
    setBusy(true);
    api.playOnLights(look.id, at).then(() => { toast(`${look.title} ${DONE[at]}.`); done(); },
      (e) => { setError(e.message); setBusy(false); });
  };
  const off = !lights || !!why || busy;
  return <>
    <p class="dialog-text"><strong>{look.title}</strong>{' '}
      {play?.kind === 'live' && 'plays live: its controls work on the lights\' page.'}
      {play?.kind === 'baked' && 'plays its bake, without live controls.'}
      {!lights && !error && 'Checking…'}</p>
    {(why || error) && <p class="dialog-text error" role="alert">{error || why}</p>}
    <p class="dialog-text">The queue is on <a href="/pi/">the lights' page</a>.</p>
    <div class="dialog-actions lights-actions">
      <button class="btn" type="button" disabled={off} onClick={() => send('end')}>Add to queue</button>
      <button class="btn" type="button" disabled={off} onClick={() => send('next')}>Play next</button>
      {lights?.mode === 'live' && lights.canDrive && <button class="btn primary" type="button" disabled={off}
        onClick={() => send('now')}>Play now</button>}
    </div>
  </>;
}
