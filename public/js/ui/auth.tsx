// Sign up / log in.
import { useEffect, useId, useRef, useState } from 'preact/hooks';

import ACCOUNT from '../../data/account.json' with { type: 'json' };
import { api } from '../api.ts';
import { pendingInvite, redeemInvite } from './invite.ts';
import { navigate, user, type ViewProps } from './session.ts';
import { cx, Field } from './kit.tsx';
import { Rose } from './rose.tsx';

export function Auth({ query }: ViewProps) {
  const invited = !!pendingInvite();
  const [mode, setMode] = useState(query.get('mode') === 'signup' || invited ? 'signup' : 'login');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const name = useRef<HTMLInputElement>(null), pass = useRef<HTMLInputElement>(null), errId = useId();
  const signup = mode === 'signup';
  // Focus the first field with a mouse; on a phone that would throw the keyboard over the page.
  useEffect(() => { if (matchMedia('(pointer: fine)').matches) name.current?.focus(); }, []);

  async function submit(e: Event) {
    e.preventDefault();
    setError('');
    const u = name.current?.value.trim() || '', p = pass.current?.value || '';
    if (!u || !p) {
      setError('Enter a username and a password.');
      return (u ? pass : name).current?.focus();
    }
    setBusy(true);
    try {
      user.value = (signup ? await api.signup(u, p) : await api.login(u, p)).user;
      await redeemInvite();
      // Back through the router, which sends a signed-in visitor on to a safe `next`.
      navigate(location.pathname + location.search, { replace: true, force: true });
    } catch (err) {
      setError((err as Error).message);
      pass.current?.focus();
      pass.current?.select();
    } finally {
      setBusy(false);
    }
  }

  const tab = (m: string, text: string) => <button type="button" class="seg-btn" aria-pressed={mode === m}
    onClick={() => { setMode(m); setError(''); }}>{text}</button>;
  return (
    <div class="auth">
      <div class="auth-art"><Rose detail="full" /></div>
      <section class="auth-card">
        <h1 class="auth-title"><span class="kicker">The Gothic Folly</span>
          <svg class="wordmark" aria-hidden="true"><use href="#wordmark" /></svg>
          <span class="sr-only">Folly Studio</span></h1>
        <p class="auth-lede">Describe a show for 4,870 LEDs — arches, spires, a sixteen-petal rose window — watch it
          come to life, tune it, and send it to the playa.</p>
        {invited && <p class="auth-invited" role="status"><strong>You've been invited.</strong> Sign up, or log in if
          you have an account, and your invite to the AI models is accepted.</p>}
        <form class="auth-form" novalidate aria-describedby={errId} onSubmit={submit}>
          <div class="seg" role="group" aria-label="Log in or sign up">
            {tab('login', 'Log in')}{tab('signup', 'Sign up')}</div>
          <Field label="Username" stack>{(id) => <input id={id} ref={name} type="text" name="username"
            autocomplete="username" required autocapitalize="none" spellcheck={false}
            minlength={ACCOUNT.usernameMin} maxlength={ACCOUNT.usernameMax} />}
          </Field>
          <Field label="Password" stack hint={signup && <p class="field-hint">
            At least {ACCOUNT.passwordMin} characters. Usernames are public in the gallery.</p>}>
            {(id) => <input id={id} ref={pass} name="password" type="password" required
              minlength={signup ? ACCOUNT.passwordMin : undefined}
              autocomplete={signup ? 'new-password' : 'current-password'} />}</Field>
          <p id={errId} class="form-error" role="alert" hidden={!error}>{error}</p>
          <button class={cx('btn primary wide', busy && 'busy')} type="submit" disabled={busy}>
            {signup ? 'Create account' : 'Log in'}</button>
        </form>
      </section>
    </div>);
}
