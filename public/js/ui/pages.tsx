// The list pages. Ideas: describe a show, watch it turn into a look, open it in the Studio. My looks and the
// Gallery: cards that open in the Studio (lists carry metadata only; the Studio fetches a look). A card with a
// preview plays it through its glass, or shows its still under reduced motion (SPEC-previews).
import '../../css/pages.css';

import { useEffect, useRef, useState } from 'preact/hooks';

import { api, statusOf } from '../api.ts';
import { type IdeaStatus, isPending } from '../../../shared/idea-status.ts';
import { can } from '../../../shared/policy.ts';
import type { Access } from '../../../shared/schemas/access.ts';
import type { Explore, Idea, Listed } from '../../../shared/schemas/api.ts';
import type { ModelChoices } from '../../../shared/schemas/models.ts';
import { navigate, onPi, setTitle, user, type ViewProps } from './session.ts';
import { AccessGate, gateOf } from './idea-access.tsx';
import { Approve } from './approve.tsx';
import { deleteLook, mayDelete } from './delete-look.ts';
import { cx, jewelGradient, lazy, pref, timeAgo, toast } from './kit.tsx';
import { LookFiles } from './look-files.tsx';
import { Rose } from './rose.tsx';
import { tourIdea } from './tour-view.ts';

const lights = lazy(() => import('./play-lights.tsx'));

const EXAMPLES = ['Rising embers drift up the spires', 'A coral reef breathing in slow blues and pinks',
  'Lightning cracks across the arches in a storm', 'The rose window blooms like a sunrise',
  'A heartbeat at 120 bpm pulsing through the nave', 'Aurora curtains sweep over the canopy'];
const STATUS: Record<IdeaStatus, [string, string]> = { queued: ['Queued', 'pending'],
  generating: ['Generating', 'pending'], ready: ['Ready', 'ok'], failed: ['Failed', 'bad'] };
const MAX_LEN = 2000;
// How much a paid model explores (SPEC-generators "Explore"): its name, rough time and what it does.
const LEVELS: Record<Explore, [string, string, string]> = {
  quick: ['Quick', '~1 min', 'One composition, checked in the render box, looked at once when the model can.'],
  explore: ['Explore', '~5 min', 'Drafts 3 different takes, keeps the best of each, then looks at the render and '
    + 'revises it.'],
  deep: ['Deep', '~13 min', 'Builds all 3 takes and renders them side by side, composes from what worked, then revises '
    + 'twice.'],
};
const EXPLORE_KEY = 'studio.explore';
const remembered = (): Explore => { const v = pref(EXPLORE_KEY); return v && v in LEVELS ? v as Explore : 'explore'; };
// While an idea is being made it is followed by long polls: the server answers when it changes, or after 25 s. One
// that answers at once and unchanged is asked again after 2 s, then 1.5× as long each time, up to 10 s.
const POLL_FIRST_MS = 2000, POLL_MAX_MS = 10_000;
const studioHref = (id: string) => `/studio/${encodeURIComponent(id)}`;
const previewHref = (l: Listed) => `/api/looks/${encodeURIComponent(l.id)}/preview/${l.preview}`;
/** "Opus, Sol and Luna". */
const listed = (names: string[]) => names.length < 2 ? names.join('')
  : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shown = () => new Promise<void>((r) => {
  const on = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', on); r(); } };
  document.addEventListener('visibilitychange', on);
});

/** Follows one idea while it is pending (never from a hidden tab), handing each change to `set`. */
async function follow(start: Idea, set: (i: Idea) => void, gone: () => void, alive: () => boolean) {
  let cur = start, ms = POLL_FIRST_MS;
  while (alive() && isPending(cur)) {
    if (document.hidden) { await shown(); continue; }
    const asked = Date.now();
    try {
      const fresh = (await api.idea(cur.id, `${cur.status}@${cur.updatedAt}`)).idea;
      if (!alive()) return;
      if (fresh && (fresh.updatedAt !== cur.updatedAt || fresh.status !== cur.status)) {
        [cur, ms] = [fresh, POLL_FIRST_MS];
        set(fresh);
        continue;
      }
    } catch (err) {
      if (statusOf(err) === 404) return gone(); // the list says what is left
    }
    if (Date.now() - asked < 1000) {
      await sleep(ms);
      ms = Math.min(POLL_MAX_MS, ms * 1.5);
    }
  }
}

/** Follows each pending idea until it is ready or failed. */
function usePolling(ideas: Idea[] | null, setIdeas: (f: (all: Idea[]) => Idea[]) => void, reload: () => void) {
  const following = useRef(new Set<string>()), mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    for (const idea of ideas || []) {
      if (!isPending(idea) || following.current.has(idea.id)) continue;
      following.current.add(idea.id);
      follow(idea, (fresh) => setIdeas((all) => all.map((i) => (i.id === fresh.id ? fresh : i))), reload,
        () => mounted.current).finally(() => following.current.delete(idea.id));
    }
  }, [ideas]);
}

export function Ideas() {
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [text, setText] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<ModelChoices | null>(null), [model, setModel] = useState('');
  const [access, setAccess] = useState<Access | null>(null), [explore, setExplore] = useState(remembered);
  const refresh = () => api.me().then((m) => setAccess(m.access ?? null), () => {});
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
      if (before && before !== idea.status && !isPending(idea)) refresh();  // a slot came free
      known.current.set(idea.id, idea.status);
    }
  }, [ideas]);

  const load = () => api.ideas().then((r) => setIdeas((r.ideas || []).filter((i) => !i.refine))).catch((err) => {
    setIdeas((all) => all || []);
    toast(err.message, { kind: 'error' });
  });
  usePolling(ideas, (f) => setIdeas((all) => f(all || [])), load);
  const pickable = choices && choices.models.length > 1 ? choices.models : null;
  const chosen = choices?.models.find((m) => m.id === (pickable ? model : choices.default));
  const free = choices?.models.find((m) => !m.paid);
  const paidLabels = listed((choices?.models ?? []).filter((m) => m.paid).map((m) => m.label));
  const gate = gateOf(access, chosen);
  const useFree = free && free.id !== chosen?.id && pickable ? () => setModel(free.id) : undefined;
  // The paid models explore; Deep only while it is on and this account may ask for it.
  const deep = choices?.deep, levels = (Object.keys(LEVELS) as Explore[]).filter((l) => l !== 'deep'
    || (deep && (!deep.adminOnly || can(user.value, 'admin'))));
  const level = levels.includes(explore) ? explore : 'explore';
  const pickLevel = (l: Explore) => { setExplore(l); pref(EXPLORE_KEY, l); };
  useEffect(() => {
    setTitle('Ideas');
    load();
    // The server's default for this account (a locked one's is the free model).
    Promise.all([api.models(), api.me()]).then(([c, m]) => {
      setChoices(c);
      setAccess(m.access ?? null);
      setModel(c.default ?? '');
    }).catch(() => setError("Couldn't load the AI models, so ideas use the default. Reload the page to pick one."));
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
    if (tourIdea.value) return void navigate(tourIdea.value);   // the tutorial's look, made already: no model runs
    if (gate.kind === 'locked' || gate.kind === 'wait') return;
    setBusy(true);
    try {
      const { idea } = await api.createIdea(t, pickable ? model : undefined, chosen?.explores ? level : undefined);
      setText('');
      known.current.set(idea.id, idea.status);
      setIdeas((all) => [idea, ...(all || []).filter((i) => i.id !== idea.id)]);
      if (chosen?.paid) refresh();
    } catch (err) {
      // Refused as locked or at a limit (another tab, a stale page): the gate says why, with the server's access.
      const now = (err as { data?: { access?: Access } }).data?.access;
      if (now) setAccess(now);
      const shown = now && ['locked', 'wait'].includes(gateOf(now, chosen).kind);
      setError(shown ? '' : (err as Error).message);
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
          <textarea id="idea-input" ref={input} class="idea-input"
            data-tour="idea" rows={4} maxlength={MAX_LEN} value={text}
            placeholder="A coral reef breathing in slow blues, with fish darting up the spires…"
            onInput={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.current?.requestSubmit(); }
            }} />
          <div class="chips-row"><span class="chips-label">Try:</span>
            <div class="chips" role="group" aria-label="Example ideas" data-tour="idea-examples">
              {EXAMPLES.map((ex) => <button type="button" class="chip" onClick={() => prefill(ex)}>{ex}</button>)}
            </div></div>
          {chosen?.explores && gate.kind !== 'locked' && <div class="explore">
            <div class="explore-row"><span id="explore-h">Exploring</span>
              <div class="seg" role="group" aria-labelledby="explore-h">
                {levels.map((l) => <button key={l} type="button" class="seg-btn" aria-pressed={l === level}
                  onClick={() => pickLevel(l)}>{LEVELS[l][0]}<small>{LEVELS[l][1]}</small></button>)}</div></div>
            <p class="explore-hint">{LEVELS[level][2]}{level === 'deep' && deep && deep.uses > 1
              ? ` Counts as ${deep.uses} ideas.` : ''}</p></div>}
          <p class="form-error" role="alert" hidden={!error}>{error}</p>
          <div class="idea-form-actions">
            <span class="char-count" aria-live="off">{`${text.length} / ${MAX_LEN}`}</span>
            <span class="kbd-hint">Ctrl + Enter</span>
            {pickable && <label class="model-pick">Model
              <select value={model} onChange={(e) => setModel(e.currentTarget.value)}>
                {pickable.map((m) => <option key={m.id} value={m.id}>
                  {m.paid && access && !access.unlocked ? `${m.label} (invite)` : m.label}</option>)}</select></label>}
            {gate.kind === 'open' && <AccessGate gate={gate} paidLabels={paidLabels} onAccess={setAccess} />}
            {(gate.kind !== 'locked' || tourIdea.value) && <button class={cx('btn primary', busy && 'busy')}
              type="submit" data-tour="idea-make" disabled={busy || (gate.kind === 'wait' && !tourIdea.value)}>
              Turn it into a look</button>}
          </div>
          {gate.kind !== 'open' && <AccessGate gate={gate} model={chosen} paidLabels={paidLabels} free={free}
            useFree={useFree} onAccess={setAccess} />}
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
  const secs = idea.status === 'ready' && idea.timing ? Math.max(1, Math.round(idea.timing.total / 1000)) : 0;
  const by = (idea.by || idea.generator) && `by ${idea.by || idea.generator}${secs ? ` in ${secs} s` : ''}`;
  return (
    <li class={`idea is-${idea.status}`}>
      {/* The rose fills while the idea is being made and is lit once it is ready. */}
      <span class="idea-pane"><Rose class={isPending(idea) ? 'idea-rose rose-fill' : 'idea-rose'} /></span>
      <div class="idea-main">
        <p class="idea-text">{idea.text}</p>
        <div class="idea-meta">
          <span class={`status status-${cls}`}><span class="status-dot" aria-hidden="true" />{label}</span>
          {by && <span class="meta-item">{by}</span>}
          {idea.explore && idea.explore !== 'quick' && <span class="meta-item">{LEVELS[idea.explore][0]}</span>}
          <time class="meta-item" dateTime={idea.createdAt || ''}>{timeAgo(idea.createdAt)}</time>
          {can(user.value, 'admin') && idea.status !== 'queued' && <a class="meta-item" target="_blank"
            rel="noopener" href={`/api/admin/ideas/${encodeURIComponent(idea.id)}/log`}>Log</a>}
          {(idea.owner === user.value?.id || can(user.value, 'admin')) && <a class="meta-item"
            href={`/ideas/${encodeURIComponent(idea.id)}/how`}>{isPending(idea) ? 'Watch it' : 'How it was made'}</a>}
        </div>
        {idea.status === 'ready' && idea.took && <p class="idea-took">Took {idea.took}</p>}
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
  const [looks, setLooks] = useState<Listed[] | null>(null), [error, setError] = useState('');
  const [q, setQ] = useState(''), [loads, setLoads] = useState(0);
  const [approvedOnly, setApprovedOnly] = useState(false);
  useEffect(() => {
    setTitle(gallery ? 'Gallery' : 'My looks');
    let alive = true;
    api.looks(gallery ? 'gallery' : 'mine').then((r) => { if (alive) setLooks(r.looks || []); }).catch((err) => {
      setError(err.message);
    });
    return () => { alive = false; };
  }, [loads]);

  async function remove(look: Listed) {
    if (await deleteLook(look)) setLooks((all) => (all || []).filter((l) => l.id !== look.id));
  }

  const words = q.trim().toLowerCase();
  const approved = (look: Listed) => setLooks((all) => (all || []).map((l) => l.id === look.id
    ? { ...l, reviewed: true } : l));
  const shown = (looks || []).filter((l) => (!gallery || !approvedOnly || l.reviewed) && (!words
    || `${l.title} ${l.summary || ''} ${l.ownerName || ''}`.toLowerCase().includes(words)));
  const empty = error ? <p class="form-error">{error}</p> : looks?.length
    ? <p>{gallery && approvedOnly ? 'No approved looks match.' : 'No looks match that search.'}</p>
    : gallery ? <p>Nothing shared yet. Open one of your looks in the Studio and switch on “Share to gallery”.</p>
    : onPi() ? <p>No saved looks yet. <a href="/studio">Start a blank look</a>, or import some.</p>
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
          {gallery && <button type="button" class={`btn ${approvedOnly ? 'primary' : 'ghost'}`}
            aria-pressed={approvedOnly} onClick={() => setApprovedOnly((on) => !on)}>Approved</button>}
          <LookFiles looks={looks} gallery={gallery} reload={() => setLoads((n) => n + 1)} />
          {!gallery && <a class="btn primary" href="/studio">New look</a>}
        </div>
      </div>
      <ul class="card-grid" aria-busy={!looks && !error}>
        {shown.map((look) => <Card key={look.id} look={look} gallery={gallery} remove={remove}
          approved={() => approved(look)} />)}</ul>
      <div class="empty" hidden={(!looks && !error) || shown.length > 0}>{empty}</div>
    </div>);
}

function Card({ look, gallery, remove, approved }: {
  look: Listed; gallery: boolean; remove: (l: Listed) => void; approved: () => void;
}) {
  const reviewed = look.reviewed;
  const n = look.layerCount ?? 0, href = studioHref(look.id);
  return (
    <li class="card">
      <div class={cx('card-art', look.preview && 'has-preview')} aria-hidden="true"
        style={{ '--art': jewelGradient(look.id + look.title) }}>
        {look.preview && <picture>
          <source media="(prefers-reduced-motion: reduce)" srcset={`${previewHref(look)}-still.webp`} />
          <img src={`${previewHref(look)}.webp`} alt="" loading="lazy" decoding="async" />
        </picture>}
      </div>
      <div class="card-body">
        <h2 class="card-title"><a href={href}>{look.title || 'Untitled look'}</a></h2>
        {look.summary && <p class="card-summary">{look.summary}</p>}
        <div class="card-meta">
          {gallery && <span class="meta-item">{`by ${look.ownerName || 'someone'}`}</span>}
          <span class="meta-item">{`${n} layer${n === 1 ? '' : 's'}`}</span>
          <time class="meta-item" dateTime={look.updatedAt || ''}>{timeAgo(look.updatedAt || look.createdAt)}</time>
          {look.shared && !gallery && <span class="tag tag-sapphire">Shared</span>}
          {reviewed && <span class="tag tag-emerald">Reviewed</span>}
        </div>
      </div>
      <div class="card-actions"><a class="btn small" href={href}>Open</a>
        {onPi() && can(user.value, 'curate') && <button class="btn small" type="button"
          onClick={() => lights().then((m) => m.openPlayLights(look))}>Play on the lights</button>}
        {gallery && !reviewed && can(user.value, 'review', look) && <Approve look={look} approved={approved} />}
        {mayDelete(user.value, look, gallery) && <button class="btn small ghost danger-text" type="button"
          aria-label={`Delete ${look.title}`} onClick={() => remove(look)}>Delete</button>}
      </div>
    </li>);
}
