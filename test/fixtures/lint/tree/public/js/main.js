// The browser side. Comments may say innerHTML, eval( and console.log freely.
import { view } from './ui/view.js';
import { helper } from './missing.js';
import { secret } from '../../src/server.js';
import 'lodash';
import 'https://esm.example.com/x.js';
const html = '<b>' + view + '</b>';
document.body.innerHTML = html;
document.write(html);
console.log('hello');
console.warn('fine');
console.log('kept'); // lint-allow no-console-log: fixture for a counted silence
// lint-allow no-console-log: the line below is silenced
console.log('also kept');
console.log('x'); // lint-allow no-console-log
const r = Math.random();
const s = 'debugger; eval(1); console.log()';
const re = /console\.log\(|eval\(/;
const t = `${s} ${`nested ${re}`} debugger`;
debugger;
document.body['outerHTML'] = s;
const f = eval('1');
export const later = () => import('./ui/lazy.js');
export const tooLong = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
// lint-allow no-debugger: nothing on the next line needs it
export { html, r, s, re, t, f, helper, secret };
/* lint-allow max-lines: limits are budgets */
// lint-allow no-such-rule: typo
