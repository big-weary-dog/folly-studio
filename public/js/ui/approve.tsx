// Approve on a gallery card (SPEC "Baked frames"): a curator's one click marks a look reviewed, baking it first when
// its frames are not baked and passing; frames that fail only the flash check need the curator's reason, as in Check &
// bake.
import { useState } from 'preact/hooks';

import { api, type ApiError } from '../api.ts';
import type { Bake } from '../../../shared/schemas/api.ts';
import { Field, openDialog, toast } from './kit.tsx';
import { navigate } from './session.ts';

const POLL_MS = 1500, WAIT_MS = 10 * 60_000;
const pause = (ms: number) => new Promise((done) => { setTimeout(done, ms); });

/** What Approve does next for a look with `bake`: bake it, wait for the box, mark it, ask why it may flash, or stop. */
export function nextStep(bake?: Bake | null): 'bake' | 'wait' | 'approve' | 'reason' | 'failed' {
  if (!bake || bake.source !== 'render-box') return 'bake';
  if (bake.status === 'queued' || bake.status === 'running') return 'wait';
  if (bake.status === 'done' && bake.ok) return 'approve';
  return bake.analysis?.flicker?.ok === false ? 'reason' : 'failed';
}

/** Bakes the look as needed, then marks it reviewed; whether it was. `baking()` is called while the box works. */
export async function approve(id: string, baking: () => void): Promise<boolean> {
  const refused = (why: string) => toast(`${why} Open it for Export → Check & bake….`, { kind: 'error', timeout: 12_000,
    action: { label: 'Open', onClick: () => navigate(`/studio/${encodeURIComponent(id)}`) } });
  let baked = false;
  const bake = async () => {
    if (baked) throw new Error('The bake did not finish.');
    baked = true;
    baking();
    await api.bake(id);
  };
  try {
    for (const until = Date.now() + WAIT_MS; Date.now() < until;) {
      const { look } = await api.look(id), step = nextStep(look.bake), why = look.bake?.reason || '';
      if (step === 'wait') { baking(); await pause(POLL_MS); continue; }
      if (step === 'bake') { await bake(); continue; }
      if (step === 'failed') {
        refused(`The bake failed: ${why.replace(/\.$/, '') || 'no reason given'}.`);
        return false;
      }
      const flashOverride = step === 'reason' ? await askWhy(why) : undefined;
      if (step === 'reason' && !flashOverride) return false;
      try {
        await api.updateLook(id, { reviewed: true, ...(flashOverride ? { flashOverride } : {}) });
      } catch (err) {
        if ((err as ApiError).status !== 409 || baked) throw err;
        await bake();                // its bake is of older code: bake what it is now
        continue;
      }
      toast(`Approved “${look.title || 'Untitled look'}”.`, { kind: 'ok' });
      return true;
    }
    toast('Still baking: Approve again once it is done.', { kind: 'warn', timeout: 8000 });
  } catch (err) {
    refused((err as Error).message);
  }
  return false;
}

/** The card's Approve: Baking… while the box works; `approved()` once the look is reviewed. */
export function Approve({ look, approved }: { look: { id: string; title: string }; approved: () => void }) {
  const [busy, setBusy] = useState(''), go = async () => {
    setBusy('Approving…');
    const ok = await approve(look.id, () => setBusy('Baking…'));
    setBusy('');
    if (ok) approved();
  };
  return <button class="btn small primary" type="button" disabled={!!busy} aria-label={`Approve ${look.title}`}
    title="Mark it reviewed to play on the Folly, baking it first if it needs it" onClick={go}>
    {busy || 'Approve'}</button>;
}

/** A curator's reason for approving frames that fail the flash check (3–500 characters), or undefined. */
export function askWhy(found: string) {
  return openDialog<string>({ title: 'Approve despite flashing?', body: (close) => {
    const [text, setText] = useState('');
    return <form class="details-form" onSubmit={(e) => { e.preventDefault(); close(text.trim()); }}>
      <p class="dialog-text">{found} Approving it lets it play on the Folly. Your reason stays on the look, with your
        name.</p>
      <Field label="Why is this flashing acceptable?" stack>{(id) => <textarea id={id} rows={3} required
        minlength={3} maxlength={500} value={text} onInput={(e) => setText(e.currentTarget.value)} />}</Field>
      <div class="dialog-actions">
        <button class="btn ghost" type="button" onClick={() => close()}>Cancel</button>
        <button class="btn primary" type="submit">Approve</button>
      </div>
    </form>;
  } });
}
