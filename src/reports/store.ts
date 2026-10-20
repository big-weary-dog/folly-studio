// F8 bug reports on disk (SPEC "Bug reports"): <dir>/<stamp>-<id>/report.json, with the server's side added, and
// shot.jpg beside it. Only folders named as save() names them are read; age comes from that name, never from what
// the page said. The newest `keep` within `maxBytes` and `days` stay. tools/reports.ts reads the same folders.
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { REPORT_ID, type ReportBody, type ReportSummary } from '../../shared/schemas/report.ts';
import type { Logger } from '../http.ts';

const DAY_MS = 86_400_000;
const FOLDER = /^(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d)-([a-z0-9]{6,24})$/;
const JPEG = /^data:image\/jpeg;base64,/;
const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** A saved report's folders, newest first: its id and the time the server saved it. */
export async function reportFolders(dir: string) {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  return names.flatMap((name) => {
    const m = FOLDER.exec(name);
    if (!m) return [];
    const at = `${m[1]!.replace(/T(\d\d)-(\d\d)-(\d\d)$/, 'T$1:$2:$3')}Z`;
    return [{ name, id: m[2]!, at, ms: Date.parse(at) }];
  }).sort((a, b) => b.ms - a.ms || b.id.localeCompare(a.id));
}

/** The admin list's line for a saved report. */
export function summaryOf(id: string, at: string, r: Record<string, any>, shot: boolean): ReportSummary {
  const studio = r.sources?.studio, live = r.sources?.live;
  return { id, at, user: text(r.server?.user?.username), path: text(r.page?.path),
    look: text(studio?.look?.title) || text(live?.look?.title), note: text(r.note).split(/\r?\n/)[0]!.slice(0, 200),
    shot };
}

export function createReports({ dir, keep = 500, maxBytes = 500 * 2 ** 20, days = 60, log }: { dir: string,
  keep?: number, maxBytes?: number, days?: number, log?: Logger }) {
  const find = async (id: string) => (REPORT_ID.test(id)
    ? (await reportFolders(dir)).find((f) => f.id === id) ?? null : null);
  let pruning: Promise<void> | null = null;

  /** Folders past the newest `keep`, past `maxBytes` in all or older than `days` removed, oldest first. */
  async function prune(now = Date.now()) {
    let total = 0, count = 0;
    for (const f of await reportFolders(dir)) {
      const at = path.join(dir, f.name);
      const files = await fs.readdir(at).catch(() => [] as string[]);
      const sizes = await Promise.all(files.map((n) => fs.stat(path.join(at, n)).then((s) => s.size, () => 0)));
      total += sizes.reduce((a, b) => a + b, 0);
      if (++count <= keep && total <= maxBytes && f.ms >= now - days * DAY_MS) continue;
      await fs.rm(at, { recursive: true, force: true }).catch(() => {});
    }
  }
  const sweep = () => {
    pruning ??= prune().catch((err) => { log?.warn?.('[reports] prune failed:', err); })
      .finally(() => { pruning = null; });
    return pruning;
  };

  return {
    dir, prune, sweep,
    /** Saves `body` with the server's side; resolves to the new report's id. */
    async save(body: ReportBody, server: Record<string, unknown>) {
      const id = Date.now().toString(36) + randomBytes(4).toString('hex');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const at = path.join(dir, `${stamp}-${id}`);
      const { screenshot, ...rest } = body;
      await fs.mkdir(at, { recursive: true });
      if (screenshot && JPEG.test(screenshot)) {
        await fs.writeFile(path.join(at, 'shot.jpg'), Buffer.from(screenshot.replace(JPEG, ''), 'base64'));
      }
      await fs.writeFile(path.join(at, 'report.json'), JSON.stringify({ id, ...rest, server }, null, 1));
      void sweep();
      return id;
    },
    /** Summaries, newest first. */
    async list(): Promise<ReportSummary[]> {
      const out: ReportSummary[] = [];
      for (const f of await reportFolders(dir)) {
        const r = await fs.readFile(path.join(dir, f.name, 'report.json'), 'utf8').then(JSON.parse, () => null);
        const shot = await fs.stat(path.join(dir, f.name, 'shot.jpg')).then(() => true, () => false);
        if (r && typeof r === 'object') out.push(summaryOf(f.id, f.at, r, shot));
      }
      return out;
    },
    /** A whole report (with `savedAt` and `shot`), or null. */
    async get(id: string) {
      const f = await find(id);
      if (!f) return null;
      const r = await fs.readFile(path.join(dir, f.name, 'report.json'), 'utf8').then(JSON.parse, () => null);
      const shot = await fs.stat(path.join(dir, f.name, 'shot.jpg')).then(() => true, () => false);
      return r ? { ...r, id: f.id, savedAt: f.at, shot } : null;
    },
    /** A report's JPEG bytes, or null. */
    async shot(id: string) {
      const f = await find(id);
      return f ? fs.readFile(path.join(dir, f.name, 'shot.jpg')).catch(() => null) : null;
    },
  };
}
export type Reports = ReturnType<typeof createReports>;
