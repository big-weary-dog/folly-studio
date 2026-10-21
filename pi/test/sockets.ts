// The control server's tests share: an engine playing `fire` behind a control server (closed after each test), and
// sockets to it that keep what they get.
import { afterEach } from 'vitest';
import WebSocket from 'ws';

import type { EngineState, Mode, ToPage } from '../src/protocol.ts';
import { controlServer } from '../src/server.ts';
import { engineOn, lib } from './fixture.ts';

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await s.close(); });

/** A server on a free port (Live Play unless said), its engine playing fire. */
export async function serve(pin = '', clock = { t: 0 }, base = '', mode: Mode = 'live') {
  const r = engineOn();
  r.engine.play('fire');
  r.run(0.3);
  const state = () => ({ ...r.engine.state(), looks: [], out: {} } as unknown as EngineState);
  const s = await controlServer({ engine: r.engine, lib, state, pin, mode, port: 0, host: '127.0.0.1', base,
    now: () => clock.t });
  servers.push(s);
  return { ...r, server: s, origin: `http://127.0.0.1:${s.port}`, page: `http://127.0.0.1:${s.port}${base}`, clock };
}

/** A socket from `origin` (the page's own unless said), with every message it gets kept. */
export async function socket(url: string, origin = new URL(url).origin) {
  const ws = new WebSocket(`${url.replace('http', 'ws')}/ws`, { origin });
  const got: ToPage[] = [];
  ws.on('message', (d) => got.push(JSON.parse(String(d))));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const send = (m: object) => ws.send(JSON.stringify(m));
  /** The next message of `type`, waiting for it. */
  const next = async (type: ToPage['type'], from = got.length) => {
    for (let i = 0; i < 100; i++) {
      const m = got.slice(from).find((x) => x.type === type);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`no ${type}: ${JSON.stringify(got)}`);
  };
  return { ws, got, send, next };
}
