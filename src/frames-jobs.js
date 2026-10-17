// Heavy work at low priority, one job at a time. createLane() runs tasks in order, one at a time: the bake
// queue and the frames cache share one, so a bake and a wire encode never run together. createFrameJobs()
// hands frame encoding to one worker thread at nice 10 (src/frames-worker.js), started on demand and
// stopped when it has been idle a while.

import { Worker } from 'node:worker_threads';

export const DEFAULT_NICE = 10;

/** A queue that runs one task at a time, in order: run(fn) → fn()'s result. */
export function createLane() {
  let tail = Promise.resolve(), size = 0;
  return {
    run(fn) {
      size++;
      const p = tail.then(fn).finally(() => { size--; });
      tail = p.catch(() => {});
      return p;
    },
    /** Tasks queued or running. */
    get size() { return size; },
  };
}

/** createFrameJobs({ nice, idleMs, log }) → { run(kind, args, onProgress?) → result, close() } */
export function createFrameJobs({ nice = DEFAULT_NICE, idleMs = 30_000, log = console } = {}) {
  const lane = createLane();
  const waiting = new Map(); // job id → { resolve, reject, onProgress }
  let worker = null, seq = 0, timer = null;

  function start() {
    if (worker) return worker;
    const w = new Worker(new URL('./frames-worker.js', import.meta.url), { workerData: { nice } });
    w.unref(); // never keeps the process alive
    const fail = (err) => {
      if (worker === w) worker = null;
      for (const job of waiting.values()) job.reject(err);
      waiting.clear();
    };
    w.on('message', ({ id, progress, ok, result, error }) => {
      const job = waiting.get(id);
      if (!job) return;
      if (progress) return job.onProgress?.(progress);
      waiting.delete(id);
      if (ok) job.resolve(result);
      else job.reject(new Error(error));
    });
    w.on('error', (err) => {
      log.error?.('[frames] the encoder thread failed:', err);
      fail(err);
    });
    w.on('exit', (code) => fail(new Error(`the encoder thread stopped (exit ${code})`)));
    return (worker = w);
  }

  function stop() {
    clearTimeout(timer);
    const w = worker;
    worker = null;
    return w ? w.terminate().then(() => {}, () => {}) : Promise.resolve();
  }

  function run(kind, args, onProgress) {
    clearTimeout(timer);
    return lane.run(() => new Promise((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve, reject, onProgress });
      start().postMessage({ id, kind, args });
    })).finally(() => {
      if (!lane.size) (timer = setTimeout(stop, idleMs)).unref();
    });
  }

  return { run, close: stop };
}
