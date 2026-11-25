// Moderating the gallery (SPEC-access "Moderation"): a curator's Hide or Unhide on a card, and anyone's Report this
// look, a short note sent through the bug reports (SPEC "Bug reports") naming the look.
import { useState } from 'preact/hooks';

import { api } from '../../api.ts';
import type { Listed } from '../../../../shared/schemas/api.ts';
import { canReport, snapshot } from '../bug-report/bug-report.tsx';
import { openDialog, toast } from '../kit.tsx';
import { user } from '../session.ts';

const titleOf = (look: { title: string }) => look.title || 'Untitled look';

/** A curator's Hide (or Unhide) on a card; `changed(hidden)` once the server has it. */
export function Hide({ look, changed }: { look: Listed; changed: (hidden: boolean) => void }) {
  const [busy, setBusy] = useState(false), hide = !look.hidden;
  async function go() {
    setBusy(true);
    try {
      await api.updateLook(look.id, { hidden: hide });
      changed(hide);
      toast(hide ? `Hid “${titleOf(look)}” from the gallery.` : `“${titleOf(look)}” is back in the gallery.`,
        { kind: 'ok' });
    } catch (err) {
      toast(`Not ${hide ? 'hidden' : 'unhidden'}: ${(err as Error).message}`, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }
  return <button class="btn small ghost" type="button" disabled={busy} onClick={go}
    aria-label={`${hide ? 'Hide' : 'Unhide'} ${look.title}`}
    title={hide ? 'Take it out of the gallery for everyone but its owner and curators' : 'Let it back in the gallery'}>
    {hide ? 'Hide' : 'Unhide'}</button>;
}

function ReportForm({ look, close }: { look: Listed; close: () => void }) {
  const [note, setNote] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  async function send() {
    if (busy || !note.trim()) return;
    setBusy(true);
    setStatus('Sending…');
    try {
      const { sources, ...moment } = snapshot();
      await api.report({ ...moment, note: note.trim(), screenshot: null, sources: { ...sources,
        look: { id: look.id, title: look.title, owner: look.owner, ownerName: look.ownerName } } });
      setStatus('Sent. Thanks: an admin will look at it.');
      setTimeout(close, 1400);
    } catch (err) {
      setStatus(`Not sent: ${(err as Error).message}`);
      setBusy(false);
    }
  }
  return <form class="report-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
    <label class="report-label" for="look-report-note">What is wrong with this look?</label>
    <textarea id="look-report-note" class="report-note" rows={4} maxlength={4000} autofocus value={note}
      disabled={busy} placeholder="For example: it is offensive, it flashes, it copies someone's work"
      onInput={(e) => setNote(e.currentTarget.value)} />
    <div class="dialog-actions">
      <span class="report-status" role="status">{status}</span>
      <button class="btn ghost" type="button" onClick={close}>Cancel</button>
      <button class="btn primary" type="submit" disabled={busy || !note.trim()}>Send</button>
    </div>
  </form>;
}

/** Report this look: the form, or for guests and visitors, why it needs an account. */
export function ReportLook({ look }: { look: Listed }) {
  function open() {
    if (!canReport(user.peek())) {
      toast('Reporting a look needs an account. Log in or sign up to send a report.');
      return;
    }
    void openDialog({ title: `Report “${titleOf(look)}”`, className: 'report-dialog',
      body: (close) => <ReportForm look={look} close={() => close()} /> });
  }
  return <button class="btn small ghost" type="button" aria-label={`Report ${look.title}`} onClick={open}>
    Report this look</button>;
}
