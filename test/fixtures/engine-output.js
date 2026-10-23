// Dry-engine output is a byte stream: publish a stats record only after its complete line arrives.
import { createInterface } from 'node:readline';

export function engineOutput(stream) {
  const ready = Promise.withResolvers();
  let text = '', latest = '';
  createInterface({ input: stream }).on('line', (line) => {
    text += `${line}\n`;
    if (line.includes('control page on')) ready.resolve();
    if (line.includes(' fps,')) latest = line;
  });
  return { ready: ready.promise, text: () => text, stats: () => {
    const r = latest.match(/relay (\S+) (on|off), ahead \d+, missed (\d+)/), w = latest.match(/gen (\d+) W/);
    return { relay: r ? { by: r[1], on: r[2] === 'on', missed: Number(r[3]) } : null,
      watts: w ? Number(w[1]) : NaN };
  } };
}
