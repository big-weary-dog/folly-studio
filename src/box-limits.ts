// How the render box caps a bake's tasks and memory. RLIMIT_NPROC counts every task of the server's user, in every pid
// namespace (so not countable from /proc), not the bake's: a fixed cap fails every bake on a busy account. Where a
// systemd user scope works, each bake gets its own cgroup (TasksMax, MemoryMax) that counts the bake alone. Elsewhere
// tasks are left to the account's own limit (the bake's pid namespace and wall clock still end it, children and all)
// and memory falls back to RLIMIT_DATA.

import { execFile } from 'node:child_process';

const SECOND = 1000;

/** The environment systemd-run needs to reach the user's manager; the box itself still starts with none. */
export function busEnv(env: NodeJS.ProcessEnv) {
  const keep: Record<string, string> = {};
  for (const k of ['XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) if (env[k]) keep[k] = env[k]!;
  return keep;
}

/** Does `systemd-run --user --scope` give a scope its own pids (and memory) limits here? */
export async function scopeLimits(systemdRun: string | null, node: string, env: NodeJS.ProcessEnv) {
  if (!systemdRun) return { pids: false, memory: false };
  const read = 'const fs=require("fs");const c="/sys/fs/cgroup"+fs.readFileSync("/proc/self/cgroup","utf8")'
    + '.trim().split(":").pop();for(const f of ["pids.max","memory.max"])try{console.log(f,fs.readFileSync(c+"/"+f,'
    + '"utf8").trim())}catch{}';
  const out = await new Promise<string>((resolve) => {
    execFile(systemdRun, ['--user', '--scope', '--quiet', '-p', 'TasksMax=37', '-p', 'MemoryMax=67108864', '--', node,
      '-e', read], { timeout: 10 * SECOND, env: busEnv(env) }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
  return { pids: /^pids\.max 37$/m.test(out), memory: /^memory\.max 67108864$/m.test(out) };
}
