#!/usr/bin/env node
// sacn-play.mjs: plays an .fseq as E1.31 (sACN), the way xLights' "Output to Lights" and FPP do, so
// relay/relay.js (and Mirage behind it) or the F48V5 see exactly what the show file holds.
//
//   node tools/sacn-play.mjs <show.fseq> [options]
//     --host <ip>        unicast destination (default 127.0.0.1)
//     --multicast        send to 239.255.{hi}.{lo} per universe instead
//     --port <n>         UDP port (default 5568)
//     --rig <rig.json>   the installation (default public/data/rig.json): its universes and channels per universe
//     --universes a-b    universes to send (default: all the rig's); each carries its channels in 512 slots
//     --loop             start again at the end (default: play once, then terminate the streams)
//     --hold <frame>     keep sending that one frame (with --seconds, for that long)
//     --seconds <s>      stop after s seconds
//     --fps <n>          send rate (default: the file's step time)
//     --priority <n>     0-200 (default 100)   --name <text>  source name   --quiet  no status line
//
// Plain, sparse (ranges) and zstd/zlib compressed FSEQ v2 files are read with src/frames.js.

import { randomUUID } from 'node:crypto';
import dgram from 'node:dgram';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHANNELS_PER_UNIVERSE, MAX_CHANNELS, parseFseq } from '../src/frames.js';
import { inflateBlock } from '../src/fseq-codec.js';

/** ANSI E1.31-2018 data packet layout: byte offsets, sizes and the fixed values. */
export const E131 = Object.freeze({
  PORT: 5568,
  SLOTS: 512,                     // DMX slots after the start code; we fill 510 and zero the last two
  LENGTH: 638,                    // 126-byte header + 512 slots
  // Root layer
  PREAMBLE: 0, POSTAMBLE: 2, ACN_ID: 4, ROOT_FLAGS: 16, ROOT_VECTOR: 18, CID: 22,
  // Framing layer
  FRAME_FLAGS: 38, FRAME_VECTOR: 40, SOURCE_NAME: 44, PRIORITY: 108, SYNC: 109, SEQUENCE: 111,
  OPTIONS: 112, UNIVERSE: 113,
  // DMP layer
  DMP_FLAGS: 115, DMP_VECTOR: 117, ADDRESS_TYPE: 118, FIRST_ADDRESS: 119, INCREMENT: 121,
  COUNT: 123, START_CODE: 125, DATA: 126,
  // Values
  PREAMBLE_SIZE: 0x0010,
  ACN_PACKET_ID: Object.freeze([0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00]),
  VECTOR_ROOT_E131_DATA: 0x00000004,
  VECTOR_E131_DATA_PACKET: 0x00000002,
  VECTOR_DMP_SET_PROPERTY: 0x02,
  ADDRESS_DATA_TYPE: 0xa1,
  NAME_BYTES: 64,
  OPT_PREVIEW: 0x80, OPT_TERMINATED: 0x40, OPT_FORCE_SYNC: 0x20,
});

const flagsLength = (buf, at) => buf.writeUInt16BE(0x7000 | (E131.LENGTH - at), at);

/** A 16-byte CID from a UUID string (or 16 random bytes' worth). */
export function cidBytes(uuid = randomUUID()) {
  const hex = String(uuid).replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`sacn: CID must be a UUID, got ${uuid}`);
  return Buffer.from(hex, 'hex');
}

/**
 * One E1.31 data packet (638 bytes) with every header field set and the slots zero. Fill slots
 * from E131.DATA and stamp the sequence with setSequence(); the rest never changes per universe.
 */
export function e131Packet({ cid, name = 'Folly Studio', priority = 100, universe, sequence = 0, options = 0 }) {
  if (!Number.isInteger(universe) || universe < 1 || universe > 63999) throw new Error('sacn: universe 1-63999');
  if (!Number.isInteger(priority) || priority < 0 || priority > 200) throw new Error('sacn: priority 0-200');
  const cidBuf = Buffer.isBuffer(cid) ? cid : cidBytes(cid);
  if (cidBuf.length !== 16) throw new Error('sacn: CID must be 16 bytes');
  const b = Buffer.alloc(E131.LENGTH);
  // Root layer
  b.writeUInt16BE(E131.PREAMBLE_SIZE, E131.PREAMBLE);
  b.writeUInt16BE(0, E131.POSTAMBLE);
  b.set(E131.ACN_PACKET_ID, E131.ACN_ID);
  flagsLength(b, E131.ROOT_FLAGS);
  b.writeUInt32BE(E131.VECTOR_ROOT_E131_DATA, E131.ROOT_VECTOR);
  cidBuf.copy(b, E131.CID);
  // Framing layer
  flagsLength(b, E131.FRAME_FLAGS);
  b.writeUInt32BE(E131.VECTOR_E131_DATA_PACKET, E131.FRAME_VECTOR);
  const nameBytes = Buffer.from(String(name), 'utf8');
  let n = Math.min(nameBytes.length, E131.NAME_BYTES - 1); // always NUL-terminated
  while (n > 0 && (nameBytes[n] & 0xc0) === 0x80) n--;      // never split a UTF-8 character
  nameBytes.copy(b, E131.SOURCE_NAME, 0, n);
  b[E131.PRIORITY] = priority;
  b.writeUInt16BE(0, E131.SYNC);                            // no synchronization universe
  b[E131.SEQUENCE] = sequence & 0xff;
  b[E131.OPTIONS] = options & 0xff;
  b.writeUInt16BE(universe, E131.UNIVERSE);
  // DMP layer
  flagsLength(b, E131.DMP_FLAGS);
  b[E131.DMP_VECTOR] = E131.VECTOR_DMP_SET_PROPERTY;
  b[E131.ADDRESS_TYPE] = E131.ADDRESS_DATA_TYPE;
  b.writeUInt16BE(0x0000, E131.FIRST_ADDRESS);
  b.writeUInt16BE(0x0001, E131.INCREMENT);
  b.writeUInt16BE(E131.SLOTS + 1, E131.COUNT);              // the start code plus the slots
  b[E131.START_CODE] = 0x00;                                // DMX512 null start code
  return b;
}

/** E1.31 multicast group of a universe: 239.255.{high byte}.{low byte}. */
export function multicastAddress(universe) {
  return `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
}

/**
 * Copy a universe's channels from a full frame (absolute channel (u − 1) × cpu + (ch − 1)) into
 * its packet's first slots; the rest of its 512 stay zero.
 */
export function fillSlots(packet, frame, universe, cpu = CHANNELS_PER_UNIVERSE) {
  const from = (universe - 1) * cpu;
  const end = Math.min(from + cpu, frame.length);
  if (end > from) packet.set(frame.subarray(from, end), E131.DATA);
  packet.fill(0, E131.DATA + Math.max(0, end - from), E131.LENGTH);
  return packet;
}

/**
 * A show from .fseq bytes: { frames, stepMs, fps, channels, frame(n, out?) → Uint8Array(channels) },
 * every frame expanded to absolute channels (sparse ranges placed, the rest zero), at least `minChannels`.
 */
export function readShow(bytes, { maxDataBytes = 2 ** 31 - 1, minChannels = MAX_CHANNELS } = {}) {
  const parsed = parseFseq(bytes, {
    maxBytes: Math.max(bytes.length, 1), maxDataBytes, maxChannels: 2 ** 24, decompress: inflateBlock,
  });
  const { data, ranges, channelCount, frameCount, stepMs } = parsed;
  const span = ranges.reduce((m, [start, count]) => Math.max(m, start + count), 0);
  const channels = Math.max(minChannels, span);
  const frame = (n, out) => {
    const full = out && out.length >= channels ? out : new Uint8Array(channels);
    const i = Math.min(Math.max(0, Math.floor(n)), frameCount - 1);
    let at = i * channelCount;
    for (const [start, count] of ranges) {
      full.set(data.subarray(at, at + count), start);
      at += count;
    }
    return full;
  };
  return { frames: frameCount, stepMs, fps: 1000 / stepMs, channels, sparse: parsed.sparse,
    compression: parsed.compression, frame };
}

/**
 * Sends full frames as one E1.31 packet per universe, with a sequence number per universe.
 * dgram.send keeps the buffer until its callback (it resolves the address on the next tick), so
 * each universe keeps a pool of packets that come back when sent: no packet is rewritten in flight.
 */
export class SacnSender {
  constructor({ socket, host = '127.0.0.1', port = E131.PORT, multicast = false, cid, name, priority = 100,
    universes = [1, 80], channelsPerUniverse = CHANNELS_PER_UNIVERSE }) {
    const cidBuf = cid ? cidBytes(cid) : cidBytes();
    Object.assign(this, { socket, host, port, multicast, packets: 0, frames: 0, cpu: channelsPerUniverse });
    this.streams = [];
    for (let u = universes[0]; u <= universes[1]; u++) {
      const template = e131Packet({ cid: cidBuf, name, priority, universe: u });
      this.streams.push({ universe: u, sequence: 0, to: multicast ? multicastAddress(u) : host, template,
        free: [template] });
    }
  }

  #emit(frame, options) {
    for (const s of this.streams) {
      const p = fillSlots(s.free.pop() ?? Buffer.from(s.template), frame, s.universe, this.cpu);
      p[E131.SEQUENCE] = s.sequence;
      p[E131.OPTIONS] = options;
      s.sequence = (s.sequence + 1) & 0xff;
      this.socket.send(p, 0, E131.LENGTH, this.port, s.to, () => s.free.push(p));
      this.packets++;
    }
  }

  /** One frame (absolute channels) on every universe. */
  send(frame) {
    this.#emit(frame, 0);
    this.frames++;
  }

  /** E1.31 §6.7.1: three packets with Stream_Terminated set end each stream at once. */
  terminate(frame) {
    for (let i = 0; i < 3; i++) this.#emit(frame, E131.OPT_TERMINATED);
  }
}

const USAGE = 'usage: node tools/sacn-play.mjs <show.fseq> [--host ip | --multicast] [--port n] [--rig rig.json]'
  + ' [--universes a-b] [--loop] [--hold frame] [--seconds s] [--fps n] [--priority n] [--name text] [--quiet]';
const RIG = fileURLToPath(new URL('../public/data/rig.json', import.meta.url));

/** Command-line options; throws with the usage on anything unknown or out of range. */
export function parseArgs(argv) {
  const o = { host: '127.0.0.1', port: E131.PORT, multicast: false, universes: null, loop: false, hold: null,
    seconds: null, fps: null, priority: 100, name: 'Folly Studio sacn-play', quiet: false, file: null, rig: RIG };
  const num = (v, flag, lo, hi) => {
    const n = Number(v);
    if (v === undefined || !Number.isFinite(n) || n < lo || n > hi) throw new Error(`${flag}: ${lo}-${hi}\n${USAGE}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--host') o.host = next();
    else if (a === '--multicast') o.multicast = true;
    else if (a === '--port') o.port = num(next(), a, 1, 65535) | 0;
    else if (a === '--loop') o.loop = true;
    else if (a === '--hold') o.hold = num(next(), a, 0, 2 ** 32) | 0;
    else if (a === '--seconds') o.seconds = num(next(), a, 0.001, 1e7);
    else if (a === '--fps') o.fps = num(next(), a, 0.1, 1000);
    else if (a === '--priority') o.priority = num(next(), a, 0, 200) | 0;
    else if (a === '--name') o.name = String(next() ?? '');
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--rig') o.rig = String(next() ?? '');
    else if (a === '--universes') {
      const m = /^(\d+)(?:-(\d+))?$/.exec(next() || '');
      const lo = m ? +m[1] : 0, hi = m ? +(m[2] ?? m[1]) : 0;
      if (!m || lo < 1 || hi > 63999 || lo > hi) throw new Error(`--universes: a-b within 1-63999\n${USAGE}`);
      o.universes = [lo, hi];
    } else if (a === '-h' || a === '--help') throw new Error(USAGE);
    else if (!a.startsWith('-') && !o.file) o.file = a;
    else throw new Error(`unknown argument ${a}\n${USAGE}`);
  }
  if (!o.file) throw new Error(USAGE);
  if (!o.host) throw new Error(`--host needs an address\n${USAGE}`);
  return o;
}

/**
 * Play a show in real time: the frame shown is the one due at the elapsed time (late ticks drop
 * frames rather than drift, as FPP does). Resolves when it ends; stop() ends it early.
 */
export function play(show, sender, { loop = false, hold = null, seconds = null, fps = null, onTick } = {}) {
  const stepMs = fps ? 1000 / fps : show.stepMs;
  const fileStep = show.stepMs;
  const buf = new Uint8Array(show.channels);
  const t0 = performance.now();
  let timer = null, stopped = false, last = -1, dropped = 0, finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const end = (terminate) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    if (terminate) sender.terminate(buf);
    finish({ frames: sender.frames, packets: sender.packets, dropped });
  };
  const tick = () => {
    if (stopped) return;
    const elapsed = performance.now() - t0;
    if (seconds !== null && elapsed >= seconds * 1000) return end(true);
    const n = Math.floor(elapsed / stepMs);
    if (last >= 0 && n > last + 1) dropped += n - last - 1;
    last = n;
    let f;
    if (hold !== null) f = Math.min(hold, show.frames - 1);
    else {
      f = Math.floor((n * stepMs) / fileStep);
      if (f >= show.frames && !loop) return end(true);
      f %= show.frames;
    }
    sender.send(show.frame(f, buf));
    onTick?.(f, n, dropped);
    timer = setTimeout(tick, Math.max(0, t0 + (n + 1) * stepMs - performance.now()));
  };
  tick();
  return { done, stop: () => end(true) };
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
    return;
  }
  const { universes, channelsPerUniverse } = JSON.parse(readFileSync(o.rig, 'utf8')).output;
  o.universes ||= [1, universes];
  if (o.universes[1] > universes) {
    console.error(`--universes: the rig has universes 1-${universes}`);
    process.exitCode = 2;
    return;
  }
  const show = readShow(new Uint8Array(readFileSync(o.file)), { minChannels: universes * channelsPerUniverse });
  if (o.hold !== null && o.hold >= show.frames) {
    console.error(`--hold ${o.hold}: the file has ${show.frames} frames`);
    process.exitCode = 2;
    return;
  }
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  await new Promise((resolve) => socket.bind(0, resolve));
  if (o.multicast) socket.setMulticastTTL(1);
  const sender = new SacnSender({ socket, ...o, channelsPerUniverse });
  const what = o.hold !== null ? `holding frame ${o.hold}` : `${show.frames} frames${o.loop ? ', looping' : ''}`;
  const kind = `${show.sparse ? 'sparse' : 'full'}${show.compression === 'none' ? '' : `, ${show.compression}`}`;
  const to = o.multicast ? 'multicast 239.255.x.x' : o.host;
  console.log(`sacn-play: ${path.basename(o.file)} (${kind}, ${show.fps} fps), ${what}, universes `
    + `${o.universes[0]}-${o.universes[1]} → ${to}:${o.port}`);
  let lastLine = 0;
  const onTick = o.quiet ? null : (f, n, dropped) => {
    const now = performance.now();
    if (now - lastLine < 1000) return;
    lastLine = now;
    process.stderr.write(`\rframe ${f}  sent ${sender.frames} frames / ${sender.packets} packets  dropped ${dropped} `);
  };
  const run = play(show, sender, { ...o, onTick });
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => run.stop());
  const r = await run.done;
  await new Promise((resolve) => setTimeout(resolve, 50)); // let the terminate packets leave
  socket.close();
  if (!o.quiet) process.stderr.write('\n');
  console.log(`sacn-play: sent ${r.frames} frames, ${r.packets} packets, dropped ${r.dropped}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
