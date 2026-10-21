// The page's socket to the Pi (`path`, beside the page unless said): it reconnects on its own (backing off to 5 s,
// counting the tries and when the next is), says hello with the PIN it was given (kept for this tab), learns who this
// page is from the answer, and holds the latest state and when it came, so the beat can run on between states.
import { signal } from '@preact/signals';

import type { FromPage, PiState, ToPage } from '../src/protocol.ts';
export type { FromPage, PiState, ToPage };

const PIN_KEY = 'studio-pi-pin';
const stored = () => { try { return sessionStorage.getItem(PIN_KEY) ?? ''; } catch { return ''; } };
const store = (pin: string) => { try { sessionStorage.setItem(PIN_KEY, pin); } catch { /* private mode */ } };

export function piSocket(path = 'ws') {
  const status = signal<'connecting' | 'open' | 'closed'>('connecting');
  const state = signal<PiState | null>(null), at = signal(0);
  const needPin = signal(false), error = signal('');
  const you = signal<{ name: string, drive: boolean } | null>(null);
  const driver = signal<'pi' | 'live' | null>(null);   // behind Studio's proxy: who drives its Live tab
  // While the link is down: the tries since it was last up, and when (performance.now()) the next one goes.
  const tries = signal(0), nextTry = signal(0);
  let ws: WebSocket | null = null, wait = 500, pin = stored(), closed = false, timer = 0;

  const send = (m: FromPage) => {
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(m));
    return true;
  };
  function open() {
    timer = 0;
    status.value = 'connecting';
    // Beside the page, wherever it is served (/ws, or /pi/ws behind Studio's proxy), or Studio's /live's /pi/ws.
    const url = new URL(path, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const s = ws = new WebSocket(url);
    s.onopen = () => {
      wait = 500;
      tries.value = 0;
      status.value = 'open';
      send({ type: 'hello', ...(pin ? { pin } : {}) });
    };
    s.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as ToPage;
      if (m.type === 'hello') {
        needPin.value = !m.ok;
        you.value = m.you ?? null;
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
    s.onclose = () => {
      if (ws !== s) return;
      status.value = 'closed';
      if (closed) return;
      tries.value++;
      nextTry.value = performance.now() + wait;
      timer = window.setTimeout(open, wait);
      wait = Math.min(5000, wait * 2);
    };
  }
  open();
  return {
    status, state, at, needPin, error, you, driver, tries, nextTry, send,
    unlock(p: string) { pin = p; store(p); error.value = ''; send({ type: 'hello', pin: p }); },
    /** Try now, rather than at the next try. */
    retry() {
      if (status.value !== 'closed' || closed) return;
      clearTimeout(timer);
      open();
    },
    close() { closed = true; clearTimeout(timer); ws?.close(); },
  };
}
export type PiSocket = ReturnType<typeof piSocket>;
