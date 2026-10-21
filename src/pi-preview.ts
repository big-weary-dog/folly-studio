// /pi on Studio's own site (SPEC-offline "The Pi preview"): a Studio Live engine on this machine, at PI_PREVIEW_URL
// and started with `--base /pi` (a dry run when hosted, the real one on the Pi), passed through to signed-in admins,
// and curators too on the Pi. Dry run or not, it is a control surface.
// Using one of its controls makes it drive the live stage (SPEC-live "Following /pi"); its page is told who drives.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import WebSocket from 'ws';

import { type Auth, sessionHook } from './auth.ts';
import { HttpError } from './http.ts';
import type { Hub } from './live/hub.ts';

const BASE = '/pi', TIMEOUT_MS = 5000;
// What the Pi's answer keeps: its own CSP (the page's, in place of the app's), and what the browser needs to use it.
const KEEP = ['content-type', 'content-security-policy', 'cache-control', 'location', 'etag', 'last-modified'];
// What the page sends that changes what plays (pi/src/protocol.ts): any of these makes /pi drive the stage.
const CONTROLS = new Set(['play', 'set', 'tap', 'level', 'blackout']);
const controlOf = (text: string) => {
  try { return CONTROLS.has(JSON.parse(text)?.type); } catch { return false; }
};

/** The upstream as a base URL: http(s) on this machine, as `npm run host` starts it. */
export function previewTarget(url: string) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol) || u.pathname !== '/' || u.search) {
    throw new Error(`PI_PREVIEW_URL must be like http://127.0.0.1:4043, not ${url}`);
  }
  return u;
}

/** `curators`: curators may use it too (the Pi profile), not admins alone. */
export function piPreview({ auth, target, hub, curators = false }: { auth: Auth, target: URL,
  hub?: Pick<Hub, 'live' | 'piDrove' | 'onDriver'>, curators?: boolean }) {
  const host = (h: string) => h.toLowerCase().replace(/:(80|443)$/, '');
  // Its role only (sessionHook): no session is asked to sign in (the app's page), anyone else refused, in plain text.
  const who = curators ? 'a curator' : 'an admin';
  const SAYS: Record<number, string> = { 401: `Sign in to Studio as ${who}, then open /pi/ again.`,
    403: `The Pi page is for ${curators ? 'curators' : 'admins'}.` };
  const allowed = { config: { role: curators ? 'curator' as const : 'admin' as const } };

  return async (app: FastifyInstance) => {
    app.addHook('onRequest', sessionHook(auth));
    app.setErrorHandler((err, _req, reply) => {
      const says = err instanceof HttpError && SAYS[err.status];
      if (!says) throw err;   // the app's handler
      return reply.code((err as HttpError).status).type('text/plain').send(says);
    });
    const page = async (req: FastifyRequest, reply: FastifyReply) => {
      let res: Response;
      try {
        res = await fetch(new URL(req.url, target), { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        return reply.code(502).type('text/plain').send('The Pi preview is not running (PI_PREVIEW_URL).');
      }
      reply.code(res.status);
      for (const k of KEEP) { const v = res.headers.get(k); if (v) reply.header(k, v); }
      return reply.send(Buffer.from(await res.arrayBuffer()));
    };
    app.get(BASE, allowed, page);
    app.get(`${BASE}/*`, allowed, page);

    app.get(`${BASE}/ws`, {
      ...allowed,
      websocket: true,
      // Browsers always send Origin on a socket: it must be this site (CSRF over WebSockets), as for the live stage.
      preValidation: async (req, reply) => {
        let from = '';
        try { from = new URL(String(req.headers.origin)).host; } catch { /* missing or "null" */ }
        if (!from || host(from) !== host(req.host)) return reply.code(403).send('Cross-origin socket refused.');
      },
    }, (socket, req) => {
      // The Pi checks Origin against Host too: it gets both as the browser sent them to this site.
      const ws = `${target.protocol === 'https:' ? 'wss:' : 'ws:'}//${target.host}${BASE}/ws`;
      const up = new WebSocket(ws, { origin: String(req.headers.origin), headers: { host: req.host },
        maxPayload: 1 << 20, handshakeTimeout: TIMEOUT_MS });
      const early: string[] = [];
      const code = (c: number) => (c >= 1000 && c < 5000 && c !== 1005 && c !== 1006 ? c : 1000);
      // Text frames only, as the page sends; the Pi holds them to its own 1 KB and meters them.
      const driver = (from: 'stage' | 'pi') => {
        const msg = { type: 'driver', from: from === 'pi' ? 'pi' : 'live' };
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
      };
      const unlisten = hub?.onDriver(driver);
      socket.on('message', (d, binary) => {
        if (binary) { socket.close(1008, 'Not a message this page sends'); return; }
        const text = String(d);
        if (up.readyState === WebSocket.OPEN) up.send(text);
        else if (up.readyState === WebSocket.CONNECTING && early.length < 8) early.push(text);
        else return;
        if (hub && controlOf(text)) hub.piDrove();
      });
      up.on('open', () => { for (const m of early.splice(0)) up.send(m); });
      let told = false;     // who drives, after the Pi's first word (its hello)
      up.on('message', (d, binary) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(d, { binary });
        if (hub && !told) { told = true; driver(hub.live.driver); }
      });
      up.on('close', (c) => { if (socket.readyState < WebSocket.CLOSING) socket.close(code(c)); });
      const down = (why: string) => { if (socket.readyState < WebSocket.CLOSING) socket.close(1011, why); };
      up.on('error', () => down('The Pi preview is down'));
      up.on('unexpected-response', () => { up.terminate(); down('The Pi preview refused'); });
      socket.on('close', () => {
        unlisten?.();
        if (up.readyState === WebSocket.CONNECTING) up.terminate(); else up.close();
      });
      socket.on('error', () => socket.terminate());
    });
  };
}
