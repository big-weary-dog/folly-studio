// Server clocks. The host's wall clock can step (WSL2 resyncs it back by ~0.7 s every ~30 s), so durations use the
// monotonic clock, and the time the Live hub hands clients is the wall clock read once at boot plus monotonic time.
import { performance } from 'node:perf_hooks';

/** Whole milliseconds on a clock that never steps: for durations only. */
export const monoNow = () => Math.round(performance.now());

const anchor = Date.now() - performance.now();

/** Epoch milliseconds that move steadily from the wall clock at boot: what Live clients sync to. */
export const serverNow = () => Math.round(anchor + performance.now());
