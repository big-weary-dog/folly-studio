// Request and response helpers for the JSON API: bodies, CSRF checks, the logger.

import { HttpError } from './auth.js';
import { etagMatches, etagOf } from './static.js';

export const MAX_BODY = 256 * 1024;
export const STREAMED = Symbol('streamed'); // a handler that wrote the response itself

/** A logger usable both as log(...) and log.info/warn/error(...). */
export function createLog(prefix = '[studio]') {
  const log = (...a) => console.info(prefix, ...a);
  return Object.assign(log, { info: log, debug: () => {}, warn: (...a) => console.warn(prefix, ...a),
    error: (...a) => console.error(prefix, ...a) });
}

/** JSON out. A GET's 200 is revalidated each time (ETag, 304): a reload moves no bytes when nothing changed. */
export function sendJson(req, res, status, data) {
  const body = Buffer.from(JSON.stringify(data));
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (req.method === 'GET' && status === 200) {
    Object.assign(headers, { 'Cache-Control': 'private, no-cache', ETag: etagOf(body) });
    if (etagMatches(req.headers['if-none-match'], headers.ETag)) {
      res.writeHead(304, headers);
      return res.end();
    }
  }
  res.writeHead(status, { ...headers, 'Content-Length': body.length });
  res.end(body);
}

const stripDefaultPort = (host) => host.toLowerCase().replace(/:(80|443)$/, '');

/** CSRF: JSON content type, and a same-origin Origin when one is sent. */
export function checkMutation(req, trustProxy) {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let originHost = null;
    try { originHost = new URL(origin).host; } catch { /* "null" or garbage */ }
    const fwd = trustProxy && typeof req.headers['x-forwarded-host'] === 'string'
      ? req.headers['x-forwarded-host'].split(',')[0].trim() : '';
    const host = fwd || req.headers.host || '';
    if (!originHost || !host || stripDefaultPort(originHost) !== stripDefaultPort(host)) {
      throw new HttpError(403, 'Cross-origin request refused.');
    }
  }
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'Content-Type must be application/json.');
}

/** The request body as a JSON object ({} when empty); 413 past `max` bytes, 400 when not an object. */
export function readJson(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const tooBig = () => new HttpError(413, `Request body is over ${Math.round(max / 1024)} kB.`);
    if (Number(req.headers['content-length']) > max) {
      req.resume(); // discard; node keeps the connection usable
      return reject(tooBig());
    }
    const chunks = [];
    let size = 0, done = false;
    const finish = (fn, v) => { if (!done) { done = true; fn(v); } };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max) finish(reject, tooBig());
      else if (!done) chunks.push(chunk);
    });
    req.on('error', (err) => finish(reject, err));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return finish(resolve, {});
      let value;
      try { value = JSON.parse(text); } catch { return finish(reject, new HttpError(400, 'Body is not valid JSON.')); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return finish(reject, new HttpError(400, 'Body must be a JSON object.'));
      }
      finish(resolve, value);
    });
  });
}

/** A request target as { pathname, query }, or null when it is not one. */
export function splitUrl(raw = '/') {
  let target = raw;
  if (/^https?:\/\//i.test(target)) {
    try { const u = new URL(target); target = u.pathname + u.search; } catch { return null; }
  }
  if (!target.startsWith('/')) return null;
  const q = target.indexOf('?');
  return { pathname: q < 0 ? target : target.slice(0, q),
    query: new URLSearchParams(q < 0 ? '' : target.slice(q + 1)) };
}
