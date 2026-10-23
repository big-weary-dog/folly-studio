import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';

const stat = (pid) => fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
const alive = ([pid, start]) => {
  try { const s = stat(pid); return s[19] === start && s[0] !== 'Z'; } catch { return false; }
};

async function until(read, timeout = 10_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail('the box did not reach the expected state');
}

test('a library-only box exits when its host is killed without cleanup', async ({ skip }) => {
  skip(process.platform !== 'linux', 'needs Linux /proc');
  skip(!fs.existsSync('/usr/bin/prlimit'), 'needs prlimit');
  skip(!fs.existsSync(new URL('../public/data/rig.json', import.meta.url)), 'needs a built rig.json');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'box-parent-'));
  const parent = spawn(process.execPath, ['test/fixtures/box-parent.mjs', tmpRoot],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = once(parent, 'exit');
  let stderr = '', box;
  parent.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    box = await until(() => {
      assert.equal(parent.exitCode, null, stderr);
      const children = fs.readFileSync(`/proc/${parent.pid}/task/${parent.pid}/children`, 'utf8').trim().split(' ');
      for (const pid of children.filter(Boolean)) {
        try {
          const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
          const out = cmd[cmd.indexOf('--out') + 1];
          if (cmd.some((s) => s.endsWith('/box/render.ts'))) {
            box = [pid, stat(pid)[19]];
            if (fs.statSync(path.join(out, 'frames.fseq')).size > 0) return box;
          }
        } catch {}
      }
    }, 30_000);
    assert.ok(alive(box), 'the real box is baking before the host dies');
    parent.kill('SIGKILL');
    await exited;
    await until(() => !alive(box));
    assert.equal(alive(box), false, 'the box does not outlive its host');
  } finally {
    if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL');
    await exited;
    if (box && alive(box)) process.kill(Number(box[0]), 'SIGKILL');
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
