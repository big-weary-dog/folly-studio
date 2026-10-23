// F8 bug reports (SPEC "Bug reports"): F8 on any page, or "Report a problem" in the user menu, reads the moment
// first (the page, the last toasts and errors, what each view registered with reportPage), keeps the 3D view's
// picture, then freezes every registered view while the form asks what went wrong; closing it thaws them as they
// were. A report too big for the server goes again without its screenshot.
import '../../css/reports.css';

import { effect } from '@preact/signals';
import { useState } from 'preact/hooks';

import { piece, scrub } from '../scrub.ts';
import { api, statusOf } from '../api.ts';
import type { User } from '../../../shared/schemas/api.ts';
import { openDialog, toast, toastHistory } from './kit.tsx';
import { user } from './session.ts';

/** What a view gives a report: its state, its pause, and its 3D view's picture (a JPEG data URL). */
export type ReportPage = { read?: () => unknown; freeze?: (on: boolean) => void; shot?: () => string | null };
type Report = Parameters<typeof api.report>[0];

const REPORT_KEY = 'F8', ERRORS = 100;
const pages = new Map<string, ReportPage>();
const errors: Record<string, unknown>[] = [];
let open = false, installed = false;
export const canReport = (me: User | null) => !!me && !me.guest;
let unavailableNotice: (() => void) | undefined;
effect(() => {
  if (canReport(user.value)) { unavailableNotice?.(); unavailableNotice = undefined; }
});

/** Registers a view's part in reports, as `name`; returns its removal. */
export function reportPage(name: string, page: ReportPage) {
  pages.set(name, page);
  return () => { if (pages.get(name) === page) pages.delete(name); };
}

/** A reader's answer, or what it threw: a broken reader leaves a gap, never stops the report. */
function read<T>(fn?: () => T): T | { unreadable: string } | undefined {
  try { return fn?.(); } catch (e) { return { unreadable: String(e) }; }
}

function noteError(kind: string, value: unknown) {
  errors.push({ at: new Date().toISOString(), kind, error: scrub(value) });
  if (errors.length > ERRORS) errors.shift();
}

let gl: unknown;
/** The GPU, as WebGL names it (once). */
function glInfo() {
  if (gl !== undefined) return gl;
  const c = document.createElement('canvas').getContext('webgl2');
  const ext = c?.getExtension('WEBGL_debug_renderer_info');
  gl = c ? { renderer: c.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : c.RENDERER),
    vendor: c.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : c.VENDOR) } : null;
  c?.getExtension('WEBGL_lose_context')?.loseContext();
  return gl;
}

/** Open dialogs, popovers and drawers: their headings, else their class. */
function dialogsOpen() {
  const els = [...document.querySelectorAll('dialog[open], :popover-open, .drawer')];
  return els.map((el) => ({ tag: el.tagName.toLowerCase(), id: el.id || undefined,
    title: el.querySelector('h2, h3')?.textContent?.slice(0, 80) || el.className.slice(0, 80) }));
}

/** The moment as a report, without the note or the screenshot. */
export function snapshot(): Report {
  return {
    format: 1, at: new Date().toISOString(), note: '', build: __BUILD__,
    page: { path: location.pathname, title: document.title, userAgent: navigator.userAgent,
      viewport: [innerWidth, innerHeight, devicePixelRatio], gl: read(glInfo) },
    toasts: piece(toastHistory), errors: piece(errors), dialogs: piece(read(dialogsOpen)),
    sources: Object.fromEntries([...pages].filter(([, p]) => p.read).map(([n, p]) => [n, piece(read(p.read))])),
  };
}

/** Sends `report`, and again without its screenshot when the server finds it too big; whether the shot went. */
async function sendReport(report: Report) {
  try {
    return { ...await api.report(report), shot: !!report.screenshot };
  } catch (err) {
    if (statusOf(err) !== 413 || !report.screenshot) throw err;
    return { ...await api.report({ ...report, screenshot: null }), shot: false };
  }
}

function ReportForm({ report, shot, close }: { report: Report; shot: string | null; close: () => void }) {
  const [note, setNote] = useState(''), [withShot, setWithShot] = useState(!!shot);
  const [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  async function send() {
    if (busy) return;
    setBusy(true);
    setStatus('Sending…');
    try {
      const sent = await sendReport({ ...report, note: note.trim(), screenshot: withShot ? shot : null });
      setStatus(withShot && !sent.shot ? 'Sent, without the screenshot (it was too big). Thanks!' : 'Sent. Thanks!');
      setTimeout(close, 1400);
    } catch (err) {
      setStatus(`Not sent: ${(err as Error).message}`);
      setBusy(false);
    }
  }
  return <form class="report-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
    <label class="report-label" for="report-note">What went wrong?</label>
    <textarea id="report-note" class="report-note" rows={4} maxlength={4000} autofocus value={note} disabled={busy}
      placeholder="What you did, what you expected, what happened instead"
      onInput={(e) => setNote(e.currentTarget.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
    <label class="report-shot">
      <input type="checkbox" checked={withShot} disabled={!shot || busy}
        onChange={(e) => setWithShot(e.currentTarget.checked)} />
      {shot ? 'Include screenshot' : 'No screenshot (no 3D view on this page)'}
      {shot && withShot && <img src={shot} alt="" class="report-thumb" />}
    </label>
    <p class="dialog-text report-about">The page's state, recent errors and messages go with it. The view stays
      paused until this closes.</p>
    <div class="dialog-actions">
      <span class="report-status" role="status">{status}</span>
      <button class="btn ghost" type="button" onClick={close}>Cancel</button>
      <button class="btn primary" type="submit" disabled={busy}>Send</button>
    </div>
  </form>;
}

/** The whole flow: the moment read, the picture kept, every view frozen, the form, then everything thawed. */
export async function fileBugReport() {
  if (!canReport(user.peek())) {
    unavailableNotice?.();
    unavailableNotice = toast('Reporting a problem needs an account. Log in or sign up to send a report.');
    return;
  }
  if (open) return;
  open = true;
  const frozen = [...pages.values()];
  try {
    const report = snapshot();
    let shot: string | null = null;
    for (const p of frozen) if (!shot) shot = (read(p.shot) as string | null | undefined) ?? null;
    if (typeof shot !== 'string') shot = null;
    for (const p of frozen) read(() => p.freeze?.(true));
    await openDialog({ title: 'Report a problem', className: 'report-dialog',
      body: (close) => <ReportForm report={report} shot={shot} close={() => close()} /> });
  } finally {
    for (const p of frozen) read(() => p.freeze?.(false));
    open = false;
  }
}

/** F8 on every page, and the error ring: window errors, unhandled rejections and console.error. Once. */
export function installBugReport() {
  if (installed) return;
  installed = true;
  addEventListener('keydown', (e) => {
    if (e.key !== REPORT_KEY) return;
    e.preventDefault();
    e.stopPropagation();
    void fileBugReport();
  }, true);
  addEventListener('error', (e) => noteError('error', e.error ?? e.message));
  addEventListener('unhandledrejection', (e) => noteError('rejection', e.reason));
  const said = console.error.bind(console);
  console.error = (...a: unknown[]) => { noteError('console', a.length === 1 ? a[0] : a); said(...a); };
}
