// Bake (SPEC "Baked frames"): render the saved look in the server's render box, show what the checks found, play the
// baked frames (no pattern code runs), and let a curator mark a passing look reviewed, or one that fails only the
// flash check, with their reason.
import { useEffect, useState } from 'preact/hooks';

import { api, type ApiError, statusOf } from '../api.ts';
import { autoFetchAllowed, fetchManifest } from '../frames-stream.ts';
import type { Bake } from '../../../shared/schemas/api.ts';
import { signedOut, user } from './session.ts';
import { cx, Field, openDialog, Switch, toast } from './kit.tsx';
import type { Preview } from './preview.ts';
import { mb } from './preview-view.tsx';
import type { Studio } from './studio-store.ts';

const POLL_MS = 1500;
const ACTIVE = new Set(['queued', 'running']);
const pct = (v: number) => `${Math.round(v * 100)} %`;

/** A look's bake as one state: { kind, label } (kind: none|queued|running|ok|warned|flagged|failed). */
export function bakeState(bake?: Bake | null) {
  if (!bake) return { kind: 'none', label: 'Not baked' };
  if (bake.status === 'queued') return { kind: 'queued', label: 'Queued' };
  if (bake.status === 'running') return { kind: 'running', label: 'Baking…' };
  if (bake.status === 'done' && bake.ok) {
    return bake.warning ? { kind: 'warned', label: 'Passed · warning' } : { kind: 'ok', label: 'Passed' };
  }
  if (bake.analysis?.flicker?.ok === false) return { kind: 'flagged', label: 'Flashing' };
  return { kind: 'failed', label: 'Failed' };
}

export function BakePanel({ st, pv }: { st: Studio; pv: Preview }) {
  const me = user.value, curator = !!me && me.role !== 'member', id = st.lookId.value, server = st.server.value;
  const look = id && server ? { ...server, id } : null, bake = look?.bake || null, s = bakeState(bake);
  const dirty = st.dirty.value, playing = st.baked.value;
  const canBake = !look || look.owner === me?.id || (curator && look.shared);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [tick, setTick] = useState(0);
  const [sized, setSized] = useState<{ sha?: string; bytes: number } | null>(null);
  const [loading, setLoading] = useState(false);

  async function poll() {
    const at = st.look.peek().id;
    if (!at) return;
    try {
      const { look: fresh } = await api.look(at);
      if (st.look.peek().id !== at) return;
      const before = bakeState(st.server.peek()?.bake).kind, after = bakeState(fresh.bake).kind;
      st.adopt(fresh);
      if (before !== after && (after === 'ok' || after === 'flagged' || after === 'failed')) {
        toast(after === 'ok' ? 'Baked: the flash check passed.' : `Bake ${after}: ${fresh.bake?.reason || ''}`,
          { kind: after === 'ok' ? 'ok' : 'error', timeout: 7000 });
      }
    } catch (err) {
      if (statusOf(err) === 401) return signedOut();
    }
    setTick((n) => n + 1);
  }
  const active = !!look && ACTIVE.has(bake?.status || '');
  useEffect(() => {          // while queued or running, ask again
    if (!active) return undefined;
    const timer = setTimeout(poll, POLL_MS);
    return () => clearTimeout(timer);
  }, [active, server, tick]);

  /** Run fn with the card busy; a 401 signs out, and any other refusal is kept to show, then failed(err). */
  async function busyWith(fn: () => Promise<void>, failed: (err: ApiError) => void) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      if (statusOf(err) === 401) return signedOut();
      setError((err as Error).message);
      failed(err as ApiError);
    } finally {
      setBusy(false);
    }
  }
  const bakeNow = () => busyWith(async () => {
    if (!look || st.dirty.peek()) {
      await st.save();
      if (!st.look.peek().id || st.dirty.peek()) return;
    }
    const now = { ...st.server.peek(), id: st.look.peek().id } as NonNullable<typeof look>;
    const { bake: started } = await api.bake(now.id);
    st.adopt({ ...now, bake: started });
    toast('Baking in the render box…', { timeout: 2500 });
  }, (err) => toast(err.message, { kind: err.status === 503 ? 'warn' : 'error', timeout: 8000 })); // 503: no box
  const review = async (on: boolean) => {
    if (!look) return;
    // Frames that fail the flash check are approved only with the curator's reason, kept on the look.
    const flashOverride = on && !passing ? await askWhy(bake?.reason || '') : undefined;
    if (on && !passing && !flashOverride) return;
    await busyWith(async () => {
      st.adopt((await api.updateLook(look.id, { reviewed: on, ...(flashOverride ? { flashOverride } : {}) })).look);
      toast(on ? 'Marked reviewed.' : 'No longer marked reviewed.', { kind: 'ok' });
    }, failedReview);
  };
  const failedReview = (err: ApiError) => {                               // the server's 409 says why
    toast(err.message, { kind: 'error', timeout: 9000 });
    if (err.status === 409) setTimeout(poll, 0);   // our copy is stale: catch up
  };
  async function togglePlay() {
    const sha = bake?.frames?.sha256;
    setLoading(true);
    try {
      // On a phone or a slow or metered link, the first press only says how much would download.
      if (!playing && look && !autoFetchAllowed() && sized?.sha !== sha) {
        setSized({ sha, bytes: (await fetchManifest(look.id)).bytes });
        return;
      }
      await pv.playBaked(!playing);
    } catch (err) {
      if (statusOf(err) === 401) return signedOut();
      toast((err as Error).message, { kind: 'error', timeout: 7000 });
    } finally {
      setLoading(false);
    }
  }

  const a = bake?.analysis, f = a?.flicker, small = f?.small?.regions?.length ? f.small : null;
  const when = (x: { flaggedSeconds: number[] }) => `${x.flaggedSeconds.slice(0, 5).map((t) => `${t} s`).join(', ')}`
    + `${x.flaggedSeconds.length > 5 ? '…' : ''}`;
  const check = !f?.ok ? [`Flagged at ${f ? when(f) : ''}`, 'bad']
    : small ? [`Pass · ${small.regions.join(', ')} flash at ${when(small)}`, 'warn'] : ['Pass', 'ok'];
  const row = (k: string, v: string, cls?: string) => <div class={cx('field', cls)}><dt>{k}</dt><dd>{v}</dd></div>;
  const url = look && `/api/looks/${encodeURIComponent(look.id)}/frames`, done = bake?.status === 'done';
  const reason = error || (s.kind === 'failed' || s.kind === 'flagged' ? bake?.reason || '' : '');
  const warning = done && !error ? bake?.warning || '' : '', hasFrames = !!(bake?.frames && done);
  const passing = bake?.source === 'render-box' && done && bake.ok && !dirty;
  const overridable = bake?.source === 'render-box' && hasFrames && f?.ok === false && !bake.ok && !dirty;
  const approved = look?.reviewed && look.flashOverride;
  const note = !look ? 'Save the look, then bake it: the render box plays it for real and checks it for flashing and '
    + 'power.'
    : s.kind === 'none' ? 'Bake it in the render box to check it for flashing and power, and to get the frames that '
      + 'will actually play.'
    : s.kind === 'queued' ? 'Waiting for the render box…'
    : s.kind === 'running' ? `Rendering ${bake?.seconds ? `${bake.seconds} s` : 'the look'} in the render box…`
    : dirty ? 'You have edits since this bake. Saving them clears it; bake again after.'
    : 'Editing the layers clears the bake.';
  return (
    <section class={cx('bake', !hasFrames && 'no-play')} data-state={s.kind} aria-label="Bake">
      <div class="bake-head"><h2 class="pane-title">Bake</h2>
        <span class="bake-pill" data-kind={s.kind}>{s.label}</span></div>
      <p class={cx('bake-note', look && bake && dirty && !active && 'warn')}>{note}</p>
      <dl class="bake-report" hidden={!a}>{a && <>
        {row('Flash check', check[0], check[1])}
        {row('Peak', `${pct(a.peakBrightness)} white · ≈ ${a.estPeakAmps} A`)}
        {approved && row('Approved', `by ${approved.by}, flashing and all: “${approved.reason}”`, 'warn')}
        {row('Length', `${a.seconds} s${bake?.frames?.bytes ? ` · ${mb(bake.frames.bytes)}` : ''}`)}
        {hasFrames && url && <div class="field"><dt>Download</dt><dd><a href={url} download="">.fseq</a> · <a
          href={`${url}?compress=1`} download="">compressed</a></dd></div>}</>}</dl>
      <p class="bake-reason" role="status" hidden={!reason}>{reason}</p>
      <p class="bake-warning" role="status" hidden={!warning}>{warning}</p>
      <div class="bake-actions">
        <button type="button" class="btn small wide-only" hidden={!canBake} disabled={busy || active} onClick={bakeNow}>
          {!look || dirty ? 'Save & bake' : s.kind === 'none' ? 'Bake' : 'Bake again'}</button>
        <button type="button" class="btn small bake-play" aria-pressed={playing} hidden={!hasFrames} disabled={loading}
          onClick={togglePlay}>{playing ? 'Back to live' : `Play baked frames${sized
            && sized.sha === bake?.frames?.sha256 ? ` · ${mb(sized.bytes)}` : ''}`}</button>
      </div>
      <p class="bake-note narrow-only" hidden={!canBake || !look}>Bake and review from a larger screen.</p>
      {curator && <Switch label="Reviewed for the playa" class="share-toggle bake-review wide-only"
        checked={!!look?.reviewed} disabled={busy || !look || (!look.reviewed && !passing && !overridable)}
        onChange={review} title={look?.reviewed ? 'Reviewed: approved to play on the Folly' : passing
          ? 'Mark this look approved for the Folly' : overridable ? 'It fails the flash check: approve it with a reason'
          : 'Needs a passing render-box bake of the saved code first'} />}
    </section>);
}

/** A curator's reason for approving frames that fail the flash check (3–500 characters), or undefined. */
function askWhy(found: string) {
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
