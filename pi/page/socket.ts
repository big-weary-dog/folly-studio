// The page's socket to the Pi: it reconnects on its own (backing off to 5 s), says hello with the PIN it was given
// (kept for this tab), and holds the latest state and when it came, so the beat can run on between states.
import { signal } from '@preact/signals';

import type { FromPage, PiState, ToPage } from '../src/protocol.ts';

const PIN_KEY = 'studio-pi-pin';
const stored = () => { try { return sessionStorage.getItem(PIN_KEY) ?? ''; } catch { return ''; } };
const store = (pin: string) => { try { sessionStorage.setItem(PIN_KEY, pin); } catch { /* private mode */ } };

export function piSocket() {
  const status = signal<'connecting' | 'open' | 'closed'>('connecting');
  const state = signal<PiState | null>(null), at = signal(0);
  const needPin = signal(false), error = signal('');
  const driver = signal<'pi' | 'live' | null>(null);   // behind Studio's proxy: who drives its Live tab
  let ws: WebSocket | null = null, wait = 500, pin = stored(), closed = false;

  const send = (m: FromPage) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
  function open() {
    status.value = 'connecting';
    // Beside the page, wherever it is served (/ws, or /pi/ws behind Studio's proxy).
    const url = new URL('ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(url);
    ws.onopen = () => { wait = 500; status.value = 'open'; send({ type: 'hello', ...(pin ? { pin } : {}) }); };
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as ToPage;
      if (m.type === 'hello') {
        needPin.value = !m.ok;
        if (m.error) error.value = m.error;
        if (!m.ok) { pin = ''; store(''); }
      } else if (m.type === 'state') {
        state.value = m.state;
        at.value = performance.now();
      } else if (m.type === 'driver') {
        driver.value = m.from;
      } else if (m.type === 'error') {
        error.value = m.error;
      }
    };
    ws.onclose = () => {
      status.value = 'closed';
      if (closed) return;
      setTimeout(open, wait);
      wait = Math.min(5000, wait * 2);
    };
  }
  open();
  return {
    status, state, at, needPin, error, driver, send,
    unlock(p: string) { pin = p; store(p); error.value = ''; send({ type: 'hello', pin: p }); },
    close() { closed = true; ws?.close(); },
  };
}
export type PiSocket = ReturnType<typeof piSocket>;
