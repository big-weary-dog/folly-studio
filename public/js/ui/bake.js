// Bake: render the saved look in the server's render box, show what the checks found, play the
// baked frames (no pattern code runs), and let a curator mark a passing look reviewed.
// SPEC "Baked frames". The frames are the deliverable: what plays here is what will play.
import { api } from '../api.js';
import { autoFetchAllowed, fetchManifest, openFrameStream } from '../frames-stream.js';
import { h, clear, nextId, toast } from './dom.js';

const POLL_MS = 1500;
const ACTIVE = new Set(['queued', 'running']);

/** A look's bake as one state: { kind, label, note } (kind: none|queued|running|ok|flagged|failed). */
export function bakeState(bake) {
  if (!bake) return { kind: 'none', label: 'Not baked' };
  if (bake.status === 'queued') return { kind: 'queued', label: 'Queued' };
  if (bake.status === 'running') return { kind: 'running', label: 'Baking…' };
  if (bake.status === 'done' && bake.ok) return { kind: 'ok', label: 'Passed' };
  if (bake.analysis?.flicker?.ok === false) return { kind: 'flagged', label: 'Flashing' };
  return { kind: 'failed', label: 'Failed' };
}

export const mb = (bytes) => `${(bytes / 1e6).toFixed(bytes < 1e8 ? 1 : 0)} MB`;
const pct = (v) => `${Math.round(v * 100)} %`;

/**
 * The bake card. Everything goes through `host`:
 *   host.look()            → { id, owner, shared, reviewed, bake } | null (unsaved)
 *   host.dirty()           → unsaved edits?
 *   host.save()            → Promise<boolean> (saved?)
 *   host.setLook(look)     the server's copy changed (bake / reviewed)
 *   host.playBaked(on)     → Promise (switch the preview to baked frames and back)
 *   host.signedOut()
 */
export class BakePanel {
  constructor(container, { user, host }) {
    this.user = user;
    this.host = host;
    this.curator = user?.role === 'curator';
    this.timer = 0;
    this.playing = false;
    this.busy = false;
    this.error = '';           // last refusal (503 / 409 / …), shown until the state changes
    const reviewId = nextId('rev');
    this.pill = h('span', { class: 'bake-pill' });
    this.note = h('p', { class: 'bake-note' });
    this.report = h('dl', { class: 'bake-report' });
    this.reason = h('p', { class: 'bake-reason', role: 'status' });
    this.bakeBtn = h('button', { type: 'button', class: 'btn small wide-only', text: 'Bake' });
    this.playBtn = h('button', { type: 'button', class: 'btn small bake-play', 'aria-pressed': 'false' });
    this.reviewBox = h('input', { type: 'checkbox', id: reviewId, class: 'switch' });
    this.review = h('div', { class: 'share-toggle bake-review wide-only', hidden: !this.curator },
      this.reviewBox, h('label', { for: reviewId, text: 'Reviewed for the playa' }));
    this.phoneHint = h('p', { class: 'bake-note narrow-only', text: 'Bake and review from a larger screen.' });
    this.actions = h('div', { class: 'bake-actions' }, this.bakeBtn, this.playBtn);
    this.el = h('section', { class: 'bake', 'aria-label': 'Bake' },
      h('div', { class: 'bake-head' }, h('h2', { class: 'pane-title', text: 'Bake' }), this.pill),
      this.note, this.report, this.reason, this.actions, this.phoneHint,
      this.review);
    container.append(this.el);
    this.bakeBtn.addEventListener('click', () => this.bake());
    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.reviewBox.addEventListener('change', () => this.setReviewed(this.reviewBox.checked));
    this.render();
  }

  /** Redraw from the host's look; starts or stops polling. */
  render() {
    const look = this.host.look();
    const bake = look?.bake || null;
    const st = bakeState(bake);
    const dirty = this.host.dirty();
    const mine = look && this.user && look.owner === this.user.id;
    const canBake = !look || mine || (this.curator && look.shared);
    this.el.dataset.state = st.kind;
    this.pill.textContent = st.label;
    this.pill.dataset.kind = st.kind;

    let note;
    if (!look) note = 'Save the look, then bake it: the render box plays it for real and checks it for flashing and power.';
    else if (st.kind === 'none') note = 'Bake it in the render box to check it for flashing and power, and to get the frames that will actually play.';
    else if (st.kind === 'queued') note = 'Waiting for the render box…';
    else if (st.kind === 'running') note = `Rendering ${bake.seconds ? `${bake.seconds} s` : 'the look'} in the render box…`;
    else note = dirty ? 'You have edits since this bake. Saving them clears it; bake again after.' : 'Editing the layers clears the bake.';
    this.note.textContent = note;
    this.note.classList.toggle('warn', !!(look && bake && dirty && !ACTIVE.has(bake.status)));

    clear(this.report);
    const a = bake?.analysis;
    if (a) {
      const f = a.flicker || {};
      const row = (k, v, cls) => h('div', { class: cls || null }, h('dt', { text: k }), h('dd', { text: v }));
      this.report.append(
        row('Flash check', f.ok ? 'Pass' : `Flagged at ${(f.flaggedSeconds || []).slice(0, 5).map((s) => `${s} s`).join(', ')}${(f.flaggedSeconds || []).length > 5 ? '…' : ''}`, f.ok ? 'ok' : 'bad'),
        row('Peak', `${pct(a.peakBrightness)} white · ≈ ${a.estPeakAmps} A`),
        row('Length', `${a.seconds} s${bake.frames?.bytes ? ` · ${mb(bake.frames.bytes)}` : ''}`));
    }
    this.report.hidden = !a;
    const reason = this.error || (st.kind === 'failed' || st.kind === 'flagged' ? bake.reason || '' : '');
    this.reason.textContent = reason;
    this.reason.hidden = !reason;

    this.bakeBtn.hidden = !canBake;
    this.bakeBtn.disabled = this.busy || ACTIVE.has(bake?.status);
    this.bakeBtn.textContent = !look || dirty ? 'Save & bake' : st.kind === 'none' ? 'Bake' : 'Bake again';
    const hasFrames = !!(bake?.frames && bake.status === 'done');
    this.playBtn.hidden = !hasFrames;
    this.el.classList.toggle('no-play', !hasFrames);
    this.phoneHint.hidden = !canBake || !look;
    this.playBtn.setAttribute('aria-pressed', String(this.playing));
    const size = this.sized && this.sized.sha === bake?.frames?.sha256 ? ` · ${mb(this.sized.bytes)}` : '';
    this.playBtn.textContent = this.playing ? 'Back to live' : `Play baked frames${size}`;

    if (this.curator) {
      const passing = bake?.source === 'render-box' && bake.status === 'done' && bake.ok && !dirty;
      this.reviewBox.checked = !!look?.reviewed;
      this.reviewBox.disabled = this.busy || !look || (!look.reviewed && !passing);
      this.review.title = look?.reviewed ? 'Reviewed: approved to play on the Folly' : passing ? 'Mark this look approved for the Folly' : 'Needs a passing render-box bake of the saved code first';
    }

    const poll = look && ACTIVE.has(bake?.status);
    if (poll && !this.timer) this.timer = setTimeout(() => this.poll(), POLL_MS);
    if (!poll && this.timer) { clearTimeout(this.timer); this.timer = 0; }
  }

  async bake() {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    this.render();
    try {
      if (!this.host.look() || this.host.dirty()) {
        if (!(await this.host.save())) return;
      }
      const look = this.host.look();
      const { bake } = await api.bake(look.id);
      this.host.setLook({ ...look, bake });
      toast('Baking in the render box…', { timeout: 2500 });
    } catch (err) {
      if (err.status === 401) { this.host.signedOut(); return; }
      this.error = err.message;               // 503: no render box here; 429: queue full
      toast(this.error, { kind: err.status === 503 ? 'warn' : 'error', timeout: 8000 });
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async poll() {
    this.timer = 0;
    const id = this.host.look()?.id;
    if (!id || this.destroyed) return;
    try {
      const { look } = await api.look(id);
      if (this.destroyed || this.host.look()?.id !== id) return;
      const before = bakeState(this.host.look()?.bake).kind;
      this.host.setLook(look);
      const after = bakeState(look.bake).kind;
      if (before !== after && (after === 'ok' || after === 'flagged' || after === 'failed')) {
        toast(after === 'ok' ? 'Baked: the flash check passed.' : `Bake ${after === 'flagged' ? 'flagged' : 'failed'}: ${look.bake.reason || ''}`,
          { kind: after === 'ok' ? 'ok' : 'error', timeout: 7000 });
      }
    } catch (err) {
      if (err.status === 401) { this.host.signedOut(); return; }
    }
    this.render();
  }

  async togglePlay() {
    const on = !this.playing;
    const look = this.host.look();
    const sha = look?.bake?.frames?.sha256;
    this.playBtn.disabled = true;
    try {
      // On a phone or a slow or metered link, the first press only says how much would download.
      if (on && look && !autoFetchAllowed() && this.sized?.sha !== sha) {
        this.sized = { sha, bytes: (await fetchManifest(look.id)).bytes };
        return;
      }
      await this.host.playBaked(on);
    } catch (err) {
      if (err.status === 401) { this.host.signedOut(); return; }
      toast(err.message, { kind: 'error', timeout: 7000 });
    } finally {
      this.playBtn.disabled = false;
      this.render();
    }
  }

  setPlaying(on) {
    this.playing = on;
    this.render();
  }

  async setReviewed(on) {
    const look = this.host.look();
    if (!look) return;
    this.busy = true;
    this.error = '';
    this.render();
    try {
      const res = await api.updateLook(look.id, { reviewed: on });
      this.host.setLook(res.look);
      toast(on ? 'Marked reviewed.' : 'No longer marked reviewed.', { kind: 'ok' });
    } catch (err) {
      if (err.status === 401) { this.host.signedOut(); return; }
      this.error = err.message;               // the server's 409 says why
      toast(err.message, { kind: 'error', timeout: 9000 });
      if (err.status === 409) setTimeout(() => this.poll(), 0);   // our copy is stale: catch up
    } finally {
      this.busy = false;
      this.render();
    }
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
  }
}

/**
 * Baked frames, ready to show, streamed (frames-stream.js): resolves once the first 2 s are in, then
 * frameAt(i, rgb) fills a Float32Array(count × 3) from the server's frames. No pattern code runs.
 * `opts.onChunk(n)` hears when a frame asked for before its chunk arrived can be shown.
 */
export function loadBakedFrames(lookId, cathedral, opts) {
  return openFrameStream(lookId, cathedral, opts);
}
