// Check & bake (SPEC "Baked frames"), a dialog from the Export menu: render the saved look in the server's render box,
// show what the checks found, play the baked frames (no pattern code runs), and let a curator mark a passing look
// reviewed, or one that fails only the flash check, with their reason.
import { useEffect, useState } from 'preact/hooks';

import { api, type ApiError } from '../api.ts';
import { autoFetchAllowed, fetchManifest } from '../frames-stream.ts';
import { can } from '../../../shared/policy.ts';
import type { Bake, BakingState } from '../../../shared/schemas/api.ts';
import { user } from './session.ts';
import { askWhy } from './ask-why.tsx';
import { cx, openDialog, Switch, toast } from './kit.tsx';
import type { Preview } from './preview.ts';
import { FixButton } from './refine.tsx';
import { mb } from './preview-view.tsx';
import type { Studio } from './studio-store.ts';

const POLL_MS = 1500;
const ACTIVE = new Set(['queued', 'running']);
const pct = (v: number) => `${Math.round(v * 100)} %`;

/** A look's bake as one state: { kind, label } (kind: none|queued|running|ok|warned|flagged|failed). */
function bakeState(bake?: Bake | null) {
  if (!bake) return { kind: 'none', label: 'Not baked' };
  if (bake.status === 'queued') return { kind: 'queued', label: 'Queued' };
  if (bake.status === 'running') return { kind: 'running', label: 'Baking…' };
  if (bake.status === 'done' && bake.ok) {
    return bake.warning ? { kind: 'warned', label: 'Passed · warning' } : { kind: 'ok', label: 'Passed' };
  }
  if (bake.analysis?.flicker?.ok === false) return { kind: 'flagged', label: 'Flashing' };
  return { kind: 'failed', label: 'Failed' };
}

/** The first layer the box says threw while baking, and its error (what the box reports is untrusted: read with
 * care, cut short). */
function thrown(bake: Bake | null) {
  const layers = (bake?.boxStats?.reported as { layers?: unknown } | undefined)?.layers;
  const hit = Array.isArray(layers)
    ? layers.find((l) => Number(l?.errorFrames) > 0 && typeof l?.firstError === 'string') : null;
  return hit ? { id: String(hit.id ?? '').slice(0, 80), error: String(hit.firstError).slice(0, 400) } : null;
}

/** Whether Bake saves first: a new look, or edits to one's own. Someone else's gallery look bakes as shared, never a
 * copy, so a curator's review lands on it. */
export const savesFirst = (st: Studio) => !st.lookId.peek() || (st.dirty.peek() && !st.copyOnSave.peek());

/** Open Check & bake over the Studio; the preview's baked badge stays to go back to live once it closes. */
export function openBake(st: Studio, pv: Preview) {
  return openDialog({ title: 'Check & bake', className: 'bake-dialog', body: () => <BakePanel st={st} pv={pv} /> });
}

function BakePanel({ st, pv }: { st: Studio; pv: Preview }) {
  const me = user.value, id = st.lookId.value, server = st.server.value;
  const look = id && server ? { ...server, id } : null, bake = look?.bake || null, s = bakeState(bake);
  // Someone else's gallery look: the bake and review are of it as shared, never of a copy with this page's edits.
  const theirs = st.copyOnSave.value, edited = st.dirty.value, dirty = edited && !theirs, playing = st.baked.value;
  const canBake = can(me, 'bake', look ?? undefined), canReview = can(me, 'review', look ?? undefined);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [tick, setTick] = useState(0);
  const [sized, setSized] = useState<{ sha?: string; bytes: number } | null>(null);
  const [loading, setLoading] = useState(false);
  // The admin's bake setting and what the render box can do here (SPEC "Baked frames"), said before a click.
  const [baking, setBaking] = useState<BakingState | null>(null);
  useEffect(() => { api.baking().then(setBaking, () => {}); }, []);
  const off = baking?.mode === 'off';

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
    } catch { /* the next poll tries again */ }
    setTick((n) => n + 1);
  }
  const active = !!look && ACTIVE.has(bake?.status || '');
  useEffect(() => {          // while queued or running, ask again
    if (!active) return undefined;
    const timer = setTimeout(poll, POLL_MS);
    return () => clearTimeout(timer);
  }, [active, server, tick]);

  /** Run fn with the card busy; a refusal is kept to show, then failed(err). */
  async function busyWith(fn: () => Promise<void>, failed: (err: ApiError) => void) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
      failed(err as ApiError);
    } finally {
      setBusy(false);
    }
  }
  const bakeNow = () => busyWith(async () => {
    if (savesFirst(st)) {
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
  const approved = look?.reviewed && look.flashOverride, hit = done || bake?.status === 'failed' ? thrown(bake) : null;
  const threw = hit && { ...hit, title: st.layerById(hit.id)?.title || hit.id };
  const note = !look ? 'Save the look, then bake it: the render box plays it for real and checks it for flashing and '
    + 'power.'
    : theirs && edited ? 'This bakes and reviews the look as shared: its saved code, not your edits.'
    : s.kind === 'none' ? 'Bake it in the render box to check it for flashing and power, and to get the frames that '
      + 'will actually play.'
    : s.kind === 'queued' ? 'Waiting for the render box…'
    : s.kind === 'running' ? `Rendering ${bake?.seconds ? `${bake.seconds} s` : 'the look'} in the render box…`
    : dirty ? 'You have edits since this bake. Saving them clears it; bake again after.'
    : 'Editing the layers clears the bake.';
  return (
    <section class={cx('bake', !hasFrames && 'no-play')} data-state={s.kind} aria-label="Bake">
      <div class="bake-head"><span class="bake-pill" data-kind={s.kind}>{s.label}</span></div>
      <p class={cx('bake-note', look && bake && dirty && !active && 'warn')}>{note}</p>
      {canBake && (off || baking?.box.libraryOnly) && <p class="bake-note warn" role="note">{off
        ? 'An admin turned baking off, so looks cannot be baked here for now.' : baking?.box.reason}</p>}
      <dl class="bake-report" hidden={!a}>{a && <>
        {row('Flash check', check[0], check[1])}
        {row('Peak', `${pct(a.peakBrightness)} white · ≈ ${a.estPeakAmps} A`)}
        {approved && row('Approved', `by ${approved.by}, flashing and all: “${approved.reason}”`, 'warn')}
        {row('Length', `${a.seconds} s${bake?.frames?.bytes ? ` · ${mb(bake.frames.bytes)}` : ''}`)}
        {hasFrames && url && <div class="field"><dt>Download</dt><dd><a href={url} download="">.fseq</a> · <a
          href={`${url}?compress=1`} download="">compressed</a></dd></div>}</>}</dl>
      <p class="bake-reason" role="status" hidden={!reason}>{reason}</p>
      {threw && !dirty && <p class="bake-reason" role="status">{`${threw.title} threw while baking: ${threw.error} `}
        <FixButton st={st} layer={threw.title} error={threw.error} /></p>}
      <p class="bake-warning" role="status" hidden={!warning}>{warning}</p>
      <div class="bake-actions">
        <button type="button" class="btn small wide-only" hidden={!canBake} disabled={busy || active || off}
          title={off ? 'An admin turned baking off.' : undefined} onClick={bakeNow}>
          {!look || dirty ? 'Save & bake' : s.kind === 'none' ? 'Bake' : 'Bake again'}</button>
        <button type="button" class="btn small bake-play" aria-pressed={playing} hidden={!hasFrames} disabled={loading}
          onClick={togglePlay}>{playing ? 'Back to live' : `Play baked frames${sized
            && sized.sha === bake?.frames?.sha256 ? ` · ${mb(sized.bytes)}` : ''}`}</button>
      </div>
      <p class="bake-note narrow-only" hidden={!canBake || !look}>Bake and review from a larger screen.</p>
      {canReview && <Switch label="Reviewed for the playa" class="share-toggle bake-review wide-only"
        checked={!!look?.reviewed} disabled={busy || !look || (!look.reviewed && !passing && !overridable)}
        onChange={review} title={look?.reviewed ? 'Reviewed: approved to play on the Folly' : passing
          ? 'Mark this look approved for the Folly' : overridable ? 'It fails the flash check: approve it with a reason'
          : 'Needs a passing render-box bake of the saved code first'} />}
    </section>);
}
