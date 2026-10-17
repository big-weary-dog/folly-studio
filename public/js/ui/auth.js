// Sign up / log in.
import { api } from '../api.js';
import { h, svg, nextId } from './dom.js';

export function mount(root, ctx) {
  const wantsSignup = ctx.query.get('mode') === 'signup';
  let mode = wantsSignup ? 'signup' : 'login';

  const userId = nextId('f'), passId = nextId('f'), errId = nextId('f');
  const username = h('input', { id: userId, name: 'username', autocomplete: 'username', required: true,
    autocapitalize: 'none', spellcheck: false, minlength: 2, maxlength: 40 });
  const password = h('input', { id: passId, name: 'password', type: 'password', required: true, minlength: 6 });
  const error = h('p', { id: errId, class: 'form-error', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn primary wide', type: 'submit' });
  const hint = h('p', { class: 'field-hint' });

  const tabLogin = h('button', { type: 'button', class: 'seg-btn', text: 'Log in', onClick: () => setMode('login') });
  const tabSignup = h('button', { type: 'button', class: 'seg-btn', text: 'Sign up', onClick: () => setMode('signup') });

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
    hint.textContent = m === 'signup' ? 'At least 8 characters is a good idea. Usernames are public in the gallery.' : '';
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
      const dest = next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/ideas';
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
    h('div', { class: 'auth-art', 'aria-hidden': 'true' }, roseWindow()),
    h('section', { class: 'auth-card' },
      h('h1', { class: 'auth-title' }, h('span', { class: 'kicker', text: 'The Gothic Folly' }), 'Folly Studio'),
      h('p', { class: 'auth-lede', text: 'Describe a show for 4,870 LEDs — arches, spires, a sixteen-petal rose window — watch it come to life, tune it, and send it to the playa.' }),
      form)));

  setTimeout(() => username.focus(), 0);
  return {};
}

/** A decorative sixteen-petal rose window in jewel colours. */
function roseWindow() {
  const jewels = ['#e5486b', '#5b8cff', '#f2b148', '#39c98f'];
  const g = svg('g', { transform: 'translate(200 200)' });
  g.append(svg('circle', { r: 190, fill: 'none', stroke: '#2b3658', 'stroke-width': 2 }));
  g.append(svg('circle', { r: 176, fill: 'none', stroke: '#1e2742', 'stroke-width': 1 }));
  for (let ring = 0; ring < 3; ring++) {
    const n = 16;
    const r0 = 40 + ring * 46, r1 = r0 + 40;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 + (ring % 2) * (Math.PI / n);
      const a1 = a0 + (Math.PI * 2) / n;
      const am = (a0 + a1) / 2;
      const p = (r, a) => `${(r * Math.sin(a)).toFixed(1)} ${(-r * Math.cos(a)).toFixed(1)}`;
      const d = `M${p(r0, am)} Q${p(r0 + 6, a0 + 0.02)} ${p((r0 + r1) / 2, a0 + 0.04)} Q${p(r1 - 2, a0 + 0.06)} ${p(r1, am)} Q${p(r1 - 2, a1 - 0.06)} ${p((r0 + r1) / 2, a1 - 0.04)} Q${p(r0 + 6, a1 - 0.02)} ${p(r0, am)}Z`;
      const color = jewels[(i + ring * 2) % jewels.length];
      g.append(svg('path', { d, fill: color, 'fill-opacity': 0.16 + 0.1 * ((i + ring) % 3), stroke: color, 'stroke-opacity': 0.75, 'stroke-width': 1.2, class: `petal petal-${(i + ring) % 4}` }));
    }
  }
  g.append(svg('circle', { r: 30, fill: '#f2b148', 'fill-opacity': 0.22, stroke: '#f2b148', 'stroke-width': 1.5 }));
  g.append(svg('circle', { r: 9, fill: '#ffe2a8' }));
  return svg('svg', { viewBox: '0 0 400 400', class: 'rose', focusable: 'false' }, g);
}
