// DDP (Distributed Display Protocol) over UDP, as fppd's bridge takes it on 127.0.0.1:4048 (lighting's
// ADD_LIVE_APP.md): each frame in packets of 1,440 data bytes, PUSH on the last. Header, 10 bytes, big-endian:
//   0 flags (0x40 version 1, 0x01 PUSH) · 1 sequence 1-15 · 2 data type (1, as FPP's own DDP output) · 3 id (1, the
//   display) · 4 u32 offset (bytes) · 8 u16 length
// The receiver is the simulator's (pi/sim.ts) and the tests'.
import dgram from 'node:dgram';

const DDP_PORT = 4048;
const HEADER = 10, CHUNK = 1440, VER1 = 0x40, PUSH = 0x01;

/** The packets for frames of `channels` bytes, made once: fill(frame, seq) writes a frame into them. */
export function ddpPackets(channels: number) {
  const packets: Buffer[] = [];
  for (let at = 0; at < channels; at += CHUNK) {
    const n = Math.min(CHUNK, channels - at), p = Buffer.alloc(HEADER + n);
    p[0] = VER1 | (at + n >= channels ? PUSH : 0);
    p[2] = 1;
    p[3] = 1;
    p.writeUInt32BE(at, 4);
    p.writeUInt16BE(n, 8);
    packets.push(p);
  }
  // Each packet's slice of the last frame filled from: the frame is the same buffer each time, so no views per frame.
  let from: Uint8Array | null = null, slices: Uint8Array[] = [];
  return {
    packets,
    fill(frame: Uint8Array, seq: number) {
      if (frame !== from) {
        from = frame;
        slices = packets.map((p) => {
          const at = p.readUInt32BE(4);
          return frame.subarray(at, at + p.length - HEADER);
        });
      }
      for (let i = 0; i < packets.length; i++) {
        const p = packets[i]!;
        p[1] = seq;
        p.set(slices[i]!, HEADER);
      }
    },
  };
}

/** send(frame): one frame to host:port as DDP (dropped, false, until the socket is connected: `ready`). Two sets of
 * packets in turn, so a frame never overwrites one still queued. close() when done. */
export function ddpSender({ host = '127.0.0.1', port = DDP_PORT, channels }: { host?: string, port?: number,
  channels: number }) {
  const sock = dgram.createSocket(host.includes(':') ? 'udp6' : 'udp4');
  const sets = [ddpPackets(channels), ddpPackets(channels)];
  let seq = 0, sent = 0, errors = 0, lastError = '', connected = false;
  const failed = (e: Error | null) => { if (e) { errors++; lastError = e.message; } };
  sock.on('error', failed);
  const ready = new Promise<void>((resolve, reject) => {
    sock.once('error', reject);
    sock.connect(port, host, () => { connected = true; sock.off('error', reject); resolve(); });
  });
  return {
    ready,
    send(frame: Uint8Array) {
      if (!connected) return false;
      seq = (seq % 15) + 1;
      const set = sets[sent++ & 1]!;
      set.fill(frame, seq);
      for (const p of set.packets) sock.send(p, failed);
      return true;
    },
    status: () => ({ sent, errors, lastError }),
    close: () => new Promise<void>((resolve) => sock.close(() => resolve())),
  };
}

/** A DDP receiver on `port`: onFrame(frame) on each PUSH, the frame's bytes so far (reused: copy to keep). */
export function ddpReceiver({ port = DDP_PORT, host = '127.0.0.1', channels, onFrame }: { port?: number,
  host?: string, channels: number, onFrame: (frame: Uint8Array) => void }) {
  const sock = dgram.createSocket('udp4'), frame = new Uint8Array(channels);
  let bad = 0;
  sock.on('message', (m) => {
    if (m.length < HEADER || (m[0]! & 0xc0) !== VER1) { bad++; return; }
    const at = m.readUInt32BE(4), n = Math.min(m.readUInt16BE(8), m.length - HEADER, channels - at);
    if (n > 0) frame.set(m.subarray(HEADER, HEADER + n), at);
    if (m[0]! & PUSH) onFrame(frame);
  });
  const ready = new Promise<number>((resolve) => sock.bind(port, host, () => resolve(sock.address().port)));
  return { ready, bad: () => bad, close: () => new Promise<void>((resolve) => sock.close(() => resolve())) };
}
