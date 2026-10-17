// Sign up / log in.
import { api } from '../api.js';
import { h, svg, nextId } from './dom.js';
import { rose } from './rose.js';

export function mount(root, ctx) {
  const wantsSignup = ctx.query.get('mode') === 'signup';
  let mode = wantsSignup ? 'signup' : 'login';

  const userId = nextId('f'), passId = nextId('f'), errId = nextId('f');
  const username = h('input', { id: userId, type: 'text', name: 'username', autocomplete: 'username', required: true,
    autocapitalize: 'none', spellcheck: false, minlength: 2, maxlength: 40 });
  const password = h('input', { id: passId, name: 'password', type: 'password', required: true, minlength: 6 });
  const error = h('p', { id: errId, class: 'form-error', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn primary wide', type: 'submit' });
  const hint = h('p', { class: 'field-hint' });

  const tabLogin = h('button', { type: 'button', class: 'seg-btn', text: 'Log in', onClick: () => setMode('login') });
  const tabSignup = h('button', { type: 'button', class: 'seg-btn', text: 'Sign up',
    onClick: () => setMode('signup') });

  const form = h('form', { class: 'auth-form', novalidate: true, 'aria-describedby': errId },
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Log in or sign up' }, tabLogin, tabSignup),
    h('div', { class: 'field' }, h('label', { for: userId, text: 'Username' }), username),
    h('div', { class: 'field' }, h('label', { for: passId, text: 'Password' }), password, hint),
    error,
    submit);

  function setMode(m) {
    mode = m;
    tabLogin.setAttribute('aria-pressed', String(m === 'login'));
    tabSignup.setAttribute('aria-pressed', String(m === 'signup'));
    submit.textContent = m === 'login' ? 'Log in' : 'Create account';
    password.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    hint.textContent = m === 'signup'
      ? 'At least 8 characters is a good idea. Usernames are public in the gallery.' : '';
    hint.hidden = m !== 'signup';
    error.hidden = true;
  }
  setMode(mode);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const u = username.value.trim();
    const p = password.value;
    if (!u || !p) {
      showError('Enter a username and a password.');
      (u ? password : username).focus();
      return;
    }
    submit.disabled = true;
    submit.classList.add('busy');
    try {
      const res = mode === 'login' ? await api.login(u, p) : await api.signup(u, p);
      ctx.setUser(res.user);
      const next = ctx.query.get('next');
      const safe = next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login');
      const dest = safe ? next : '/ideas';
      ctx.navigate(dest, { replace: true, force: true });
    } catch (err) {
      showError(err.message);
      password.focus();
      password.select();
    } finally {
      submit.disabled = false;
      submit.classList.remove('busy');
    }
  });

  function showError(msg) {
    error.textContent = msg;
    error.hidden = false;
  }

  root.append(h('div', { class: 'auth' },
    h('div', { class: 'auth-art' }, rose({ detail: 'full' })),
    h('section', { class: 'auth-card' },
      h('h1', { class: 'auth-title' }, h('span', { class: 'kicker', text: 'The Gothic Folly' }),
        svg('svg', { class: 'wordmark', 'aria-hidden': 'true' }, svg('use', { href: '#wordmark' })),
        h('span', { class: 'sr-only', text: 'Folly Studio' })),
      h('p', { class: 'auth-lede', text: 'Describe a show for 4,870 LEDs — arches, spires, a sixteen-petal rose '
        + 'window — watch it come to life, tune it, and send it to the playa.' }),
      form)));

  // Focus the first field with a mouse; on a phone that would throw the keyboard over the page.
  if (matchMedia('(pointer: fine)').matches) setTimeout(() => username.focus(), 0);
  return {};
}
