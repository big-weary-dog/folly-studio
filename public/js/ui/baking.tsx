// The Baking page, for admins (SPEC "Baked frames", "The bake setting"): whether the render box bakes freely,
// throttled or not at all, saved as it is picked, and what the render box can do on this server.
import '../../css/pages.css';

import { useEffect, useState } from 'preact/hooks';

import { api } from '../api.ts';
import type { BakeMode, BakingState } from '../../../shared/schemas/api.ts';
import { toast } from './kit.tsx';
import { setTitle } from './session.ts';

const MODES: [BakeMode, string, string][] = [
  ['on', 'On', 'Bakes and gallery previews run as they are asked for, one at a time.'],
  ['throttled', 'Throttled', 'One at a time at the lowest priority (nice 19), each starting at least 30 s after the '
    + 'last ended, so the server has room between them.'],
  ['off', 'Off', 'Nothing bakes: the bake buttons say an admin turned baking off. Bakes under way finish; queued ones '
    + 'fail. Baked frames and previews made already stay.'],
];

export function BakingPage() {
  const [state, setState] = useState<BakingState | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setTitle('Baking'); api.baking().then(setState, (e) => setError(e.message)); }, []);
  const pick = (mode: BakeMode) => {
    setBusy(true);
    api.saveBaking(mode).then((s) => { setState(s); toast(`Baking is ${MODES.find(([m]) => m === s.mode)![1]
      .toLowerCase()}.`, { kind: 'ok' }); }, (e) => toast(e.message, { kind: 'error' })).finally(() => setBusy(false));
  };
  const box = state?.box;
  return (
    <div class="page baking-page">
      <h1 class="page-title">Baking</h1>
      <p class="lede">How much of the server bakes may use: looks baked to frames in the render box, and the gallery
        previews made from them.</p>
      <p class={error ? 'form-error' : 'pane-hint'} role={error ? 'alert' : undefined} hidden={!!state}>
        {error || 'Loading…'}</p>
      {state && <section class="models-panel" aria-label="The bake setting">
        <div class="seg" role="group" aria-label="Baking">
          {MODES.map(([m, text]) => <button key={m} type="button" class="seg-btn" aria-pressed={state.mode === m}
            disabled={busy} onClick={() => state.mode !== m && pick(m)}>{text}</button>)}</div>
        <p class="field-hint">{MODES.find(([m]) => m === state.mode)![2]}</p>
      </section>}
      {box && <section class="models-panel" aria-label="The render box">
        <p class="field-hint">{!box.ok ? box.reason
          : box.libraryOnly ? `Library only. ${box.reason} Looks with custom or edited code are refused.`
          : 'The render box runs under bubblewrap: any look bakes.'}</p>
      </section>}
    </div>);
}
