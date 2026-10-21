// The transports' modules (SPEC "Models"): how each makes its adapter for one model of the registry, and whether it
// can run here. What each transport may do is TRANSPORT_CAPS (shared/schemas/models.ts).
import type { ModelEntry, Transport } from '../../shared/schemas/models.ts';
import type { Config } from '../config.ts';
import type { Logger } from '../http.ts';
import * as claude from './claude.ts';
import * as codex from './codex.ts';
import * as fleet from './fleet.ts';
import type { Adapter, Context } from './index.ts';
import * as sketch from './sketch.ts';

/** `warn`: it may run, but something looks missing (no Codex login seen). */
export type Availability = { available: boolean, note: string, warn?: boolean };
/** What a probe looks at: the environment, the Codex CLI's name, whether the foundry is on. */
export type Probe = { env: NodeJS.ProcessEnv, codexBin: string, foundryOn: boolean };
type Made = { log: Logger, codexBin?: string, config?: Config };
type Module = { create(m: ModelEntry | undefined, o: Made): Adapter, probe(o: Probe): Availability };

const timeoutOf = (m?: ModelEntry) => (m?.timeoutSeconds ? m.timeoutSeconds * 1000 : undefined);

export const ADAPTERS: Record<Transport, Module> = {
  claude: { probe: claude.probe, create: (m, { log, config }) => claude.createClaudeAdapter({ log, config,
    model: m?.model, effort: m?.effort, maxTokens: m?.maxTokens, timeoutMs: timeoutOf(m) }) },
  codex: { probe: codex.probe, create: (m, { log, codexBin, config }) => codex.createCodexAdapter({ log, config,
    model: m?.model, effort: m?.effort, timeoutMs: timeoutOf(m), bin: codexBin }) },
  fleet: { probe: fleet.probe, create: (m, { log, config }) => fleet.createFleetAdapter({ log, config,
    model: m?.model, timeoutMs: timeoutOf(m) }) },
  sketch: { probe: sketch.probe,
    create: () => ({ name: 'sketch', generate: async (ctx: Context) => sketch.sketchLook(ctx) }) },
};
