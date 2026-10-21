// How an idea was made (SPEC-generators "How it was made"), the page an idea's row links: what the AI was asked, then
// its rounds, the latest open, each with its plan, thinking summary, stills, what it saw, what it changed and why, and
// its checks. Its owner's, or an admin's (who also sees the shared prompt, errors and dollars).
import '../../../css/pages.css';
import '../../../css/aimode.css';

import { useEffect, useState } from 'preact/hooks';

import { api } from '../../api.ts';
import { can } from '../../../../shared/policy.ts';
import type { HowPart, HowStill, IdeaHow } from '../../../../shared/schemas/api.ts';
import { setTitle, user, type ViewProps } from '../session.ts';
import { k, RoundCard, secs, Still, usd } from './round.tsx';

const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`;
const studioHref = (id: string) => `/studio/${encodeURIComponent(id)}`;

function PromptPart({ p }: { p: HowPart }) {
  return (
    <details class="ai-part">
      <summary>
        <span class="ai-part-name">{p.name}</span>
        <span class="ai-dim">{kb(p.bytes)} · ≈{k(p.tokens)} tokens</span>
      </summary>
      {p.text === undefined ? <p class="ai-dim ai-locked">Shared by every idea; admins see it in full.</p>
        : <pre class="ai-pre">{p.text}</pre>}
    </details>);
}

function Prompt({ parts }: { parts: HowPart[] }) {
  const total = parts.reduce((s, p) => s + p.tokens, 0);
  return (
    <details class="ai-block ai-prompt">
      <summary><h3>What the AI was asked</h3><span class="ai-dim">≈{k(total)} tokens</span></summary>
      <div class="ai-parts">{parts.map((p) => <PromptPart p={p} />)}</div>
    </details>);
}

export function IdeaHowPage({ params }: ViewProps) {
  const id = params.ideaId ?? '';
  const [how, setHow] = useState<IdeaHow | null>(null), [error, setError] = useState('');
  const [open, setOpen] = useState<Set<number> | null>(null);
  useEffect(() => {
    setTitle('How it was made');
    let alive = true;
    api.ideaHow(id).then((r) => { if (alive) setHow(r); }).catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [id]);
  if (error) return <div class="page"><p class="empty">{error}</p><p><a href="/ideas">Back to your ideas</a></p></div>;
  if (!how) return <div class="page"><p class="empty">Loading…</p></div>;

  const { idea, rounds, run } = how, admin = can(user.value, 'admin'), mine = idea.owner === user.value?.id;
  const shown = open ?? new Set(rounds.length ? [rounds.length - 1] : []);
  const toggle = (i: number, o: boolean) => setOpen(() => {
    const next = new Set(shown);
    if (o) next.add(i); else next.delete(i);
    return next;
  });
  const tokens = rounds.reduce((s, r) => s + (r.tokens ? r.tokens.input + r.tokens.output : 0), 0);
  const ms = idea.timing?.total ?? rounds.reduce((s, r) => s + r.ms, 0);
  const stills = rounds.flatMap((r) => (Array.isArray(r.stills) ? r.stills : [])) as HowStill[];
  const last = stills.filter((s) => s.view === 'front').at(-1) ?? stills.at(-1);
  const meta = [idea.by || idea.generator, run.effort && `effort ${run.effort}`, run.level,
    rounds.length && `${rounds.length} round${rounds.length > 1 ? 's' : ''}`, ms && secs(ms),
    tokens && `${k(tokens)} tokens`, admin && how.usd !== undefined && usd(how.usd), admin && run.name]
    .filter(Boolean).join(' · ');
  return (
    <div class="ai-mode">
      <header class="ai-head">
        <div>
          <span class="ai-label">{mine ? 'How your idea was made' : 'How this idea was made'}</span>
          <h1 class="ai-idea">{idea.text}</h1>
          <p class="ai-dim ai-meta">{meta}</p>
        </div>
        <div class="ai-actions">
          <a class="btn ghost small" href="/ideas">Ideas</a>
          {idea.status === 'ready' && idea.lookId && <a class="btn primary small" href={studioHref(idea.lookId)}>Open
            in Studio</a>}
        </div>
      </header>
      <div class={last ? 'ai-cols' : 'ai-cols one'}>
        {last && <section class="ai-view" aria-label="The look as the AI last saw it">
          <Still ideaId={idea.id} s={last} big />
        </section>}
        <section class="ai-panel" aria-label="How it was made">
          {how.prompt?.length ? <Prompt parts={how.prompt} /> : null}
          <div class="ai-block">
            <div class="ai-rounds-head"><h3>Rounds</h3>
              {rounds.length > 1 && <button type="button" class="btn ghost small" onClick={() => setOpen(shown.size
                ? new Set() : new Set(rounds.map((_, i) => i)))}>{shown.size ? 'Collapse all' : 'Expand all'}</button>}
            </div>
            {rounds.length ? rounds.map((r, i) => <RoundCard r={r} ideaId={idea.id} admin={admin} open={shown.has(i)}
              onToggle={(o) => toggle(i, o)} />)
              : <p class="ai-dim">{how.from === 'none' ? 'No record of how this idea was made: it is older than the '
                + 'record, or its model works in one step.' : 'No rounds yet.'}</p>}
            {how.from === 'idea' && <p class="ai-dim">The full record is no longer kept: this is the summary the idea
              keeps, without its stills or prompt.</p>}
          </div>
        </section>
      </div>
    </div>);
}
