// The relay's culprit finder (SPEC "Sandbox protocol"): after an unexplained hang, each suspect layer runs alone for
// one frame in a throwaway worker. Every probe worker it starts is ended by `close`, and a closed prober starts none.

const PROBE_MS = 600;           // one layer alone: compile + one frame, once its scene is ready
const PROBE_START_MS = 5000;    // a probe worker that cannot even start is inconclusive
const PROBE_PARALLEL = 4;

type Verdict = 'hung' | 'ok' | 'unknown';
/** What a probe worker is told before its frame: the init and look messages, the layer given. */
type Setup<L> = (layer: L) => [object, object];

export function openProber(spawn: (name: string) => Worker) {
  const live = new Map<Worker, (v: Verdict) => void>();
  let closed = false;

  function probe<L>(layer: L, t: number, setup: Setup<L>) {
    return new Promise<Verdict>((resolve) => {
      let w: Worker;
      try { w = spawn('folly-probe'); } catch { resolve('unknown'); return; }
      let started = false;
      let timeout = setTimeout(() => done('unknown'), PROBE_START_MS);
      function done(result: Verdict) {
        clearTimeout(timeout);
        w.terminate();
        live.delete(w);
        resolve(result);
      }
      live.set(w, done);
      w.onerror = (e) => { e.preventDefault(); };
      w.onmessage = (e) => {
        const m = e.data || {};
        if (!started && m.type === 'ready') {
          started = true;
          clearTimeout(timeout);
          timeout = setTimeout(() => done('hung'), PROBE_MS);
        } else if (started && m.type === 'frame' && m.seq === -1) done('ok');
        else if (m.type === 'error') done('ok');          // an error is not a hang
      };
      for (const msg of setup(layer)) w.postMessage(msg);
      w.postMessage({ type: 'frame', seq: -1, t });
    });
  }

  return {
    /** Run each suspect alone for one frame at time t; resolve with the ones that hang. */
    async probeAll<L>(layers: L[], t: number, setup: Setup<L>) {
      const out: L[] = [];
      for (let i = 0; i < layers.length; i += PROBE_PARALLEL) {
        if (closed) break;
        const batch = layers.slice(i, i + PROBE_PARALLEL);
        const results = await Promise.all(batch.map((l) => probe(l, t, setup)));
        batch.forEach((l, n) => { if (results[n] === 'hung') out.push(l); });
      }
      return out;
    },
    close() {
      closed = true;
      for (const done of live.values()) done('unknown');
    },
  };
}
