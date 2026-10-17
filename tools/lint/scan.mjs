// Lexing just good enough for line rules: where comments and string, template and regex literals
// are, as [start, end) ranges, so a view can blank them while keeping every offset and line.

const KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case',
  'do', 'else', 'yield', 'await']);
const BEFORE_REGEX = '(,=:[!&|?{};+-*%<>~^';
const regexMayStart = (prev) => prev === '' || BEFORE_REGEX.includes(prev) || KEYWORDS.has(prev);
const isWord = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36
  || c > 127;

/** [start, end) of each match of a global regex. */
export const ranges = (src, re) => [...src.matchAll(re)].map((m) => [m.index, m.index + m[0].length]);

/** src with each range's characters but newlines turned to spaces. Ranges are sorted. */
export function blank(src, list) {
  let out = '', at = 0;
  for (let [a, b] of list) {
    a = Math.max(a, at);
    if (b <= a) continue;
    out += src.slice(at, a) + src.slice(a, b).replace(/[^\n]/g, ' ');
    at = b;
  }
  return out + src.slice(at);
}

/** pos → 1-based line number. */
export function lineIndex(src) {
  const starts = [0];
  for (let i = src.indexOf('\n'); i >= 0; i = src.indexOf('\n', i + 1)) starts.push(i + 1);
  return (pos) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** The closing slash of a regex literal opening at i, or -1 when none closes it on this line. */
function regexEnd(src, i) {
  let inClass = false;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\n') return -1;
    if (c === '\\') j++;
    else if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return j;
  }
  return -1;
}

/** JavaScript: { comments, literals } (literal ranges cover the insides, not the quotes). */
export function jsRanges(src) {
  const comments = [], literals = [], holes = [], n = src.length;
  let i = 0, depth = 0, prev = '';
  if (src.startsWith('#!')) { i = src.indexOf('\n') < 0 ? n : src.indexOf('\n'); comments.push([0, i]); }
  const template = () => { // i is just past the backtick or the } that closes a ${...}
    const start = i;
    for (; i < n; i++) {
      const c = src[i];
      if (c === '\\') i++;
      else if (c === '`') { literals.push([start, i++]); prev = '`'; return; }
      else if (c === '$' && src[i + 1] === '{') {
        literals.push([start, i]); i += 2; holes.push(depth++); prev = '{';
        return;
      }
    }
    literals.push([start, n]);
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i) < 0 ? n : src.indexOf('\n', i);
      comments.push([i, end]); i = end;
    } else if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2) < 0 ? n : src.indexOf('*/', i + 2) + 2;
      comments.push([i, end]); i = end;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      literals.push([i + 1, Math.min(j, n)]); i = j + 1; prev = c;
    } else if (c === '`') {
      i++; template();
    } else if (c === '/' && regexMayStart(prev) && regexEnd(src, i) > 0) {
      const end = regexEnd(src, i);
      literals.push([i + 1, end]); i = end + 1; prev = ')';
    } else if (c === '}' && holes.length && holes[holes.length - 1] === depth - 1) {
      holes.pop(); depth--; i++; template();
    } else if (isWord(src.charCodeAt(i))) {
      const start = i;
      while (i < n && isWord(src.charCodeAt(i))) i++;
      prev = src.slice(start, i);
    } else {
      if (c === '{') depth++;
      else if (c === '}') depth--;
      if (c !== ' ' && c !== '\n' && c !== '\t' && c !== '\r') prev = c;
      i++;
    }
  }
  return { comments, literals };
}

/** HTML: comments, plus the comments and literals of inline <script> and <style> blocks. */
export function markupRanges(src) {
  const comments = ranges(src, /<!--[\s\S]*?-->/g), literals = [];
  const plain = blank(src, comments);
  for (const m of plain.matchAll(/(<(script|style)\b[^>]*>)([\s\S]*?)<\/\2>/gi)) {
    const at = m.index + m[1].length, shift = ([a, b]) => [a + at, b + at];
    if (m[2].toLowerCase() === 'style') { comments.push(...ranges(m[3], /\/\*[\s\S]*?\*\//g).map(shift)); continue; }
    const r = jsRanges(m[3]);
    comments.push(...r.comments.map(shift));
    literals.push(...r.literals.map(shift));
  }
  return { comments: comments.sort((a, b) => a[0] - b[0]), literals };
}
