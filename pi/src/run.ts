// A drift-free frame timer: frame n is due at start + n / fps, whatever the last one cost. Behind by more than a frame,
// the engine skips the show time it missed rather than playing slow. While `idle()` it renders nothing, looking again
// every IDLE_MS, and picks up where it stopped.
type Ticks = { tick(): void, skip(k: number): void };
const IDLE_MS = 250;

export function runLoop(engine: Ticks, fps: number, now = () => performance.now(), idle = () => false) {
  const period = 1000 / fps;
  let start = now(), n = 0, timer: ReturnType<typeof setTimeout> | undefined, stopped = false;
  const recent: number[] = [];
  function loop() {
    if (stopped) return;
    if (idle()) {
      recent.length = 0;
      start = now() + IDLE_MS;
      n = 0;
      timer = setTimeout(loop, IDLE_MS);
      return;
    }
    const behind = Math.floor((now() - start) / period) - n;
    if (behind > 1) { engine.skip(behind - 1); n += behind - 1; }
    engine.tick();
    recent.push(now());
    if (recent.length > fps) recent.shift();
    n++;
    timer = setTimeout(loop, Math.max(0, start + n * period - now()));
  }
  loop();
  return {
    stop() { stopped = true; clearTimeout(timer); },
    /** Frames a second over the last second's frames. */
    fps: () => (recent.length > 1 ? (recent.length - 1) * 1000 / (recent[recent.length - 1]! - recent[0]!) : 0),
  };
}
