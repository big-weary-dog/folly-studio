// One round of how an idea was made (SPEC-generators "How it was made"): its head (what it did, how long; dollars for
// admins) and, opened, its plan, thinking summary, the stills it looked at, what it saw, what it changed
// and why, and what the checks found.
import type { HowChecks, HowRound, HowStill } from '../../../../shared/schemas/api.ts';
import { cx } from '../kit.tsx';

export const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
export const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
export const usd = (d: number) => `$${d.toFixed(d < 0.1 ? 3 : 2)}`;
const KINDS: Record<string, string> = { compose: 'Compose', draft: 'Drafts', take: 'Take', repair: 'Repair',
  notes: 'Params fixed', runtime: 'Runtime fix', critique: 'Critique', edits: 'Edits fixed' };
export const kindName = (kind: string) => KINDS[kind] ?? kind;

/** A still the model was shown, served from the idea's log. */
export function Still({ ideaId, s, big }: { ideaId: string; s: HowStill; big?: boolean }) {
  return (
    <figure class={cx('ai-still', big && 'big')}>
      <img src={`/api/ideas/${encodeURIComponent(ideaId)}/how/stills/${encodeURIComponent(s.file)}`} loading="lazy"
        alt={`The ${s.view} at ${s.at} s, as the model saw it`} />
      <figcaption>{s.view} · {s.at} s</figcaption>
    </figure>);
}

/** A change line's sign: added, removed, or changed. */
const opOf = (text: string) => (text.startsWith('+ ') ? 'add' : text.startsWith('− ') ? 'remove' : 'set');
const SIGNS = { add: '+', remove: '−', set: '~' };

function Changes({ r }: { r: HowRound }) {
  if (!r.changes?.length) return <p class="ai-dim">Nothing changed.</p>;
  return (
    <ul class="ai-edits">
      {r.changes.map((c) => {
        const op = opOf(c.text);
        return <li class={`ai-edit op-${op}`}>
          <span class="ai-op" aria-label={op}>{SIGNS[op]}</span>
          <span class="ai-where">{op === 'set' ? c.text : c.text.slice(2)}</span>
          {c.why && <span class="ai-why">{c.why}</span>}
        </li>;
      })}
    </ul>);
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
/** What the render check found, each ok, a warning or bad. */
function checkRows(c: HowChecks) {
  const rows: { name: string, detail: string, state: 'ok' | 'warn' | 'bad' }[] = [{ name: 'Render',
    detail: c.errors ? `${c.errors} error${c.errors > 1 ? 's' : ''}` : `ran in ${secs(c.ms)}`,
    state: c.errors ? 'bad' : 'ok' }];
  if (c.meanBrightness !== undefined) {
    rows.push({ name: 'Brightness', detail: `${pct(c.meanBrightness)} on average, ${pct(c.darkFraction ?? 0)} dark`,
      state: (c.darkFraction ?? 0) > 0.8 || c.meanBrightness < 0.03 ? 'warn' : 'ok' });
  }
  if (c.flashOk !== undefined) {
    rows.push({ name: 'Flashing', detail: c.flashOk ? `ok (at most ${c.flashHz} Hz)` : `${c.flashHz} Hz: too fast`,
      state: c.flashOk ? 'ok' : 'bad' });
  }
  return rows;
}

/** A round: its head and, open, the rest. `live`: it is still running. */
export function RoundCard({ r, ideaId, open, onToggle, admin, live }: { r: HowRound; ideaId: string; open: boolean;
  onToggle: (o: boolean) => void; admin: boolean; live?: boolean }) {
  const stills = Array.isArray(r.stills) ? r.stills : [], counted = typeof r.stills === 'number' ? r.stills : 0;
  return (
    <details class={cx('ai-round', live && 'is-live')} open={open}
      onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span class="ai-round-n">{r.n > 100 ? r.n - 100 : r.n}</span>
        <span class="ai-round-title">{kindName(r.kind)}</span>
        <span class={cx('ai-outcome', live && 'pending', r.outcome?.startsWith('failed') && 'bad')}>
          {live ? 'Thinking…' : r.outcome}</span>
        <span class="ai-dim ai-round-meta">{live ? `running · ${secs(r.ms)}` : <>{secs(r.ms)}
          {admin && r.usd !== undefined && ` · ${usd(r.usd)}`}</>}</span>
      </summary>
      <div class="ai-round-body">
        {r.plan && <p class="ai-plan"><span class="ai-label">Plan</span>{r.plan}</p>}
        {r.thinking && <section class="ai-think" aria-live={live ? 'polite' : undefined}>
          <span class="ai-label">Thinking<span class="ai-dim"> · a summary</span></span>
          <p class="ai-think-text">{r.thinking}{live && <span class="ai-caret" aria-hidden="true" />}</p>
        </section>}
        {stills.length ? <section>
          <span class="ai-label">What it looked at</span>
          <div class="ai-stills">{stills.map((s) => <Still ideaId={ideaId} s={s} />)}</div>
        </section> : counted ? <p class="ai-dim">It looked at {counted} stills, no longer kept.</p>
          : r.kind === 'compose' && <p class="ai-dim">It composes without seeing a render: the next round looks at
            this one's.</p>}
        {r.critique && <p class="ai-critique"><span class="ai-label">What it saw</span>{r.critique}</p>}
        {r.warnings?.length ? <p class="ai-dim">Told: {r.warnings.join('; ')}</p> : null}
        {!live && <section><span class="ai-label">What it changed, and why</span><Changes r={r} /></section>}
        {r.checks && <section>
          <span class="ai-label">Checks</span>
          <ul class="ai-checks">{checkRows(r.checks).map((c) => <li class={`ai-check is-${c.state}`}>
            <span class="status-dot" aria-hidden="true" /><b>{c.name}</b> {c.detail}</li>)}</ul>
        </section>}
        {r.docs?.length ? <p class="ai-dim">Read: {r.docs.join(', ')}</p> : null}
        {admin && r.tokens && <p class="ai-dim ai-tokens">{k(r.tokens.input)} in ({k(r.tokens.cached)} cached) ·
          {' '}{k(r.tokens.output)} out{r.tokens.reasoning ? ` (${k(r.tokens.reasoning)} reasoning)` : ''}</p>}
        {admin && (r.reason?.length || r.notes?.length) ? <pre class="ai-pre">{[...r.reason ?? [], ...r.notes ?? []]
          .join('\n')}</pre> : null}
      </div>
    </details>);
}
