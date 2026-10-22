// An F8 bug report as the page sends it (SPEC "Bug reports"). The server checks its shape and sizes and keeps the
// rest as data: only admins read it back.
import { z } from 'zod';

const REPORT_FORMAT = 1;
/** A report's id, as the server makes it: in file names, so strict. */
export const REPORT_ID = /^[a-z0-9]{6,24}$/;
const JPEG = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const piece = z.unknown().optional();

export const ReportBody = z.object({
  format: z.literal(REPORT_FORMAT),
  at: z.string().max(40),
  note: z.string().max(4000, { error: 'The note must be at most 4000 characters.' }),
  build: z.string().max(64).optional(),
  page: z.record(z.string(), z.unknown()).optional(),
  toasts: piece, errors: piece, dialogs: piece,
  sources: z.record(z.string(), z.unknown()).optional(),
  screenshot: z.string().max(2_800_000).regex(JPEG, { error: 'The screenshot must be a JPEG data URL.' }).nullish(),
});
export type ReportBody = z.output<typeof ReportBody>;

/** A report in the admin list. */
export type ReportSummary = { id: string, at: string, user: string, look: string, path: string, note: string,
  shot: boolean };
