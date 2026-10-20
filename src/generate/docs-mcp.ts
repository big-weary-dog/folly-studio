// The codex adapter's one tool: a stdio MCP server (newline-delimited JSON-RPC) with `read_doc`, serving the library
// docs as written under <root>, and nothing else. Codex starts it for a call (SPEC-generators "codex"); the shell
// stays off, so this is all the model can read. A path must name a file whose real path (symlinks followed) is inside
// the root; each read is appended to <reads>, at most <cap> reads.
//   node docs-mcp.ts <root> <reads file> [cap]

import { appendFileSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';

import { READ_CAP, READ_DOC_DESCRIPTION, readInside } from './doc-path.ts';

const [rootArg = '', readsFile = '', capArg] = process.argv.slice(2);
const root = realpathSync(rootArg), cap = Number(capArg) || READ_CAP;
let reads = 0;

function call(args: Record<string, unknown> | undefined) {
  if (reads >= cap) return { text: `The limit of ${cap} reads is reached: compose the look now.`, error: true };
  const found = readInside(root, args?.path);
  if (!found) {
    return { text: `No such doc: ${String(args?.path).slice(0, 80)}. Start at library/README.md.`, error: true };
  }
  reads++;
  appendFileSync(readsFile, `${found.rel}\n`);
  return { text: found.text, error: false };
}

const TOOL = { name: 'read_doc', description: READ_DOC_DESCRIPTION, annotations: { readOnlyHint: true },
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } };
const send = (msg: object) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  let m: { id?: number | string, method?: string, params?: Record<string, any> };
  try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return; // a notification
  if (m.method === 'initialize') {
    send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} }, serverInfo: { name: 'folly-docs', version: '1' } } });
  } else if (m.method === 'tools/list') send({ id: m.id, result: { tools: [TOOL] } });
  else if (m.method === 'tools/call' && m.params?.name === 'read_doc') {
    const r = call(m.params.arguments);
    send({ id: m.id, result: { content: [{ type: 'text', text: r.text }], isError: r.error } });
  } else if (m.method === 'ping') send({ id: m.id, result: {} });
  else send({ id: m.id, error: { code: -32601, message: 'method not found' } });
});
