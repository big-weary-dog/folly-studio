#!/usr/bin/env node
// Seed an empty data dir for a dev studio from another's (docs/HOSTING.md "Dev instance"), reading the source only.
//
//   node tools/seed-dev.ts --from <source data dir> --to <empty target dir>
//
// It copies the shared looks (each with its baked frames and gallery previews), the light settings and the model
// registry. Never users, sessions or invites; nor ideas, their logs, reports or the live stage, which belong to
// people the dev studio does not have. A copied look keeps its owner's id and name, so the gallery shows who made
// it, but no account in the dev studio owns it: it is everyone's to open, play and remix, no one's to edit. Its
// ideaId is dropped, since the idea stays behind. Unshared looks stay behind too: in the dev studio no one could
// see them. The target must be empty (or not exist) and must not be the source or inside it.

import { constants as FS, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { snapshot } from './backup.ts';

type Doc = Record<string, unknown> & { id: string };

/** A collection file's documents, as the store reads them (an array, or { items }). */
function docs(body: Buffer | undefined, name: string): Doc[] {
  if (!body) return [];
  const data = JSON.parse(body.toString('utf8'));
  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
  if (!items) throw new Error(`seed-dev: ${name} does not hold an array`);
  return items.filter((d: unknown): d is Doc => typeof (d as Doc)?.id === 'string');
}

/** The file at `from` copied to `to`, which must not exist yet; false when there is none to copy. */
async function copyIn(from: string, to: string) {
  const src = await fs.open(from, FS.O_RDONLY | FS.O_NOFOLLOW).catch(() => null);
  if (!src) return false;
  try {
    if (!(await src.stat()).isFile()) return false;
    await fs.writeFile(to, await src.readFile(), { flag: 'wx', mode: 0o600 });
    return true;
  } finally {
    await src.close();
  }
}

/** seedDev({ from, to }) → { looks, frames, previews, files }: what it copied. */
export async function seedDev({ from, to }: { from: string, to: string }) {
  const source = await fs.realpath(from);
  const target = path.resolve(to);
  // Where the target is, or would be, before anything is made: its parent must exist.
  const real = await fs.realpath(target).catch(async () => path.join(await fs.realpath(path.dirname(target)),
    path.basename(target)));
  if (real === source || real.startsWith(source + path.sep)) {
    throw new Error(`seed-dev: ${to} is the source or inside it: seed a separate folder`);
  }
  await fs.mkdir(real, { recursive: true, mode: 0o700 });
  if ((await fs.readdir(real)).length) throw new Error(`seed-dev: ${to} is not empty: seed only an empty folder`);

  const files = new Map((await snapshot(source)).map((f) => [f.name, f.body]));
  const names = new Map(docs(files.get('users.json'), 'users.json').map((u) => [u.id, u.username]));
  const looks = docs(files.get('looks.json'), 'looks.json').filter((l) => l.shared === true).map((look) => {
    const { ideaId: _, ...rest } = look;
    const name = names.get(look.owner as string);
    return typeof name === 'string' ? { ...rest, ownerName: name } : rest;
  });
  const write = (name: string, body: string | Buffer) => fs.writeFile(path.join(real, name), body,
    { flag: 'wx', mode: 0o600 });
  await write('looks.json', looks.length ? `[\n${looks.map((v) => JSON.stringify(v)).join(',\n')}\n]\n` : '[]\n');
  const copied = ['looks.json'];
  for (const name of ['light.json', 'models.json']) {
    const body = files.get(name);
    if (body) { await write(name, body); copied.push(name); }
  }

  await fs.mkdir(path.join(real, 'frames'), { mode: 0o700 });
  await fs.mkdir(path.join(real, 'previews'), { mode: 0o700 });
  const ids = new Set(looks.map((l) => l.id));
  let frames = 0, previews = 0;
  for (const id of ids) {
    if (await copyIn(path.join(source, 'frames', `${id}.fseq`), path.join(real, 'frames', `${id}.fseq`))) frames++;
  }
  // A preview is <lookId>-<key>.webp or <lookId>-<key>-still.webp (src/previews/index.ts's FILE).
  for (const name of await fs.readdir(path.join(source, 'previews')).catch(() => [] as string[])) {
    const m = /^([A-Za-z0-9_-]{1,64})-[0-9a-f]{16}(?:-still)?\.webp$/.exec(name);
    if (m && ids.has(m[1]!) && await copyIn(path.join(source, 'previews', name), path.join(real, 'previews', name))) {
      previews++;
    }
  }
  return { looks: looks.length, frames, previews, files: copied };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const from = opt('--from'), to = opt('--to');
  if (!from || !to) {
    process.stderr.write('usage: node tools/seed-dev.ts --from <source data dir> --to <empty target dir>\n');
    process.exit(2);
  }
  try {
    const r = await seedDev({ from, to });
    process.stdout.write(`${to}: ${r.looks} shared looks, ${r.frames} baked, ${r.previews} preview files; `
      + `${r.files.join(', ')}\n`);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(1);
  }
}
