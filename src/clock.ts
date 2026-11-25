// Server clocks. The host's wall clock can step (WSL2 resyncs it back by ~0.7 s every ~30 s), so durations use the
// monotonic clock and stored times never go back.
import { performance } from 'node:perf_hooks';

/** Whole milliseconds on a clock that never steps: for durations only. */
export const monoNow = () => Math.round(performance.now());

let lastStamp = 0;

/** Now as an ISO time on the wall clock, always after the last one handed out: what stored times sort by. */
export const stamp = () => new Date(lastStamp = Math.max(Date.now(), lastStamp + 1)).toISOString();
