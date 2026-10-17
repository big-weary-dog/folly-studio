// HTTP API client (see SPEC "HTTP API"). JSON in, JSON out, cookie session.
// Any non-2xx response throws an Error carrying the server's message and `status`.

async function request(method, path, body) {
  const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (method !== 'GET' && method !== 'HEAD') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (err) {
    const e = new Error('Could not reach the server. Check your connection and try again.');
    e.status = 0;
    e.cause = err;
    throw e;
  }
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    const msg = (data && typeof data.error === 'string' && data.error)
      || `${res.status} ${res.statusText || 'error'}`.trim();
    const e = new Error(msg);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data ?? {};
}

const enc = encodeURIComponent;

export const api = {
  me: () => request('GET', '/api/me'),
  signup: (username, password) => request('POST', '/api/signup', { username, password }),
  login: (username, password) => request('POST', '/api/login', { username, password }),
  logout: () => request('POST', '/api/logout', {}),

  ideas: () => request('GET', '/api/ideas'),
  idea: (id) => request('GET', `/api/ideas/${enc(id)}`),
  createIdea: (text) => request('POST', '/api/ideas', { text }),

  looks: (scope = 'mine') => request('GET', `/api/looks?scope=${enc(scope)}`),
  look: (id) => request('GET', `/api/looks/${enc(id)}`),
  createLook: (look) => request('POST', '/api/looks', look),
  updateLook: (id, patch) => request('PUT', `/api/looks/${enc(id)}`, patch),
  deleteLook: (id) => request('DELETE', `/api/looks/${enc(id)}`),
  bake: (id) => request('POST', `/api/looks/${enc(id)}/bake`, {}),

  library: () => request('GET', '/api/library'),
};

/** Static JSON (not under /api): the cathedral model, the library index. */
export async function fetchJSON(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.json();
}
