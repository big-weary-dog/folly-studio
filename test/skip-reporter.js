// A Vitest reporter: after a run, every skipped test and why, one `SKIP <file> > <test>: <reason>` line each, so a
// plain `npm test` says why (a skip is not a pass) and CI's "Report skipped tests" step can turn them into warnings.
// Tests skip with `ctx.skip(condition, reason)`; a skip without a reason says so.
export default class SkipReporter {
  onInit(ctx) {
    this.ctx = ctx;
  }

  onTestRunEnd(modules) {
    const lines = modules.flatMap((m) => [...m.children.allTests('skipped')]
      .map((t) => `SKIP ${m.relativeModuleId} > ${t.fullName}: ${t.result().note || 'no reason given'}`));
    if (lines.length) this.ctx.logger.log(`\n${lines.join('\n')}\n`);
  }
}
