// The stats line `npm run pi` prints every few seconds (each one in a dry run, a minute apart live).
import type { Engine } from './engine.ts';
import type { Output } from './output.ts';

const f1 = (n: number) => n.toFixed(1);

/** The line; `cut` the frames the compressor cut since the last one. */
export function statsLine(engine: Engine, out: ReturnType<Output['status']>, fps: number, cut: number) {
  const s = engine.stats, st = engine.state();
  const parts = [
    `${st.look?.id ?? '-'} t ${f1(st.look?.t ?? 0)}s`,
    `${f1(fps)} fps, render ${f1(s.renderMs)} ms (worst ${f1(s.worstMs)}), late ${s.late}`,
    `gen ${out.genW.toFixed(0)} W (peak ${out.genPeakW.toFixed(0)}), cut ${cut} frames`,
    `level ${st.level}${st.blackout.on ? ' BLACKOUT' : ''}${st.tripped ? ` FLASH-TRIPPED (${st.tripped.look})` : ''}`,
  ];
  if (out.errors) parts.push(`DDP errors ${out.errors}: ${out.lastError}`);
  if (s.layerErrors) parts.push(`layer errors ${s.layerErrors}: ${s.lastError}`);
  return parts.join(' | ');
}
