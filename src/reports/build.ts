// The build a bug report names: GIT_SHA, else the checkout's HEAD read from .git (a worktree's too), else ''.
// vite.config.js puts it in the app as __BUILD__; the server adds its own to each report.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) => { try { return readFileSync(file, 'utf8').trim(); } catch { return ''; } };

/** The short commit `root` (a folder in the checkout) is at; `given`: GIT_SHA. */
export function buildSha(root: string, given = process.env.GIT_SHA): string {
  if (given) return given.slice(0, 12);
  let dir = path.resolve(root), git = '';
  for (let i = 0; i < 8 && !git; i++, dir = path.dirname(dir)) {
    const dot = path.join(dir, '.git'), file = read(dot);
    git = file.startsWith('gitdir:') ? path.resolve(dir, file.slice(7).trim()) : read(path.join(dot, 'HEAD')) ? dot
      : '';
  }
  if (!git) return '';
  const head = read(path.join(git, 'HEAD'));
  if (!head.startsWith('ref:')) return head.slice(0, 12);
  const ref = head.slice(4).trim(), common = read(path.join(git, 'commondir'));
  const base = common ? path.resolve(git, common) : git;
  const sha = read(path.join(git, ref)) || read(path.join(base, ref))
    || read(path.join(base, 'packed-refs')).split('\n').find((l) => l.endsWith(` ${ref}`))?.split(' ')[0] || '';
  return sha.slice(0, 12);
}
