#!/usr/bin/env node
// A stand-in for Fleet's `fleet` CLI, for studio/test/generate.test.js. It mimics what the
// fleet adapter relies on: state in ${FLEET_DATA:-~/.fleet}/<repo basename>, `up` registering
// the repo, `spawn` checking its flags, raises appended to $STATE/inbox.jsonl, `send` marking
// raises answered (rewriting the file), `done`. STUB_FLEET_MODE picks the worker's behaviour.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [cmd, ...args] = process.argv.slice(2);
const cwd = process.cwd();
const mode = process.env.STUB_FLEET_MODE || 'ok';
if (process.env.STUB_FLEET_LOG) {
  fs.appendFileSync(
    process.env.STUB_FLEET_LOG,
    JSON.stringify({ cmd, args, cwd, FLEET_STATE: process.env.FLEET_STATE ?? null,
      FLEET_DATA: process.env.FLEET_DATA ?? null }) + '\n',
  );
}
const die = (msg) => {
  process.stderr.write(`fleet: ${msg}\n`);
  process.exit(1);
};
if (process.env.FLEET_STATE) die('FLEET_STATE must be unset for a script-driven fleet');
let repo;
try {
  repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
} catch {
  die('not in a git repo');
}
const state = path.join(process.env.FLEET_DATA || path.join(process.env.HOME, '.fleet'), path.basename(repo));
const inbox = path.join(state, 'inbox.jsonl');
const raise = (from, kind, msg) =>
  fs.appendFileSync(inbox, JSON.stringify({ at: new Date().toISOString(), from, kind, msg, answered: false }) + '\n');
const look = path.join(repo, 'look.json');
const finish = (name) => {
  fs.copyFileSync(process.env.STUB_FLEET_LOOK, look);
  // The worker's bake (check.mjs --bake), when the test hands one over.
  if (process.env.STUB_FLEET_FRAMES) {
    const frames = path.join(repo, 'frames.fseq');
    if (mode === 'frames-symlink') fs.symlinkSync(process.env.STUB_FLEET_FRAMES, frames);
    else fs.copyFileSync(process.env.STUB_FLEET_FRAMES, frames);
  }
  if (process.env.STUB_FLEET_STATS) fs.copyFileSync(process.env.STUB_FLEET_STATS, path.join(repo, 'stats.json'));
  raise(name, 'report', `${look} ${path.join(repo, 'frames.fseq')} ${path.join(repo, 'stats.json')} A stub look`);
};

switch (cmd) {
  case 'up':
    if (args.join(' ') !== '--no-coordinator') die('expected up --no-coordinator');
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, 'repo'), repo + '\n');
    fs.appendFileSync(inbox, '');
    break;
  case 'spawn': {
    const name = args[0];
    const flag = (f) => args.includes(f);
    const value = (f) => args[args.indexOf(f) + 1];
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name || '')) die('a name is lowercase letters, digits and dashes');
    if (!flag('--here') || !flag('--box')) die('expected --here --box');
    if (!/^gpt-/.test(value('--model') || '')) die('boxed workers need a gpt-* model');
    if (!(value('--brief') || '').includes('BRIEF.md')) die('brief should point at BRIEF.md');
    if (!fs.existsSync(path.join(repo, 'BRIEF.md'))) die('no BRIEF.md');
    if (!fs.existsSync(path.join(state, 'repo'))) die('no fleet session: fleet up first');
    if (mode === 'fail-spawn') die('--box requires bubblewrap');
    if (mode === 'ok' || mode === 'frames-symlink') finish(name);
    if (mode === 'stuck') raise(name, 'stuck', 'Which colour should the spires be?');
    if (mode === 'symlink') {
      fs.symlinkSync(process.env.STUB_FLEET_SECRET, look);
      raise(name, 'report', `${look} sneaky`);
    }
    if (mode === 'elsewhere') {
      // Reports a path outside its checkout; the adapter must read only its own look.json.
      raise(name, 'report', `${process.env.STUB_FLEET_SECRET} elsewhere`);
    }
    break;
  }
  case 'send': {
    const [name, msg] = args;
    if (!msg) die('usage: fleet send <name> "msg"');
    // Mark this worker's raises answered by rewriting the file, as fleet does.
    const rows = fs.readFileSync(inbox, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    fs.writeFileSync(inbox, rows.map((r) => JSON.stringify(r.from === name ? { ...r,
      answered: true } : r) + '\n').join(''));
    if (mode === 'stuck') finish(name);
    break;
  }
  case 'done':
    break;
  default:
    die(`no command '${cmd}'`);
}
