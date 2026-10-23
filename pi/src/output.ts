// The rig's channels, as the LEDs get them (the engine's output transform), to the lights: the rose expanded, the
// power compressor (pi/src/power.ts), then DDP to fppd, or, in a dry run, nothing sent and the numbers kept for the
// stats line.
import { ddpSender } from './ddp.ts';
import { expandRose, type PowerOptions, type PowerTable, powerLimiter } from './power.ts';

type OutputOptions = { table: PowerTable, power: PowerOptions, dryRun: boolean, host: string, port: number };

export function createOutput(o: OutputOptions) {
  const frame = new Uint8Array(o.table.channels), limiter = powerLimiter(o.table, o.power);
  const ddp = o.dryRun ? null : ddpSender({ host: o.host, port: o.port, channels: o.table.channels });
  let cut = 0;
  return {
    channels: o.table.channels,
    ready: ddp ? ddp.ready : Promise.resolve(),
    send(cells: Uint8Array) {
      expandRose(o.table, cells, frame);
      if (limiter.apply(frame)) cut++;
      ddp?.send(frame);
    },
    /** Frames the compressor has cut, the generator's watts now and at peak, DDP's frames and errors. */
    status() {
      return { cut, genW: limiter.stats.lastGenW, genPeakW: limiter.stats.genPeakW, gains: [...limiter.stats.gains],
        sent: ddp?.status().sent ?? 0, errors: ddp?.status().errors ?? 0, lastError: ddp?.status().lastError ?? '' };
    },
    /** A few black frames (fppd holds the last one it got), then the socket closed. */
    async close() {
      if (!ddp) return;
      frame.fill(0);
      for (let i = 0; i < 5; i++) {
        ddp.send(frame);
        await new Promise((r) => setTimeout(r, 10));
      }
      await ddp.close();
    },
  };
}
export type Output = ReturnType<typeof createOutput>;
