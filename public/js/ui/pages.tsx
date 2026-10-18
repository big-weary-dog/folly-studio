// The list pages. Ideas: describe a show, watch it turn into a look, open it in the Studio. My looks and the
// Gallery: cards that open in the Studio (lists carry metadata only; the Studio fetches a look).
import '../../css/pages.css';

import { useEffect, useRef, useState } from 'preact/hooks';

import { api, statusOf } from '../api.ts';
import type { Idea, LookCard } from '../types.ts';
import { navigate, setTitle, signedOut, user, type ViewProps } from './session.ts';
import { confirmDialog, cx, jewelGradient, timeAgo, toast } from './kit.tsx';
import { Rose } from './rose.tsx';

const EXAMPLES = ['Rising embers drift up the spires', 'A coral reef breathing in slow blues and pinks',
  'Lightning cracks across the arches in a storm', 'The rose window blooms like a sunrise',
  'A heartbeat at 120 bpm pulsing through the nave', 'Aurora curtains sweep over the canopy'];
const STATUS: Record<string, [string, string]> = { queued: ['Queued', 'pending'], generating: ['Generating', 'pending'],
  ready: ['Ready', 'ok'], failed: ['Failed', 'bad'] };
const MAX_LEN = 2000;
// While an idea is being made, its status is asked for after 2 s, then 1.5× as long each time, up to 10 s.
const POLL_FIRST_MS = 2000, POLL_MAX_MS = 10_000;
const isPending = (i: Idea) => i.status === 'queued' || i.status === 'generating';
const studioHref = (id: string) => `/studio/${encodeURIComponent(id)}`;

/** Polls the pending ideas with backoff (an unchanged one answers 304, no body), never from a hidden tab. */
function usePolling(ideas: Idea[] | null, setIdeas: (f: (all: Idea[]) => Idea[]) => void, reload: () => void) {
  const ms = useRef(POLL_FIRST_MS), latest = useRef(ideas), [round, setRound] = useState(0);
  latest.current = ideas;
  const pending = !!ideas?.some(isPending);
  useEffect(() => {
    if (!pending) return undefined;
    let timer = 0, alive = true, busy = false;
    const schedule = () => {
      clearTimeout(timer);
      timer = 0;
      if (alive && !document.hidden) timer = window.setTimeout(poll, ms.current);
    };
    async function poll() {
      timer = 0;
      if (!alive || document.hidden || busy) return;
      busy = true;
      const asked = (latest.current || []).filter(isPending);
      try {
        const fresh = (await Promise.all(asked.map((i) => api.idea(i.id)))).map((r) => r.idea).filter(Boolean);
        if (!alive) return;
        const byId = new Map(fresh.map((i) => [i!.id, i!]));
        if (asked.some((i) => byId.get(i.id)?.updatedAt !== i.updatedAt)) {
          setIdeas((all) => all.map((i) => byId.get(i.id) ?? i));
        }
      } catch (err) {
        if (statusOf(err) === 401) return signedOut();
        if (statusOf(err) === 404) return reload(); // gone: the list says what is left
      } finally {
        busy = false;
      }
      ms.current = Math.min(POLL_MAX_MS, ms.current * 1.5);
      schedule();
    }
    // Back on the tab: ask at once, then carry on backing off.
    const onVisibility = () => { if (!document.hidden && !timer) poll(); };
    document.addEventListener('visibilitychange', onVisibility);
    schedule();
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pending, round]);
  return () => { ms.current = POLL_FIRST_MS; setRound((n) => n + 1); };
}

export function Ideas() {
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [text, setText] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null), form = useRef<HTMLFormElement>(null);
  const known = useRef(new Map<string, string>());        // id → status, to notice when one becomes ready
  const ready = useRef(new Map<string, () => void>());    // look id → close() of its "ready" toast

  // Toasts for ideas that just became ready or failed.
  useEffect(() => {
    for (const idea of ideas || []) {
      const before = known.current.get(idea.id);
      if (before && before !== 'ready' && idea.status === 'ready' && idea.lookId) {
        const id = idea.lookId;
        ready.current.set(id, toast('Your look is ready.', { kind: 'ok', timeout: 8000,
          action: { label: 'Open', onClick: () => navigate(studioHref(id)) } }));
      } else if (before && before !== 'failed' && idea.status === 'failed') {
        toast(`An idea could not be generated${idea.error ? `: ${idea.error}` : '.'}`, { kind: 'error' });
      }
      known.current.set(idea.id, idea.status);
    }
  }, [ideas]);

  const load = () => api.ideas().then((r) => setIdeas(r.ideas || [])).catch((err) => {
    if (statusOf(err) === 401) return signedOut();
    setIdeas((all) => all || []);
    toast(err.message, { kind: 'error' });
  });
  const restartPolls = usePolling(ideas, (f) => setIdeas((all) => f(all || [])), load);
  useEffect(() => {
    setTitle('Ideas');
    load();
    if (matchMedia('(pointer: fine)').matches && document.activeElement === document.body) {
      input.current?.focus({ preventScroll: true });
    }
    return () => {     // opening a look closes its "ready" toast
      const opened = /^\/studio\/([^/]+)/.exec(location.pathname);
      if (opened) ready.current.get(decodeURIComponent(opened[1]))?.();
    };
  }, []);

  const prefill = (t: string) => { setText(t); input.current?.focus(); };
  async function submit(e: Event) {
    e.preventDefault();
    const t = text.trim();
    setError(t ? '' : 'Describe your idea first.');
    if (!t) return input.current?.focus();
    setBusy(true);
    try {
      const { idea } = await api.createIdea(t);
      setText('');
      known.current.set(idea.id, idea.status);
      setIdeas((all) => [idea, ...(all || []).filter((i) => i.id !== idea.id)]);
      restartPolls();
    } catch (err) {
      if (statusOf(err) === 401) return signedOut();
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="page ideas-page">
      <section class="compose">
        <h1 class="page-title">Describe a show idea</h1>
        <p class="lede">A sentence or two is plenty: colours, motion, mood, which parts of the installation. It becomes
          pattern code you can preview, tweak and export.</p>
        <form class="idea-form" ref={form} onSubmit={submit}>
          <label for="idea-input" class="sr-only">Describe a show idea</label>
          <textarea id="idea-input" ref={input} class="idea-input" rows={4} maxlength={MAX_LEN} value={text}
            placeholder="A coral reef breathing in slow blues, with fish darting up the spires…"
            onInput={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.current?.requestSubmit(); }
            }} />
          <div class="chips-row"><span class="chips-label">Try:</span>
            <div class="chips" role="group" aria-label="Example ideas">
              {EXAMPLES.map((ex) => <button type="button" class="chip" onClick={() => prefill(ex)}>{ex}</button>)}
            </div></div>
          <p class="form-error" role="alert" hidden={!error}>{error}</p>
          <div class="idea-form-actions">
            <span class="char-count" aria-live="off">{`${text.length} / ${MAX_LEN}`}</span>
            <span class="kbd-hint">Ctrl + Enter</span>
            <button class={cx('btn primary', busy && 'busy')} type="submit" disabled={busy}>Turn it into a look</button>
          </div>
        </form>
      </section>
      <section class="ideas-section" aria-labelledby="my-ideas-h">
        <div class="section-head"><h2 id="my-ideas-h">My ideas</h2>
          <a class="btn ghost small" href="/studio">Blank Studio</a></div>
        <ul class="idea-list" aria-live="polite" aria-busy={!ideas}>
          {ideas?.map((idea) => <IdeaRow key={idea.id} idea={idea}
            retry={() => { prefill(idea.text); window.scrollTo({ top: 0 }); }} />)}</ul>
        <div class="empty" hidden={!ideas || ideas.length > 0}>
          <p>No ideas yet. Describe one above — or <a href="/studio">start from a blank Studio</a>.</p></div>
      </section>
    </div>);
}

function IdeaRow({ idea, retry }: { idea: Idea; retry: () => void }) {
  const [label, cls] = STATUS[idea.status] || [idea.status, 'pending'];
  return (
    <li class={`idea is-${idea.status}`}>
      {/* The rose fills while the idea is being made and is lit once it is ready. */}
      <span class="idea-pane"><Rose class={isPending(idea) ? 'idea-rose rose-fill' : 'idea-rose'} /></span>
      <div class="idea-main">
        <p class="idea-text">{idea.text}</p>
        <div class="idea-meta">
          <span class={`status status-${cls}`}><span class="status-dot" aria-hidden="true" />{label}</span>
          {idea.generator && <span class="meta-item">{idea.generator}</span>}
          <time class="meta-item" dateTime={idea.createdAt || ''}>{timeAgo(idea.createdAt)}</time>
        </div>
        {idea.status === 'failed' && idea.error && <p class="idea-error">{idea.error}</p>}
      </div>
      <div class="idea-actions">
        {idea.status === 'ready' && idea.lookId ? <a class="btn primary small" href={studioHref(idea.lookId)}>Open in
          Studio</a> : idea.status === 'failed' && <button class="btn ghost small" type="button" onClick={retry}>
          Try again</button>}
      </div>
    </li>);
}

export function Looks({ scope }: ViewProps) {
  const gallery = scope === 'gallery';
  const [looks, setLooks] = useState<LookCard[] | null>(null), [error, setError] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    setTitle(gallery ? 'Gallery' : 'My looks');
    let alive = true;
    api.looks(gallery ? 'gallery' : 'mine').then((r) => { if (alive) setLooks(r.looks || []); }).catch((err) => {
      if (statusOf(err) === 401) return signedOut();
      setError(err.message);
    });
    return () => { alive = false; };
  }, []);

  async function remove(look: LookCard) {
    const ok = await confirmDialog(`Delete “${look.title}”? This cannot be undone.`,
      { title: 'Delete look', ok: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.deleteLook(look.id);
      setLooks((all) => (all || []).filter((l) => l.id !== look.id));
      toast('Look deleted.');
    } catch (err) {
      if (statusOf(err) === 401) return signedOut();
      toast((err as Error).message, { kind: 'error' });
    }
  }

  const words = q.trim().toLowerCase();
  const shown = (looks || []).filter((l) => !words
    || `${l.title} ${l.summary || ''} ${l.ownerName || ''}`.toLowerCase().includes(words));
  const empty = error ? <p class="form-error">{error}</p> : looks?.length ? <p>No looks match that search.</p>
    : gallery ? <p>Nothing shared yet. Open one of your looks in the Studio and switch on “Share to gallery”.</p>
    : <p>No saved looks yet. <a href="/ideas">Describe an idea</a> or <a href="/studio">start a blank look</a>.</p>;
  return (
    <div class="page looks-page">
      <div class="section-head page-head">
        <div><h1 class="page-title">{gallery ? 'Gallery' : 'My looks'}</h1>
          <p class="lede">{gallery ? 'Looks people have shared. Open one to watch it; edit it and Save makes it your '
            + 'own copy.' : 'Everything you have saved. Share one to put it in the gallery.'}</p></div>
        <div class="head-actions">
          <input type="search" class="search" aria-label="Search looks" value={q}
            placeholder={gallery ? 'Search the gallery' : 'Search my looks'}
            onInput={(e) => setQ(e.currentTarget.value)} />
          {!gallery && <a class="btn primary" href="/studio">New look</a>}
        </div>
      </div>
      <ul class="card-grid" aria-busy={!looks && !error}>
        {shown.map((look) => <Card key={look.id} look={look} gallery={gallery} remove={remove} />)}</ul>
      <div class="empty" hidden={(!looks && !error) || shown.length > 0}>{empty}</div>
    </div>);
}

function Card({ look, gallery, remove }: { look: LookCard; gallery: boolean; remove: (l: LookCard) => void }) {
  const n = look.layerCount ?? 0, href = studioHref(look.id);
  return (
    <li class="card">
      <div class="card-art" aria-hidden="true" style={{ '--art': jewelGradient(look.id + look.title) }} />
      <div class="card-body">
        <h2 class="card-title"><a href={href}>{look.title || 'Untitled look'}</a></h2>
        {look.summary && <p class="card-summary">{look.summary}</p>}
        <div class="card-meta">
          {gallery && <span class="meta-item">{`by ${look.ownerName || 'someone'}`}</span>}
          <span class="meta-item">{`${n} layer${n === 1 ? '' : 's'}`}</span>
          <time class="meta-item" dateTime={look.updatedAt || ''}>{timeAgo(look.updatedAt || look.createdAt)}</time>
          {look.shared && !gallery && <span class="tag tag-sapphire">Shared</span>}
          {look.reviewed && <span class="tag tag-emerald">Reviewed</span>}
        </div>
      </div>
      <div class="card-actions"><a class="btn small" href={href}>Open</a>
        {look.owner === user.value?.id && !gallery && <button class="btn small ghost danger-text" type="button"
          aria-label={`Delete ${look.title}`} onClick={() => remove(look)}>Delete</button>}
      </div>
    </li>);
}
