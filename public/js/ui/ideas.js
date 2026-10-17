// Ideas: describe a show, watch it turn into a look, open it in the Studio.
import { api } from '../api.js';
import { busy, clear, h, label, stylesheet, timeAgo, toast } from './dom.js';
import { rose } from './rose.js';

await stylesheet('/css/ideas.css');

const EXAMPLES = ['Rising embers drift up the spires', 'A coral reef breathing in slow blues and pinks',
  'Lightning cracks across the arches in a storm', 'The rose window blooms like a sunrise',
  'A heartbeat at 120 bpm pulsing through the nave', 'Aurora curtains sweep over the canopy'];
const STATUS = { queued: { label: 'Queued', cls: 'pending' }, generating: { label: 'Generating', cls: 'pending' },
  ready: { label: 'Ready', cls: 'ok' }, failed: { label: 'Failed', cls: 'bad' } };

const MAX_LEN = 2000;

export function mount(root, ctx) {
  ctx.setTitle('Ideas');
  let ideas = [], pollTimer = null, alive = true;
  const known = new Map();      // id → status, to notice when one becomes ready

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
        + 'cathedral. It becomes pattern code you can preview, tweak and export.' }),
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
    showError('');
    if (!text) {
      showError('Describe your idea first.');
      textarea.focus();
      return;
    }
    busy(submit, true);
    try {
      const { idea } = await api.createIdea(text);
      textarea.value = '';
      updateCount();
      ideas = [idea, ...ideas.filter((i) => i.id !== idea.id)];
      known.set(idea.id, idea.status);
      draw();
      schedulePoll();
    } catch (err) {
      if (err.status === 401) return ctx.signedOut();
      showError(err.message);
    } finally {
      busy(submit, false);
    }
  });

  function draw() {
    clear(list);
    list.setAttribute('aria-busy', 'false');
    empty.hidden = ideas.length > 0;
    for (const idea of ideas) list.append(ideaItem(idea));
  }

  function ideaItem(idea) {
    const st = STATUS[idea.status] || { label: idea.status, cls: 'pending' };
    const actions = h('div', { class: 'idea-actions' });
    if (idea.status === 'ready' && idea.lookId) {
      actions.append(h('a', { class: 'btn primary small', href: `/studio/${encodeURIComponent(idea.lookId)}`,
        text: 'Open in Studio' }));
    } else if (idea.status === 'failed') {
      actions.append(h('button', { class: 'btn ghost small', type: 'button', text: 'Try again',
        onClick: () => { prefill(idea.text); window.scrollTo({ top: 0 }); } }));
    }
    // The rose fills while the idea is being made and is lit once it is ready.
    const making = idea.status === 'queued' || idea.status === 'generating';
    return h('li', { class: ['idea', `is-${idea.status}`] },
      h('span', { class: 'idea-pane' }, rose({ className: making ? 'idea-rose rose-fill' : 'idea-rose' })),
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

  async function load() {
    try {
      const res = await api.ideas();
      if (!alive) return;
      ideas = Array.isArray(res.ideas) ? res.ideas : [];
      for (const idea of ideas) {
        const before = known.get(idea.id);
        if (before && before !== 'ready' && idea.status === 'ready' && idea.lookId) {
          toast('Your look is ready.', { kind: 'ok', timeout: 8000,
            action: { label: 'Open', onClick: () => ctx.navigate(`/studio/${encodeURIComponent(idea.lookId)}`) } });
        } else if (before && before !== 'failed' && idea.status === 'failed') {
          toast(`An idea could not be generated${idea.error ? `: ${idea.error}` : '.'}`, { kind: 'error' });
        }
        known.set(idea.id, idea.status);
      }
      draw();
    } catch (err) {
      if (err.status === 401) return ctx.signedOut();
      if (!alive) return;
      list.setAttribute('aria-busy', 'false');
      toast(err.message, { kind: 'error' });
    }
    schedulePoll();
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = null;
    if (!alive) return;
    if (ideas.some((i) => i.status === 'queued' || i.status === 'generating')) {
      pollTimer = setTimeout(load, 2000);
    }
  }

  load();
  if (matchMedia('(pointer: fine)').matches) {
    setTimeout(() => {
      if (alive && document.activeElement === document.body) textarea.focus({ preventScroll: true });
    }, 0);
  }

  return { unmount() { alive = false; clearTimeout(pollTimer); } };
}
