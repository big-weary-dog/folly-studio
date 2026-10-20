// The library's docs for the AI builders (SPEC-generators "Library docs"): a tree of markdown the models read with
// read_doc. Prose is hand-written per module in library-docs/<name>.md; types, ranges, defaults, options and units
// come from the catalogue and recipes from the index, so the tree follows the library and never drifts from it.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { MODULE_KINDS } from '../../public/js/pattern-core.ts';
import type { PresetEntry } from '../../shared/schemas/rig.ts';
import type { Catalog, ParamDecl } from './catalog.ts';

export const PROSE_DIR = fileURLToPath(new URL('../../library-docs/', import.meta.url));
/** Prose files that are not a module's: the tree's README and each kind's intro. */
const INTROS = ['README', 'sources', 'warps', 'filters', 'presets'];

export type Prose = { looks: string, about: string, sections: { title: string, body: string }[] };
type Docs = Map<string, string>;

/** Every prose file, by name (`bars`, `README`). */
export function loadProse(dir = PROSE_DIR): Map<string, string> {
  let files: string[];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); } catch { return new Map(); }
  return new Map(files.map((f) => [f.slice(0, -3), readFileSync(`${dir}/${f}`, 'utf8')]));
}

/** A prose file: its `looks:` line, the paragraph before the first `##`, and its sections. */
export function parseProse(text: string): Prose {
  const t = text.replace(/\r\n?/g, '\n');
  const front = /^---\n([\s\S]*?)\n---\n/.exec(t);
  const looks = front ? /^looks:\s*(.+)$/m.exec(front[1]!)?.[1]?.trim() ?? '' : '';
  const [about = '', ...rest] = (front ? t.slice(front[0].length) : t).split(/^## /m);
  const sections = rest.map((s) => {
    const nl = s.indexOf('\n');
    return { title: (nl < 0 ? s : s.slice(0, nl)).trim(), body: nl < 0 ? '' : s.slice(nl + 1).trim() };
  });
  return { looks, about: about.trim(), sections };
}

/** A section's bullets as `name: text`, continuation lines joined; keyed by the name before the first colon. */
export function bullets(body = ''): Map<string, string> {
  const out = new Map<string, string>();
  let key = '';
  for (const line of body.split('\n')) {
    const m = /^- ([\w#.-]+):\s*(.*)$/.exec(line);
    if (m) out.set(key = m[1]!, m[2]!);
    else if (key && /^\s+\S/.test(line)) out.set(key, `${out.get(key)} ${line.trim()}`);
    else key = '';
  }
  return out;
}

const section = (p: Prose, title: string) => p.sections.find((s) => s.title === title)?.body;
const unit = (d: ParamDecl) => /\(([^)]+)\)\s*$/.exec(d.label ?? '')?.[1];
const num = (n: number) => String(+n.toFixed(3));

/** A param's facts, as one bullet's head: `**speed** (number -2..2, default 0.4; bars a second)`. */
function paramHead(name: string, d: ParamDecl) {
  const what = d.type === 'number' ? `number ${num(d.min)}..${num(d.max)}, default ${num(d.value)}`
    : d.type === 'color' ? `pick, default \`${d.value}\`${d.blend === 'smooth' ? ', blended smooth' : ''}`
    : d.type === 'toggle' ? `on/off, default ${d.value ? 'on' : 'off'}`
    : `${d.options.join(' | ')}; default \`${d.value}\``;
  const u = unit(d);
  return `**${name}** (${what}${u ? `; ${u}` : ''})`;
}

const STOCK: Record<string, string> = {
  colours: 'the colours it draws with, a pick of the look\'s palette (a role, slots, `rainbow` or `#rrggbb`).',
  direction: 'which way it moves or faces.',
};

/** The refs of a preset's recipe in order, the second of a name as `name#2` (as overrides name them). */
export function recipeRefs(p: PresetEntry) {
  const seen = new Map<string, number>();
  return p.layers.flatMap((l) => l.modules).map((m) => {
    const n = (seen.get(m.ref) ?? 0) + 1;
    seen.set(m.ref, n);
    return n > 1 ? `${m.ref}#${n}` : m.ref;
  });
}

function presetRecipe(p: PresetEntry) {
  const refs = recipeRefs(p);
  let i = 0;
  return p.layers.map((l, li) => `${p.layers.length > 1 ? `Layer ${li + 1}:\n` : ''}${l.modules.map((m) => {
    const ref = refs[i++]!, extra = [m.blend && `blend ${m.blend}`, m.id && `id ${m.id}`, m.as && `as ${m.as}`,
      m.input && `input ${m.input}`].filter(Boolean).join(', ');
    const params = m.params && Object.keys(m.params).length ? ` ${JSON.stringify(m.params)}` : '';
    return `${i}. ${ref}${params}${extra ? ` (${extra})` : ''}`;
  }).join('\n')}`).join('\n\n');
}

const kindDir = (kind: string) => `library/${kind}s`;
const passOn = (p: Prose, skip: string[]) => p.sections.filter((s) => !skip.includes(s.title))
  .map((s) => `## ${s.title}\n${s.body}`);

/** The whole tree, path → markdown. Pure: the same library and prose give the same bytes. */
export function buildDocs(catalog: Catalog, prose: ReadonlyMap<string, string> = new Map()): Docs {
  const docs: Docs = new Map(), read = (name: string) => parseProse(prose.get(name) ?? '');
  const lineOf = (name: string, summary?: string) => read(name).looks || String(summary ?? '').trim();
  const kinds: [string, { name: string, title?: string, summary?: string }[]][] = [
    ...MODULE_KINDS.map((k) => [k, [...catalog.modules.values()].filter((m) => (m.kind ?? 'source') === k)] as
      [string, { name: string }[]]),
    ['preset', [...catalog.presets.values()]]];
  for (const [kind, list] of kinds) {
    const index = list.map((m) => {
      const p = read(m.name);
      return `## ${m.name}${m.title ? ` — ${m.title}` : ''}\n${lineOf(m.name, m.summary)}${p.about ? `\n\n${p.about}`
        : ''}\nDocs: ${kindDir(kind)}/${m.name}.md`;
    });
    const intro = read(`${kind}s`);
    docs.set(`${kindDir(kind)}/README.md`, [`# ${kind[0]!.toUpperCase()}${kind.slice(1)}s`, intro.about,
      ...passOn(intro, []), ...index].filter(Boolean).join('\n\n') + '\n');
  }
  for (const m of catalog.modules.values()) {
    const p = read(m.name), said = bullets(section(p, 'Params'));
    const params = Object.entries(m.params).map(([n, d]) => `- ${paramHead(n, d)}: ${
      said.get(n) ?? STOCK[n] ?? d.label ?? ''}`);
    docs.set(`${kindDir(m.kind ?? 'source')}/${m.name}.md`, [
      `# ${m.name} — ${m.title ?? m.name} (${m.kind ?? 'source'}${m.category ? `, ${m.category}` : ''})`,
      lineOf(m.name, m.summary), p.about,
      params.length ? `## Params\n${params.join('\n')}` : '## Params\nNone.',
      ...passOn(p, ['Params'])].filter(Boolean).join('\n\n') + '\n');
  }
  for (const pr of catalog.presets.values()) {
    const p = read(pr.name);
    docs.set(`library/presets/${pr.name}.md`, [`# ${pr.name} — ${pr.title ?? pr.name} (preset${
      pr.category ? `, ${pr.category}` : ''})`, lineOf(pr.name, pr.summary), p.about,
    `## Recipe\nUse it as \`{ "preset": "${pr.name}" }\`; it expands to this chain, top to bottom (each module's `
      + `other params at their defaults):\n${presetRecipe(pr)}`, ...passOn(p, [])].filter(Boolean).join('\n\n') + '\n');
  }
  const top = read('README'), count = (dir: string) => [...docs.keys()]
    .filter((k) => k.startsWith(`${dir}/`) && !k.endsWith('README.md')).length;
  docs.set('library/README.md', [`# The library`, top.about, ...passOn(top, []), `## The tree\n${
    kinds.map(([k]) => `- ${kindDir(k)}/README.md: ${count(kindDir(k))} ${k}s, a paragraph each`).join('\n')}`]
    .filter(Boolean).join('\n\n') + '\n');
  return new Map([...docs].sort(([a], [b]) => a.localeCompare(b)));
}

/** What the prompt's summary shows for each entry that has prose. */
export const looksOf = (prose: ReadonlyMap<string, string>) => new Map([...prose]
  .filter(([n]) => !INTROS.includes(n)).map(([n, t]): [string, string] => [n, parseProse(t).looks])
  .filter(([, l]) => l));

/** Prose against the library: entries without prose (`missing`), and prose that names what the library lacks. */
export function lintDocs(catalog: Catalog, prose: ReadonlyMap<string, string>) {
  const missing: string[] = [], errors: string[] = [];
  for (const name of [...catalog.modules.keys(), ...catalog.presets.keys()]) if (!prose.has(name)) missing.push(name);
  for (const [name, text] of prose) {
    if (INTROS.includes(name)) continue;
    const p = parseProse(text), m = catalog.modules.get(name), pr = catalog.presets.get(name);
    if (!m && !pr) { errors.push(`${name}.md: no library entry ${name}`); continue; }
    if (!p.looks) errors.push(`${name}.md: no looks: line`);
    if (!p.about) errors.push(`${name}.md: no paragraph`);
    if (m) {
      for (const n of bullets(section(p, 'Params')).keys()) {
        if (!(n in m.params)) errors.push(`${name}.md: param ${n} is not ${name}'s`);
      }
    } else if (pr) {
      const refs = recipeRefs(pr);
      for (const key of bullets(section(p, 'Overrides')).keys()) {
        const [ref = '', param = ''] = key.split('.'), mod = catalog.modules.get(ref.replace(/#\d+$/, ''));
        if (!refs.includes(ref)) errors.push(`${name}.md: override ${key}: ${ref} is not in its recipe`);
        else if (!mod || !(param in mod.params)) errors.push(`${name}.md: override ${key}: no param ${param}`);
      }
    }
  }
  return { missing, errors };
}
