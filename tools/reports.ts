// Bug reports straight from STUDIO_DATA (SPEC "Bug reports"), for a worker reproducing one:
//   node tools/reports.ts list            newest first: id, saved, user, page, look, the note's first line
//   node tools/reports.ts get <id>        the whole report as JSON (its shot: <folder>/shot.jpg, path on stderr)
import path from 'node:path';

import { DEFAULT_DATA_DIR } from '../src/app.ts';
import { createReports } from '../src/reports/store.ts';

const dir = path.join(process.env.STUDIO_DATA || DEFAULT_DATA_DIR, 'reports');
const reports = createReports({ dir });
const [cmd, id] = process.argv.slice(2);

if (cmd === 'list') {
  for (const r of await reports.list()) {
    console.info([r.id, r.at, r.user, r.path, r.look, r.shot ? 'shot' : '', r.note].join('\t'));
  }
} else if (cmd === 'get' && id) {
  const report = await reports.get(id);
  if (!report) { console.error(`No report ${id} in ${dir}.`); process.exit(1); }
  console.info(JSON.stringify(report, null, 1));
  if (report.shot) console.error(`shot: ${dir}/${report.savedAt.replace(/[:]/g, '-').slice(0, 19)}-${id}/shot.jpg`);
} else {
  console.error('Usage: node tools/reports.ts list | get <id>   (STUDIO_DATA: the data folder)');
  process.exit(2);
}
