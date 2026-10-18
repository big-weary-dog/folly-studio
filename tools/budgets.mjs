#!/usr/bin/env node
// The half of `npm run lint` oxlint cannot do (.oxlintrc.jsonc is the rest), over every file git tracks or would
// add: sizes, hygiene, line length, max-lines for CSS, HTML and Python, remote URLs in public/'s pages and styles,
// secrets, reasons on oxlint's silences, and each area's lines of code against tools/budgets.json.
//   node tools/budgets.mjs [dir]   one `path:line rule message` per error; exit 1 if there are any
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUDGET_FILE = 'tools/budgets.json';
const KB = 1024;
const MAX_BYTES = 64 * KB, MAX_LINE = 120, CAPS = { 'public/data/rig.json': 1024 * KB }; // generated, committed data
const SKIP = /^(?:data|dist)\/|^package-lock\.json$/;
const CODE = /\.(?:[cm]?[jt]sx?|css|html|py)$/, LINTED = /\.[cm]?[jt]sx?$/, TABLESS = /\.(?:[cm]?[jt]sx?|css|html)$/;
const SECRET = /\bsk-ant-[\w-]{16,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/;
const REMOTE = new RegExp(String.raw`(?:<(?:script|link|iframe|img)\b[^>]*?\b(?:src|href)\s*=\s*|@import\s+|\burl\(\s*)`
  + String.raw`["']?(?:https?:)?//`, 'i');
const HTML_SINK = /\bdangerouslySetInnerHTML\b/;    // JSX's HTML string sink; oxlint bans the DOM's (innerHTML, …)
const DIRECTIVE = /(?:\/\/|\/\*)\s*(?:oxlint|eslint)-(?:disable|enable)(\S*)(.*)/;
const SILENCE = /^\s+([\w/@-]+(?:\s*,\s*[\w/@-]+)*)\s+--\s+\S/; // after -next-line or -line: rules -- reason

const kb = (n) => `${(n / KB).toFixed(1)} KB`;
const maxLines = (rel) => (rel.startsWith('public/patterns/') ? 150 : rel.startsWith('test/') ? 600 : 400);
/** The area a file counts toward: its top folder, or public/<folder>; '.' for files at the root. */
export const areaOf = (rel) => {
  const p = rel.split('/');
  return p.length < 2 ? '.' : p[0] === 'public' && p.length > 2 ? `public/${p[1]}` : p[0];
};
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'] });
const parse = (text) => { try { return JSON.parse(text); } catch { return undefined; } };

/** An oxlint silence is for one line, names its rules (never max-lines) and gives a reason after `--`. */
function badSilence(line) {
  const d = DIRECTIVE.exec(line);
  if (!d) return null;
  const m = /^-(?:next-)?line$/.test(d[1]) && SILENCE.exec(d[2].replace(/\s*\*\/.*$/, ''));
  if (!m) return 'write `oxlint-disable-next-line <rule> -- <reason>` (or -line): one line, its rules, a reason';
  return /\bmax-lines\b/.test(m[1]) ? 'max-lines cannot be silenced: split the file' : null;
}

/**
 * The ratchet: an area over its budget fails, and a budget may rise only with a new `reason` (compared with
 * the committed file). Returns notes on areas well under budget. Either text may be '' (no such file).
 */
export function checkBudget(text, committedText, counts, report) {
  const areas = parse(text)?.areas, committed = parse(committedText)?.areas || {};
  if (!areas) {
    if (!text && Object.keys(committed).length) report(1, 'the committed budget is gone: restore it');
    return [];
  }
  const lineOf = (area) => Math.max(1, text.slice(0, text.indexOf(`"${area}"`)).split('\n').length);
  const notes = [];
  for (const [area, lines] of [...counts].sort()) {
    const b = areas[area], was = committed[area];
    if (!b) { report(1, `${area} has ${lines} lines of code and no budget`); continue; }
    if (lines > b.lines) {
      report(lineOf(area), `${area} has ${lines} lines, over its budget of ${b.lines}: cut, or raise it with a reason`);
    }
    if (was && b.lines > was.lines && (!b.reason || b.reason === was.reason)) {
      report(lineOf(area), `${area}'s budget went up from ${was.lines} without a new reason`);
    }
    if (lines < b.lines * 0.94) notes.push(`${area} is at ${lines} of ${b.lines} lines: lower its budget`);
  }
  return notes;
}

/** Every error in a tree, as { file, line, rule, message }, and notes. */
export function check(root) {
  const errors = [], areas = new Map();
  const files = git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0')
    .filter((rel) => rel && !SKIP.test(rel) && existsSync(path.join(root, rel)));
  for (const rel of [...new Set(files)].sort()) {
    const buf = readFileSync(path.join(root, rel));
    if (buf.includes(0)) continue; // binary
    const report = (line, rule, message) => errors.push({ file: rel, line, rule, message });
    const cap = CAPS[rel] ?? MAX_BYTES, text = buf.toString('utf8'), lines = text.split('\n');
    const count = lines.length - (text.endsWith('\n') ? 1 : 0), code = CODE.test(rel);
    if (buf.length > cap) report(1, 'max-bytes', `${kb(buf.length)} > ${kb(cap)}`);
    if (code) areas.set(areaOf(rel), (areas.get(areaOf(rel)) ?? 0) + count);
    if (code && !LINTED.test(rel) && count > maxLines(rel)) {
      report(maxLines(rel) + 1, 'max-lines', `${count} lines > ${maxLines(rel)}: split it by responsibility`);
    }
    if (text.charCodeAt(0) === 0xfeff) report(1, 'no-bom', 'byte-order mark');
    if (text && !text.endsWith('\n')) report(count, 'final-newline', 'no newline at the end of the file');
    if (rel.endsWith('.json') && parse(text) === undefined) report(1, 'json', 'does not parse as JSON');
    const remote = /^public\/.*\.(?:css|html)$/.test(rel), browser = /^public\/js\/.*\.[jt]sx?$/.test(rel);
    const crlf = lines.findIndex((l) => l.endsWith('\r'));
    if (crlf >= 0) report(crlf + 1, 'no-crlf', 'CRLF line ending');
    lines.forEach((l, i) => {
      l = l.replace(/\r$/, '');
      if (/[ \t]$/.test(l)) report(i + 1, 'trailing-space', 'trailing whitespace');
      if (TABLESS.test(rel) && l.includes('\t')) report(i + 1, 'no-tabs', 'tab: indent with spaces');
      if (code && l.length > MAX_LINE && [...l].length > MAX_LINE) {
        report(i + 1, 'max-line-length', `${[...l].length} characters > ${MAX_LINE}`);
      }
      if (SECRET.test(l)) report(i + 1, 'no-secret', 'secret-looking string: keys come from the environment');
      if (remote && REMOTE.test(l)) report(i + 1, 'no-remote-url', 'remote URL: the app runs offline, self-only CSP');
      if (browser && HTML_SINK.test(l)) report(i + 1, 'no-html-sink', 'HTML string sink: build nodes with JSX');
      const bad = LINTED.test(rel) && badSilence(l);
      if (bad) report(i + 1, 'silence', bad);
    });
  }
  const text = existsSync(path.join(root, BUDGET_FILE)) ? readFileSync(path.join(root, BUDGET_FILE), 'utf8') : '';
  const report = (line, message) => errors.push({ file: BUDGET_FILE, line, rule: 'line-budget', message });
  const notes = checkBudget(text, committed(root, text), areas, report);
  errors.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { errors, notes, files: files.length };
}

/** The budget before the change under review: HEAD's, or its parent's when the tree is HEAD (CI); '' if none. */
function committed(root, text) {
  const show = (rev) => { try { return git(root, 'show', `${rev}:./${BUDGET_FILE}`); } catch { return ''; } };
  const head = show('HEAD');
  return head === text ? show('HEAD~1') : head;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = check(process.argv[2] ? path.resolve(process.argv[2]) : fileURLToPath(new URL('..', import.meta.url)));
  for (const e of r.errors) console.log(`${e.file}:${e.line} ${e.rule} ${e.message}`);
  for (const n of r.notes) console.log(`budgets: ${n}`);
  console.log(`budgets: ${r.errors.length} errors, ${r.files} files checked, ${process.uptime().toFixed(2)} s`);
  process.exitCode = r.errors.length ? 1 : 0;
}
