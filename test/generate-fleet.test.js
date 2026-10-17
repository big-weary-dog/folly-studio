// src/generate/fleet.js against a stub fleet CLI, and the boxed worker's own fleet-box/check.mjs.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { writeFseq } from '../public/js/fseq.js';
import { layersHash, parseDuration } from '../src/bake.js';
import { bundle } from '../src/bundle.js';
import { analyzeFrames, parseFseq } from '../src/frames.js';
import { createFleetAdapter, fenceUntrusted, readLook, workerName } from '../src/generate/fleet.js';
import { createQueue } from '../src/generate/index.js';
import { sketchLook } from '../src/generate/sketch.js';
import { GenerateError, validateLook } from '../src/generate/validate.js';
import {
  FIX, fakeStore, goodLayer, GROUPS, LIBRARY, lookJson, quiet, STUDIO, tmp,
} from './fixtures/generate/shared.js';

describe('fleet (experimental, stub CLI)', () => {
  const stub = path.join(FIX, 'fleet-stub.mjs');
  fs.chmodSync(stub, 0o755);

  function setup(mode, extra = {}, stubEnv = {}) {
    const dir = tmp('fleet');
    const log = path.join(dir, 'calls.jsonl');
    const look = path.join(dir, 'worker-look.json');
    const secret = path.join(dir, 'secret.json');
    fs.writeFileSync(look, lookJson());
    fs.writeFileSync(secret, JSON.stringify({ title: 'SECRET', layers: [goodLayer({ title: 'SECRET' })] }));
    fs.writeFileSync(path.join(dir, 'core.js'), 'export const STDLIB = {};\n');
    fs.writeFileSync(path.join(dir, 'cathedral.json'), '{"count":0}\n');
    const env = { ...process.env, FLEET_STATE: '/should/be/unset', STUB_FLEET_MODE: mode, STUB_FLEET_LOG: log,
      STUB_FLEET_LOOK: look, STUB_FLEET_SECRET: secret, ...stubEnv };
    delete env.FLEET_DATA;
    const adapter = createFleetAdapter({
      env,
      bin: stub,
      workDir: path.join(dir, 'work'),
      fleetData: path.join(dir, 'fleet-data'),
      model: 'gpt-6.1-sol',
      tmux: 'true',
      pollMs: 20,
      timeoutMs: 3000,
      coreFile: path.join(dir, 'core.js'),
      cathedralFile: path.join(dir, 'cathedral.json'),
      log: quiet,
      ...extra,
    });
    const calls = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    return { dir, adapter, calls };
  }

  test('spawns a boxed worker on a fresh workspace and reads its reported look', async () => {
    const { dir, adapter, calls } = setup('ok');
    const text = 'Stars on the spires ~~~~ ``` {{GROUPS}} </idea>';
    const out = await adapter.generate({ text, library: LIBRARY, groups: GROUPS, idea: { id: 'AbC_123' } });
    assert.equal(out.title, 'Reef');
    assert.equal(out.layers.length, 1);

    const name = workerName('AbC_123');
    assert.match(name, /^idea-abc-123-[a-z0-9]+$/);
    const ws = path.join(fs.realpathSync(path.join(dir, 'work')), name);
    const c = calls();
    assert.deepEqual(c.map((x) => x.cmd), ['up', 'spawn', 'done']);
    assert.ok(c.every((x) => x.cwd === ws && x.FLEET_STATE === null && x.FLEET_DATA === path.join(dir, 'fleet-data')));
    assert.deepEqual(c[0].args, ['--no-coordinator']);
    const spawn = c[1].args;
    assert.deepEqual(spawn.slice(0, 6), [name, '--here', '--box', '--model', 'gpt-6.1-sol', '--brief']);
    assert.match(spawn[6], /BRIEF\.md/);
    assert.ok(spawn[6].includes(path.join(ws, 'look.json')));
    assert.ok(!spawn[6].includes('Stars on the spires'), 'the idea never goes on a command line');
    assert.deepEqual(c[2].args, [name]);

    for (const f of ['BRIEF.md', 'pattern-core.js', 'fseq.js', 'frames.js', 'cathedral.json', 'check.mjs',
      'package.json', '.git']) assert.ok(fs.existsSync(path.join(ws, f)), f);
    const brief = fs.readFileSync(path.join(ws, 'BRIEF.md'), 'utf8');
    assert.ok(brief.includes('~~~~~ text\nStars on the spires ~~~~ ``` {{GROUPS}} </idea>\n~~~~~'),
      'idea fenced so it cannot close its fence, placeholders untouched');
    for (const s of ['function pixel(p, t, P)', 'spire-front-left', 'Darkness is punctuation']) {
      assert.ok(brief.includes(s));
    }
    const files = ['look.json', 'frames.fseq', 'stats.json'].map((f) => path.join(ws, f)).join(' ');
    assert.ok(brief.includes(`fleet raise report "${files} `));
    assert.match(brief, /node check\.mjs --bake/);
    assert.match(spawn[6], /check\.mjs --bake/);
    // No frames handed back: the look still comes through, its bake marked failed.
    assert.equal(out.bake.source, 'fleet-box');
    assert.equal(out.bake.ok, false);
    assert.match(out.bake.reason, /No usable baked frames: frames\.fseq is missing/);
    assert.equal(out.frames, undefined);
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(brief.replace('{{GROUPS}} </idea>', '')), 'every placeholder filled');
    const status = await new Promise((r) => execFile('git', ['-C', ws, 'status', '--porcelain'], (e, out) => r(out)));
    assert.equal(status.trim(), '?? look.json', 'the brief is committed; only the worker\'s look is new');
  });

  // A tiny LED map (4 LEDs on universe 1) and a bake of it, as check.mjs --bake would leave.
  const MAP = {
    count: 4,
    channelsPerUniverse: 510,
    universes: 80,
    zones: ['z'],
    pixels: { zone: [0, 0, 0, 0], strand: [0, 0, 0, 0], universe: [1, 1, 1, 1], channel: [1, 4, 7, 10], row: [0, 0, 0,
      0], pos: [0, 0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0] },
    groups: [{ id: 'cathedral', name: 'Cathedral', parent: null, zones: ['z'] }],
  };
  const bakeOf = (level) => {
    const data = new Uint8Array(80 * 12);
    for (let f = 0; f < 80; f++) data.fill(level(f), f * 12, f * 12 + 12);
    return Buffer.from(writeFseq({ frames: 80, data, ranges: [[0, 12]] }));
  };
  const STATS = `{"msPerFrame":{"average":1},"evil":{"__proto__":{"polluted":true}},"note":"${'x'.repeat(500)}"}`;
  function withBake(mode, frames, { stats = STATS, ...extra } = {}) {
    const dir = tmp('bake-input');
    const map = path.join(dir, 'map.json');
    fs.writeFileSync(map, JSON.stringify(MAP));
    const stubEnv = { STUB_FLEET_STATS: path.join(dir, 'stats.json') };
    fs.writeFileSync(stubEnv.STUB_FLEET_STATS, stats);
    if (frames) fs.writeFileSync((stubEnv.STUB_FLEET_FRAMES = path.join(dir, 'frames.fseq')), frames);
    return setup(mode, { cathedralFile: map, ...extra }, stubEnv);
  }

  test('reads the worker\'s bake as data: strict parse, analysis, untrusted stats', async () => {
    const frames = bakeOf((f) => Math.round(127 - 127 * Math.cos((Math.PI * f) / 40)));
    const { adapter } = withBake('ok', frames);
    const out = await adapter.generate({ text: 'slow glow', groups: GROUPS, idea: { id: 'baked' } });
    assert.equal(out.title, 'Reef');
    assert.equal(out.bake.source, 'fleet-box');
    assert.equal(out.bake.status, 'done');
    assert.equal(out.bake.ok, true, out.bake.reason);
    assert.equal(out.bake.analysis.frames, 80);
    assert.equal(out.bake.analysis.flicker.ok, true);
    assert.equal(out.bake.analysis.estPeakAmps, 0.2);
    assert.equal(out.bake.frames.bytes, frames.length);
    assert.match(out.bake.frames.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(out.frames, frames);
    assert.equal(out.bake.boxStats.untrusted, true);
    assert.equal(out.bake.boxStats.reported.msPerFrame.average, 1);
    assert.equal(out.bake.boxStats.reported.note.length, 200);
    assert.deepEqual(out.bake.boxStats.reported.evil, {});
    assert.equal(out.bake.boxStats.reported.evil.polluted, undefined);

    // A strobe is still handed back (the look is saved), but the bake fails the flicker check.
    const { adapter: strobe } = withBake('ok', bakeOf((f) => (Math.floor(f / 2) % 2 ? 0 : 255)));
    const s = await strobe.generate({ text: 'strobe', groups: GROUPS, idea: { id: 'strobe' } });
    assert.equal(s.bake.ok, false);
    assert.equal(s.bake.analysis.flicker.maxHz, 10);
    assert.match(s.bake.reason, /10 flashes a second/);
  });

  test('refuses truncated, oversized and symlinked frames, but keeps the look', async () => {
    const good = bakeOf(() => 50);
    const cases = [
      ['ok', good.subarray(0, good.length - 5), {}, /rejected: holds \d+ bytes of channel data, expected 80 frames/],
      ['ok', good, { maxFramesBytes: 1000 }, /frames\.fseq is \d+ bytes, over the 1000-byte limit/],
      ['frames-symlink', good, {}, /frames\.fseq is a symlink/],
    ];
    for (const [i, [mode, frames, extra, reason]] of cases.entries()) {
      const { adapter } = withBake(mode, frames, extra);
      const out = await adapter.generate({ text: 'x', groups: GROUPS, idea: { id: `bad-${i}` } });
      assert.equal(out.title, 'Reef');
      assert.equal(out.bake.ok, false);
      assert.equal(out.bake.status, 'failed');
      assert.match(out.bake.reason, reason);
      assert.equal(out.frames, undefined);
    }
  });

  test('through the queue: the look keeps its bake, the frames go to the data dir', async () => {
    const frames = bakeOf(() => 90);
    const { adapter } = withBake('ok', frames);
    const store = fakeStore();
    const user = store.users.create({ username: 'ana', role: 'member' });
    const framesDir = path.join(tmp('frames-dir'), 'frames');
    const queue = createQueue({ store, adapters: { fleet: adapter }, adapterName: 'fleet', loadGroups: () => GROUPS,
      log: quiet, framesDir });
    const idea = store.ideas.create({ owner: user.id, text: 'glow', status: 'queued' });
    queue.enqueue(idea);
    await queue.idle();
    const done = store.ideas.get(idea.id);
    assert.equal(done.status, 'ready', done.error);
    const look = store.looks.get(done.lookId);
    assert.equal(look.bake.source, 'fleet-box');
    assert.equal(look.bake.ok, true);
    assert.equal(look.bake.layersHash, layersHash(look.layers));
    assert.deepEqual(fs.readFileSync(path.join(framesDir, `${look.id}.fseq`)), frames);
    assert.equal(analyzeFrames(parseFseq(fs.readFileSync(path.join(framesDir, `${look.id}.fseq`))), MAP).frames, 80);

    // Without anywhere to put frames, the bake says so instead of pretending.
    const { adapter: again } = withBake('ok', frames);
    const q2 = createQueue({ store, adapters: { fleet: again }, adapterName: 'fleet', loadGroups: () => GROUPS,
      log: quiet });
    const i2 = store.ideas.create({ owner: user.id, text: 'glow', status: 'queued' });
    q2.enqueue(i2);
    await q2.idle();
    const l2 = store.looks.get(store.ideas.get(i2.id).lookId);
    assert.equal(l2.bake.ok, false);
    assert.match(l2.bake.reason, /could not be stored/);
  });

  test('answers a stuck raise with a nudge, then takes the report', async () => {
    const { adapter, calls } = setup('stuck');
    const out = await adapter.generate({ text: 'fire', library: LIBRARY, groups: GROUPS, idea: { id: 'i2' } });
    assert.equal(out.title, 'Reef');
    const c = calls();
    assert.deepEqual(c.map((x) => x.cmd), ['up', 'spawn', 'send', 'done']);
    assert.equal(c[2].args[0], 'idea-i2');
    assert.match(c[2].args[1], /Nobody can answer/);
  });

  test('never follows a symlinked look.json, nor a path the worker names', async () => {
    for (const mode of ['symlink', 'elsewhere']) {
      const { adapter, calls } = setup(mode);
      await assert.rejects(
        adapter.generate({ text: 'x', library: [], groups: GROUPS, idea: { id: `s-${mode}` } }),
        (e) => e instanceof GenerateError && !/SECRET/.test(e.message) && /readable look/.test(e.userMessage),
      );
      assert.equal(calls().at(-1).cmd, 'done');
    }
  });

  test('ignores stale raises, times out, and still cleans up', async () => {
    const { dir, adapter, calls } = setup('silent', { timeoutMs: 300 });
    const state = path.join(dir, 'fleet-data', 'idea-old');
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, 'inbox.jsonl'), JSON.stringify({ at: 'then', from: 'idea-old', kind: 'report',
      msg: '/x/look.json old', answered: true }) + '\n');
    await assert.rejects(adapter.generate({ text: 'x', groups: GROUPS, idea: { id: 'old' } }),
      (e) => /did not finish in time/.test(e.userMessage));
    assert.deepEqual(calls().map((x) => x.cmd), ['up', 'spawn', 'done']);
  });

  test('a failed spawn is reported, and a missing runtime refuses before touching fleet', async () => {
    const { adapter, calls } = setup('fail-spawn');
    await assert.rejects(adapter.generate({ text: 'x', idea: { id: 'f' } }),
      (e) => /could not start a worker/.test(e.userMessage) && /bubblewrap/.test(e.message));
    assert.deepEqual(calls().map((x) => x.cmd), ['up', 'spawn', 'done']);
    const { adapter: noCore, dir } = setup('ok', { coreFile: '/nonexistent/pattern-core.js' });
    await assert.rejects(noCore.generate({ text: 'x', idea: { id: 'g' } }), (e) => /not set up/.test(e.userMessage));
    assert.ok(!fs.existsSync(path.join(dir, 'calls.jsonl')));
  });

  test('helpers', async () => {
    assert.equal(parseDuration('30m', 1), 1_800_000);
    assert.equal(parseDuration('90', 1), 90_000);
    assert.equal(parseDuration('250ms', 1), 250);
    assert.equal(parseDuration('soon', 7), 7);
    assert.match(workerName('../../Etc/Passwd'), /^idea-etc-passwd-[a-z0-9]+$/);
    assert.equal(workerName('abc-123'), 'idea-abc-123');
    assert.notEqual(workerName('AbC'), workerName('aBc'));
    assert.equal(fenceUntrusted('a\n~~~~~~\nb'), '~~~~~~~ text\na\n~~~~~~\nb\n~~~~~~~');
    const dir = tmp('readlook');
    const big = path.join(dir, 'big.json');
    fs.writeFileSync(big, JSON.stringify({ title: 'x'.repeat(600 * 1024) }));
    await assert.rejects(readLook(big), (e) => /too large/.test(e.userMessage));
    fs.mkdirSync(path.join(dir, 'dir.json'));
    await assert.rejects(readLook(path.join(dir, 'dir.json')), GenerateError);
  });
});

describe('fleet-box/check.mjs (boxed worker side, real runtime)', () => {
  const core = path.join(STUDIO, 'public/js/pattern-core.js');
  const cathedral = path.join(STUDIO, 'public/data/cathedral.json');
  const ready = fs.existsSync(core) && fs.existsSync(cathedral);
  const run = (dir, file, args = []) =>
    new Promise((resolve) => execFile(process.execPath, ['check.mjs', file, ...args], { cwd: dir, timeout: 60_000 },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr })));

  test('passes a good look and catches a broken one', { skip: !ready && 'pattern runtime not built yet' }, async () => {
    const dir = tmp('check');
    fs.writeFileSync(path.join(dir, 'pattern-core.js'), bundle(core).text);
    fs.copyFileSync(path.join(STUDIO, 'render-box/renderer.mjs'), path.join(dir, 'renderer.mjs'));
    fs.copyFileSync(path.join(STUDIO, 'public/js/fseq.js'), path.join(dir, 'fseq.js'));
    fs.copyFileSync(path.join(STUDIO, 'src/frames.js'), path.join(dir, 'frames.js'));
    fs.copyFileSync(cathedral, path.join(dir, 'cathedral.json'));
    fs.copyFileSync(path.join(STUDIO, 'fleet-box/check.mjs'), path.join(dir, 'check.mjs'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{ "type": "module" }\n');
    const good = validateLook(sketchLook({ text: 'ocean swell everywhere, twinkling stars on the rose window',
      library: LIBRARY, groups: GROUPS }), { groups: GROUPS });
    fs.writeFileSync(path.join(dir, 'good.json'), JSON.stringify(good));
    const ok = await run(dir, 'good.json');
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /✓ good\.json passes/);

    fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({
      title: 'Bad',
      summary: 's',
      layers: [
        { title: 'throws', groups: ['spires'], blend: 'add', level: 1,
          code: 'function pixel(p, t) { if (t > 1) throw new Error("boom"); return [1, 0, 0]; }' },
        { title: 'typo', groups: ['nowhere'], blend: 'add', level: 1, code: 'function pixel(p) { return [0, 0, 1] ' },
      ],
    }));
    const bad = await run(dir, 'bad.json');
    assert.equal(bad.code, 1, bad.out);
    assert.match(bad.out, /unknown group ids nowhere/);
    assert.match(bad.out, /does not compile/);

    fs.writeFileSync(path.join(dir, 'throws.json'), JSON.stringify({ title: 'T', summary: 's',
      layers: [JSON.parse(fs.readFileSync(path.join(dir, 'bad.json'), 'utf8')).layers[0]] }));
    const throws = await run(dir, 'throws.json');
    assert.equal(throws.code, 1, throws.out);
    assert.match(throws.out, /l1 threw or returned NaN: .*boom/);

    // --bake: sparse frames of the LED map's channels, stats, and the studio's own checks.
    const baked = await run(dir, 'good.json', ['--bake', '--seconds', '2']);
    assert.equal(baked.code, 0, baked.out);
    assert.match(baked.out, /baked 2 s \(80 frames × \d+ channels in \d+ ranges\)/);
    const map = JSON.parse(fs.readFileSync(cathedral, 'utf8'));
    const parsed = parseFseq(fs.readFileSync(path.join(dir, 'frames.fseq')));
    assert.equal(parsed.frameCount, 80);
    assert.equal(parsed.channelCount, map.count * 3);
    assert.equal(parsed.sparse, true);
    const stats = JSON.parse(fs.readFileSync(path.join(dir, 'stats.json'), 'utf8'));
    assert.equal(stats.frames, 80);
    assert.equal(stats.selfCheck.flicker.ok, true);
    assert.deepEqual(analyzeFrames(parsed, map), stats.selfCheck);

    fs.writeFileSync(path.join(dir, 'strobe.json'), JSON.stringify({
      title: 'Strobe', summary: 's',
      layers: [{ title: 'flash', groups: ['cathedral'], blend: 'add', level: 1,
        code: 'function pixel(p, t) { return floor(t * 20) % 2 ? [0, 0, 0] : [1, 1, 1]; }' }],
    }));
    const strobe = await run(dir, 'strobe.json', ['--bake', '--seconds', '2']);
    assert.equal(strobe.code, 1, strobe.out);
    assert.match(strobe.out, /✗ Large-area flashing at up to 10 flashes a second/);

    // The timeline: without --seconds it bakes the look's duration, and honours clips.
    fs.writeFileSync(path.join(dir, 'timed.json'), JSON.stringify({
      title: 'Timed', summary: 's', duration: 1.5,
      layers: [
        { title: 'base', groups: ['cathedral'], code: 'function pixel() { return [0, 0, 0.5]; }' },
        {
          title: 'hit', groups: ['cathedral'], code: 'function pixel() { return [1, 0, 0]; }',
          clips: [{ start: 0.5, end: 1, fadeIn: 0, fadeOut: 0 }, { start: 0.75, end: 2 }],
        },
      ],
    }));
    const timed = await run(dir, 'timed.json', ['--bake']);
    assert.equal(timed.code, 0, timed.out);
    assert.match(timed.out, /1 clip\(s\) are invalid, overlap another/);
    assert.match(timed.out, /baked 1\.5 s \(60 frames/);
    const t = parseFseq(fs.readFileSync(path.join(dir, 'frames.fseq')));
    assert.equal(t.frameCount, 60);
    assert.deepEqual([0, 19, 20, 39, 40, 59].map((n) => t.data[n * t.channelCount]), [0, 0, 255, 255, 0, 0]);
  });
});
