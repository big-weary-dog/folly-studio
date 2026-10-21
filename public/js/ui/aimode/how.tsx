// How an idea was made (SPEC-generators "How it was made"), the page an idea's row links: what the AI was asked, then
// its rounds, the latest open, each with its plan, thinking summary, stills, what it saw, what it changed and why, and
// its checks. Its owner's, or an admin's (who also sees the shared prompt, errors and dollars). While the idea runs
// it polls what the running round is doing (folded: open it to watch its thinking) and fetches again as rounds end.
import '../../../css/pages.css';
import '../../../css/aimode.css';

import { useEffect, useState } from 'preact/hooks';

import { api } from '../../api.ts';
import { isPending } from '../../../../shared/idea-status.ts';
import { can } from '../../../../shared/policy.ts';
import type { HowPart, HowStill, IdeaHow, IdeaHowLive } from '../../../../shared/schemas/api.ts';
import { setTitle, user, type ViewProps } from '../session.ts';
import { k, RoundCard, secs, Still, usd } from './round.tsx';

const POLL_MS = 2000;
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
  return (
    <details class="ai-block ai-prompt">
      <summary><h3>What the AI was asked</h3></summary>
      <div class="ai-parts">{parts.map((p) => <PromptPart p={p} />)}</div>
    </details>);
}

export function IdeaHowPage({ params }: ViewProps) {
  const id = params.ideaId ?? '';
  const [how, setHow] = useState<IdeaHow | null>(null), [error, setError] = useState('');
  const [open, setOpen] = useState<Set<number> | null>(null);
  const [live, setLive] = useState<IdeaHowLive | null>(null), [liveOpen, setLiveOpen] = useState(false);
  useEffect(() => {
    setTitle('How it was made');
    let alive = true, timer = 0, rounds = 0, status = '';
    const load = () => api.ideaHow(id).then((r) => {
      if (!alive) return;
      [rounds, status] = [r.rounds.length, r.idea.status];
      setHow(r);
    });
    // While it runs: what the running round is doing, and the whole again once a round ends or the idea does.
    const poll = async () => {
      try {
        if (!document.hidden) {
          const now = await api.ideaHowLive(id);
          if (!alive) return;
          setLive(now);
          if (now.rounds !== rounds || now.status !== status) await load();
        }
      } catch { /* the next poll tries again */ }
      if (alive && isPending({ status })) timer = window.setTimeout(poll, POLL_MS);
      else if (alive) setLive(null);
    };
    load().then(() => { if (alive && isPending({ status })) void poll(); })
      .catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; clearTimeout(timer); };
  }, [id]);
  if (error) return <div class="page"><p class="empty">{error}</p><p><a href="/ideas">Back to your ideas</a></p></div>;
  if (!how) return <div class="page"><p class="empty">Loading…</p></div>;

  const { idea, rounds, run } = how, admin = can(user.value, 'admin'), mine = idea.owner === user.value?.id;
  const running = isPending(idea), now = running ? live?.round : undefined;
  const shown = open ?? new Set(rounds.length ? [rounds.length - 1] : []);
  // Setting `open` fires a toggle too: only a change from what is shown is the viewer's.
  const toggle = (i: number, o: boolean) => o !== shown.has(i) && setOpen(() => {
    const next = new Set(shown);
    if (o) next.add(i); else next.delete(i);
    return next;
  });
  const tokens = rounds.reduce((s, r) => s + (r.tokens ? r.tokens.input + r.tokens.output : 0), 0);
  const ms = idea.timing?.total ?? rounds.reduce((s, r) => s + r.ms, 0);
  const stills = rounds.flatMap((r) => (Array.isArray(r.stills) ? r.stills : [])) as HowStill[];
  const last = stills.filter((s) => s.view === 'front').at(-1) ?? stills.at(-1);
  const meta = [idea.by || idea.generator, run.effort && `effort ${run.effort}`, run.level,
    ms && secs(ms),
    tokens && `${k(tokens)} tokens`, admin && how.usd !== undefined && usd(how.usd), admin && run.name]
    .filter(Boolean).join(' · ');
  return (
    <div class="ai-mode">
      <header class="ai-head">
        <div>
          <span class="ai-label">{running ? (mine ? 'Making your idea' : 'Making this idea')
            : mine ? 'How your idea was made' : 'How this idea was made'}</span>
          <h1 class="ai-idea">{idea.text}</h1>
          <p class="ai-dim ai-meta">{meta}</p>
        </div>
        <div class="ai-actions">
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
              : !now && <p class="ai-dim">{running ? (idea.status === 'queued' ? 'Waiting for its turn.'
                : 'Starting.') : how.from === 'none' ? 'No record of how this idea was made: it is older than the '
                + 'record, or its model works in one step.' : 'No rounds yet.'}</p>}
            {now && <RoundCard r={now} ideaId={idea.id} admin={admin} live open={liveOpen} onToggle={setLiveOpen} />}
            {how.from === 'idea' && <p class="ai-dim">The full record is no longer kept: this is the summary the idea
              keeps, without its stills or prompt.</p>}
          </div>
        </section>
      </div>
    </div>);
}
