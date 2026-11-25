// The docs hold together (SPEC.md "The area files"): every relative link in a Markdown file reaches its file and
// heading, and every section a file names as `spec/<area> "<section>"` or `SPEC "<section>"` is there.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root,
  encoding: 'utf8' }).split('\0').filter((f) => /\.(?:md|[cm]?[jt]sx?|css|html|sh|py|jsonc)$/.test(f)
  && existsSync(path.join(root, f)));
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const SPECS = readdirSync(path.join(root, 'spec')).filter((f) => f.endsWith('.md')).map((f) => `spec/${f}`);

/** GitHub's anchor for a heading. */
const slug = (h: string) => h.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');
/** A Markdown file's headings, `<a id>`s and bold leads (`**Simple.**`), as written and as anchors. */
function sections(rel: string) {
  const text = read(rel).replace(/^```[^]*?^```/gm, '');
  const names = [...text.matchAll(/^#{1,6} (.+)$/gm)].map((m) => m[1]!.replace(/`/g, ''));
  const anchors = new Set([...names.map(slug), ...[...text.matchAll(/<a id="([^"]+)">/g)].map((m) => m[1]!)]);
  const leads = [...text.matchAll(/^(?:- |\d+\. )?(?:<a id="[^"]+"><\/a>)?\*\*([^*]+?)\.?\*\*/gm)].map((m) => m[1]!);
  return { names: [...names, ...leads], anchors };
}
const known = new Map([...SPECS, 'SPEC.md'].map((f) => [f, sections(f)]));
/** Whether `quoted` (a comment's line breaks and markers in it) is a section of `rel`: the whole heading or lead, or
 * the part before its gloss (" (…)", ": …"). A placeholder (`<section>`) is none. */
function has(rel: string, quoted: string) {
  const name = quoted.replace(/\s*\n\s*(?:\*|\/\/|#)?\s*/g, ' ');
  return name.startsWith('<') || known.get(rel)!.names
    .some((s) => s === name || s.startsWith(`${name} (`) || s.startsWith(`${name}:`));
}

test('every relative Markdown link reaches its file and heading', () => {
  const broken: string[] = [];
  for (const rel of files.filter((f) => f.endsWith('.md'))) {
    const text = read(rel).replace(/^```[^]*?^```/gm, '').replace(/`[^`\n]*`/g, '');
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/.test(target!)) continue;
      const [file, anchor] = target!.split('#') as [string, string?];
      const to = file ? path.posix.normalize(path.posix.join(path.posix.dirname(rel), file)) : rel;
      if (!existsSync(path.join(root, to))) broken.push(`${rel}: ${target} (no ${to})`);
      else if (anchor && to.endsWith('.md') && !(known.get(to) ?? sections(to)).anchors.has(anchor)) {
        broken.push(`${rel}: ${target} (no heading #${anchor})`);
      }
    }
  }
  assert.deepEqual(broken, []);
});

test('every spec/<area> "<section>" and SPEC "<section>" names a section that is there', () => {
  const broken: string[] = [];
  for (const rel of files) {
    const text = read(rel);
    for (const [ref, area, name] of text.matchAll(/\bspec\/([a-z]+) "([^"]+)"/g)) {
      const file = `spec/${area}.md`;
      if (!known.has(file) || !has(file, name!)) broken.push(`${rel}: ${ref}`);
    }
    for (const [ref, name] of text.matchAll(/\bSPEC(?:\.md)? "([^"]+)"/g)) {
      if (![...known.keys()].some((f) => has(f, name!))) broken.push(`${rel}: ${ref}`);
    }
  }
  assert.deepEqual(broken, []);
});
