// The library as the repo has it: public/patterns/'s index and each module's code.
import { readFileSync } from 'node:fs';

const PATTERNS = new URL('../../public/patterns/', import.meta.url);

/** public/patterns/<name>.js. */
export const libraryCode = (name) => readFileSync(new URL(`${name}.js`, PATTERNS), 'utf8');

/** public/patterns/index.json, as written. */
export const libraryIndex = () => JSON.parse(readFileSync(new URL('index.json', PATTERNS), 'utf8'));

/** An index entry with its code, as the server lists it: a preset's is ''. */
export const withCode = (e) => ({ ...e, code: e.kind === 'preset' ? '' : libraryCode(e.name) });
