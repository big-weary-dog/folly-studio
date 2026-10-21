// The tutorial's progress on an account (SPEC-access "Accounts", SPEC "The tutorial"): PUT /api/me/tour's body.
import { z } from 'zod';

const Id = z.string().regex(/^[a-z0-9-]{1,32}$/, { error: 'A tour path or step is 1–32 of a-z, 0-9 and -.' });
export const Tour = z.strictObject({
  seen: z.literal(true, { error: 'tour.seen must be true.' }),
  done: z.array(Id).max(16, { error: 'At most 16 tour paths are done.' }),
  at: z.strictObject({ path: Id, step: Id }).optional(),
});
export type Tour = z.output<typeof Tour>;
