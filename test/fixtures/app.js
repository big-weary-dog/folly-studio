// The server under test: createServer() on port 0 with a quiet log and cheap passwords, a cookie-keeping JSON client,
// and a signed-up account's client.
import assert from 'node:assert/strict';

import { createServer } from '../../src/app.ts';
import { quiet } from './quiet.js';

/** Passwords at a test's cost: at OWASP's, each hash takes half a second (test/auth.test.ts holds the real one). */
export const CHEAP_SCRYPT = Object.freeze({ N: 1024, r: 8, p: 1 });

/** createServer(opts) listening on 127.0.0.1, its origin `app.base` and port `app.port`. */
export async function serve(opts = {}) {
  const app = await createServer({ log: quiet, scrypt: CHEAP_SCRYPT, ...opts });
  const { port } = await app.listen(0, '127.0.0.1');
  return Object.assign(app, { base: `http://127.0.0.1:${port}`, port });
}

/** A tiny cookie-keeping JSON client. */
export function client(app) {
  let cookie = '';
  async function req(method, p, body, headers = {}) {
    const h = { ...headers };
    if (cookie && !('cookie' in h)) h.cookie = cookie;
    if (method !== 'GET' && !('content-type' in h)) h['content-type'] = 'application/json';
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const res = await fetch(app.base + p, { method, headers: h, body: payload });
    const setCookie = res.headers.getSetCookie();
    for (const c of setCookie) {
      const m = /^studio_session=([^;]*)/.exec(c);
      if (m) cookie = m[1] ? `studio_session=${m[1]}` : '';
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, headers: res.headers, json, text, setCookie };
  }
  return {
    req,
    get: (p, h) => req('GET', p, undefined, h),
    post: (p, b, h) => req('POST', p, b ?? {}, h),
    put: (p, b, h) => req('PUT', p, b, h),
    del: (p, b, h) => req('DELETE', p, b, h),
    get cookie() {
      return cookie;
    },
    set cookie(v) {
      cookie = v;
    },
  };
}

/** A new account's client, signed in: its `user`, and its `cookie` (`studio_session=…`) for raw requests. */
export async function signup(app, username, password = 'correct horse') {
  const c = client(app);
  const r = await c.post('/api/signup', { username, password });
  assert.equal(r.status, 201, `signup ${username}: ${r.text}`);
  c.user = r.json.user;
  return c;
}
