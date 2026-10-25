import { existsSync, readFileSync, watch } from 'node:fs';
import path from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';

/** Wait for the stand-in CLI's file acknowledgement, even while the parent's watchdog time is paused. */
export function fixtureReady(dir, read) {
  return new Promise((resolve, reject) => {
    const finish = (error, value) => {
      watcher.close();
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const check = () => {
      try { const value = read(); if (value) finish(null, value); } catch (error) { finish(error); }
    };
    const watcher = watch(dir, check);
    const timer = setTimeout(() => finish(new Error(`CLI fixture did not become ready in ${dir}`)), 30_000);
    watcher.on('error', (error) => finish(error));
    check();
  });
}

/** Creation can precede the write notification: acknowledge only a complete pair of positive PIDs. */
export function fixturePids(dir, fresh = () => true) {
  const file = path.join(dir, 'pids');
  return fixtureReady(dir, () => {
    if (!existsSync(file)) return false;
    const text = readFileSync(file, 'utf8');
    if (!/^[1-9]\d* [1-9]\d*$/.test(text)) return false;
    const pids = text.split(' ').map(Number);
    return fresh(pids) && pids;
  });
}
