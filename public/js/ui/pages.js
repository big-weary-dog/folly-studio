// The list pages. Ideas: describe a show, watch it turn into a look, open it in the Studio. My looks and the
// Gallery: cards that open in the Studio (lists carry metadata only; the Studio fetches a look).
import { api } from '../api.js';
import '../../css/pages.css';
import { busy, confirmDialog, h, jewelGradient, label, rose, timeAgo, toast } from './dom.js';

/** The route's page: My looks or the Gallery when it names a scope, else Ideas. */
export const mount = (root, ctx) => (ctx.args.scope ? looksPage(root, ctx) : ideasPage(root, ctx));

const EXAMPLES = ['Rising embers drift up the spires', 'A coral reef breathing in slow blues and pinks',
  'Lightning cracks across the arches in a storm', 'The rose window blooms like a sunrise',
  'A heartbeat at 120 bpm pulsing through the nave', 'Aurora curtains sweep over the canopy'];
const STATUS = { queued: { label: 'Queued', cls: 'pending' }, generating: { label: 'Generating', cls: 'pending' },
  ready: { label: 'Ready', cls: 'ok' }, failed: { label: 'Failed', cls: 'bad' } };

const MAX_LEN = 2000;
// While an idea is being made, its status is asked for after 2 s, then 1.5× as long each time, up to 10 s.
const POLL_FIRST_MS = 2000;
const POLL_MAX_MS = 10_000;
const isPending = (i) => i.status === 'queued' || i.status === 'generating';

function ideasPage(root, ctx) {
  ctx.setTitle('Ideas');
  let ideas = [], pollTimer = null, pollMs = POLL_FIRST_MS, polling = false, alive = true;
  const known = new Map();      // id → status, to notice when one becomes ready
  const ready = new Map();      // look id → close() of its "ready" toast, closed once that look is opened

  const textarea = h('textarea', { class: 'idea-input', rows: 4, maxlength: MAX_LEN,
    placeholder: 'A coral reef breathing in slow blues, with fish darting up the spires…' });
  const counter = h('span', { class: 'char-count', 'aria-live': 'off', text: `0 / ${MAX_LEN}` });
  const submit = h('button', { class: 'btn primary', type: 'submit', text: 'Turn it into a look' });
  const formError = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const prefill = (text) => { textarea.value = text; updateCount(); textarea.focus(); };
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Example ideas' },
    EXAMPLES.map((ex) => h('button', { type: 'button', class: 'chip', text: ex, onClick: () => prefill(ex) })));
  const form = h('form', { class: 'idea-form' },
    label(textarea, 'Describe a show idea', 'sr-only'), textarea,
    h('div', { class: 'chips-row' }, h('span', { class: 'chips-label', text: 'Try:' }), chips), formError,
    h('div', { class: 'idea-form-actions' }, counter, h('span', { class: 'kbd-hint', text: 'Ctrl + Enter' }), submit));

  const list = h('ul', { class: 'idea-list', 'aria-live': 'polite', 'aria-busy': 'true' });
  const empty = h('div', { class: 'empty', hidden: true },
    h('p', { text: 'No ideas yet. Describe one above — or ' },
      h('a', { href: '/studio', text: 'start from a blank Studio' }), '.'));

  root.append(h('div', { class: 'page ideas-page' },
    h('section', { class: 'compose' },
      h('h1', { class: 'page-title', text: 'Describe a show idea' }),
      h('p', { class: 'lede', text: 'A sentence or two is plenty: colours, motion, mood, which parts of the '
        + 'installation. It becomes pattern code you can preview, tweak and export.' }),
      form),
    h('section', { class: 'ideas-section', 'aria-labelledby': 'my-ideas-h' },
      h('div', { class: 'section-head' },
        h('h2', { id: 'my-ideas-h', text: 'My ideas' }),
        h('a', { class: 'btn ghost small', href: '/studio', text: 'Blank Studio' })),
      list, empty)));

  function updateCount() { counter.textContent = `${textarea.value.length} / ${MAX_LEN}`; }
  textarea.addEventListener('input', updateCount);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    const showError = (msg) => { formError.textContent = msg; formError.hidden = !msg; };
    showError(text ? '' : 'Describe your idea first.');
    if (!text) return textarea.focus();
    busy(submit, true);
    try {
      const { idea } = await api.createIdea(text);
      textarea.value = '';
      updateCount();
      ideas = [idea, ...ideas.filter((i) => i.id !== idea.id)];
      known.set(idea.id, idea.status);
      draw();
      pollMs = POLL_FIRST_MS;
      schedulePoll();
    } catch (err) {
      if (err.status === 401) return ctx.signedOut();
      showError(err.message);
    } finally {
      busy(submit, false);
    }
  });

  function draw() {
    list.replaceChildren(...ideas.map(ideaItem));
    list.setAttribute('aria-busy', 'false');
    empty.hidden = ideas.length > 0;
  }

  function ideaItem(idea) {
    const st = STATUS[idea.status] || { label: idea.status, cls: 'pending' };
    const open = `/studio/${encodeURIComponent(idea.lookId)}`;
    const actions = h('div', { class: 'idea-actions' }, idea.status === 'ready' && idea.lookId
      ? h('a', { class: 'btn primary small', href: open, text: 'Open in Studio' })
      : idea.status === 'failed' ? h('button', { class: 'btn ghost small', type: 'button', text: 'Try again',
        onClick: () => { prefill(idea.text); window.scrollTo({ top: 0 }); } }) : null);
    // The rose fills while the idea is being made and is lit once it is ready.
    return h('li', { class: ['idea', `is-${idea.status}`] },
      h('span', { class: 'idea-pane' }, rose({ className: isPending(idea) ? 'idea-rose rose-fill' : 'idea-rose' })),
      h('div', { class: 'idea-main' },
        h('p', { class: 'idea-text', text: idea.text }),
        h('div', { class: 'idea-meta' },
          h('span', { class: ['status', `status-${st.cls}`] },
            h('span', { class: 'status-dot', 'aria-hidden': 'true' }), st.label),
          idea.generator ? h('span', { class: 'meta-item', text: idea.generator }) : null,
          h('time', { class: 'meta-item', datetime: idea.createdAt || '', text: timeAgo(idea.createdAt) })),
        idea.status === 'failed' && idea.error ? h('p', { class: 'idea-error', text: idea.error }) : null),
      actions);
  }

  /** Toasts for ideas that just became ready or failed; remembers each status. */
  function notice(list) {
    for (const idea of list) {
      const before = known.get(idea.id);
      if (before && before !== 'ready' && idea.status === 'ready' && idea.lookId) {
        ready.set(idea.lookId, toast('Your look is ready.', { kind: 'ok', timeout: 8000,
          action: { label: 'Open', onClick: () => ctx.navigate(`/studio/${encodeURIComponent(idea.lookId)}`) } }));
      } else if (before && before !== 'failed' && idea.status === 'failed') {
        toast(`An idea could not be generated${idea.error ? `: ${idea.error}` : '.'}`, { kind: 'error' });
      }
      known.set(idea.id, idea.status);
    }
  }

  async function load() {
    try {
      const res = await api.ideas();
      if (!alive) return;
      ideas = res.ideas || [];
      notice(ideas);
      draw();
    } catch (err) {
      if (err.status === 401) return ctx.signedOut();
      if (!alive) return;
      list.setAttribute('aria-busy', 'false');
      toast(err.message, { kind: 'error' });
    }
    schedulePoll();
  }

  // Only the pending ideas are asked about (an unchanged one answers 304, no body), never while hidden.
  async function poll() {
    pollTimer = null;
    if (!alive || document.hidden || polling) return;
    polling = true;
    const asked = ideas.filter(isPending);
    try {
      const fresh = (await Promise.all(asked.map((i) => api.idea(i.id)))).map((r) => r.idea);
      if (!alive) return;
      const byId = new Map(fresh.filter(Boolean).map((i) => [i.id, i]));
      const changed = asked.some((i) => byId.get(i.id)?.updatedAt !== i.updatedAt);
      ideas = ideas.map((i) => byId.get(i.id) ?? i);
      notice(fresh.filter(Boolean));
      if (changed) draw();
    } catch (err) {
      if (err.status === 401) return ctx.signedOut();
      if (err.status === 404) return load(); // gone: the list says what is left
    } finally {
      polling = false;
    }
    pollMs = Math.min(POLL_MAX_MS, pollMs * 1.5);
    schedulePoll();
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = null;
    if (alive && !document.hidden && ideas.some(isPending)) pollTimer = setTimeout(poll, pollMs);
  }
  // Back on the tab: ask at once, then carry on backing off.
  const onVisibility = () => { if (!document.hidden && !pollTimer && ideas.some(isPending)) poll(); };
  document.addEventListener('visibilitychange', onVisibility);

  load();
  if (matchMedia('(pointer: fine)').matches) {
    setTimeout(() => {
      if (alive && document.activeElement === document.body) textarea.focus({ preventScroll: true });
    }, 0);
  }

  return {
    unmount() {
      alive = false;
      clearTimeout(pollTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      const opened = /^\/studio\/([^/]+)/.exec(location.pathname);
      if (opened) ready.get(decodeURIComponent(opened[1]))?.();
    },
  };
}

function looksPage(root, ctx) {
  const scope = ctx.args.scope === 'gallery' ? 'gallery' : 'mine';
  const isGallery = scope === 'gallery';
  ctx.setTitle(isGallery ? 'Gallery' : 'My looks');
  let alive = true, looks = [];
  const grid = h('ul', { class: 'card-grid', 'aria-busy': 'true' });
  const empty = h('div', { class: 'empty', hidden: true });
  const filter = h('input', { type: 'search', class: 'search', 'aria-label': 'Search looks',
    placeholder: isGallery ? 'Search the gallery' : 'Search my looks' });

  root.append(h('div', { class: 'page looks-page' },
    h('div', { class: 'section-head page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: isGallery ? 'Gallery' : 'My looks' }),
        h('p', { class: 'lede', text: isGallery
          ? 'Looks people have shared. Open one to watch it; edit it and Save makes it your own copy.'
          : 'Everything you have saved. Share one to put it in the gallery.' })),
      h('div', { class: 'head-actions' }, filter,
        isGallery ? null : h('a', { class: 'btn primary', href: '/studio', text: 'New look' }))),
    grid, empty));

  filter.addEventListener('input', draw);

  function draw() {
    const q = filter.value.trim().toLowerCase();
    const shown = looks.filter((l) => !q
      || `${l.title} ${l.summary || ''} ${l.ownerName || ''}`.toLowerCase().includes(q));
    grid.replaceChildren(...shown.map(card));
    grid.setAttribute('aria-busy', 'false');
    empty.replaceChildren(looks.length ? h('p', { text: 'No looks match that search.' }) : isGallery
      ? h('p', { text: 'Nothing shared yet. Open one of your looks in the Studio and switch on “Share to '
        + 'gallery”.' })
      : h('p', {}, 'No saved looks yet. ', h('a', { href: '/ideas', text: 'Describe an idea' }), ' or ',
        h('a', { href: '/studio', text: 'start a blank look' }), '.'));
    empty.hidden = shown.length > 0;
  }

  function card(look) {
    const layers = look.layerCount ?? 0;
    const mine = ctx.user && look.owner === ctx.user.id;
    const href = `/studio/${encodeURIComponent(look.id)}`;
    const actions = h('div', { class: 'card-actions' }, h('a', { class: 'btn small', href, text: 'Open' }),
      mine && !isGallery ? h('button', { class: 'btn small ghost danger-text', type: 'button', text: 'Delete',
        'aria-label': `Delete ${look.title}`, onClick: () => remove(look) }) : null);
    return h('li', { class: 'card' },
      h('div', { class: 'card-art', 'aria-hidden': 'true', style: { '--art': jewelGradient(look.id + look.title) } }),
      h('div', { class: 'card-body' },
        h('h2', { class: 'card-title' }, h('a', { href, text: look.title || 'Untitled look' })),
        look.summary ? h('p', { class: 'card-summary', text: look.summary }) : null,
        h('div', { class: 'card-meta' },
          isGallery ? h('span', { class: 'meta-item', text: `by ${look.ownerName || 'someone'}` }) : null,
          h('span', { class: 'meta-item', text: `${layers} layer${layers === 1 ? '' : 's'}` }),
          h('time', { class: 'meta-item', datetime: look.updatedAt || '',
            text: timeAgo(look.updatedAt || look.createdAt) }),
          look.shared && !isGallery ? h('span', { class: 'tag tag-sapphire', text: 'Shared' }) : null,
          look.reviewed ? h('span', { class: 'tag tag-emerald', text: 'Reviewed' }) : null)),
      actions);
  }

  async function remove(look) {
    const ok = await confirmDialog(`Delete “${look.title}”? This cannot be undone.`,
      { title: 'Delete look', ok: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.deleteLook(look.id);
      looks = looks.filter((l) => l.id !== look.id);
      draw();
      toast('Look deleted.');
    } catch (err) {
      if (err.status === 401) return ctx.signedOut();
      toast(err.message, { kind: 'error' });
    }
  }

  api.looks(scope).then((res) => {        // newest first: by when saved (mine) or shared (the gallery)
    if (!alive) return;
    looks = res.looks || [];
    draw();
  }).catch((err) => {
    if (err.status === 401) return ctx.signedOut();
    grid.setAttribute('aria-busy', 'false');
    empty.replaceChildren(h('p', { class: 'form-error', text: err.message }));
    empty.hidden = false;
  });

  return { unmount() { alive = false; } };
}
