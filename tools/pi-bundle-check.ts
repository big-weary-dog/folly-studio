// The Pi bundle holds nothing of the hosting machine's (SPEC-offline "Downloading the Pi bundle"): read a listing
// (`tar -tzf folly-studio-pi.tgz`, one path a line) on stdin and fail naming each path that could be a secret or
// someone's data: env files, keys, a data folder, the Pi's own settings, a git folder.
//
//   tar -tzf folly-studio-pi.tgz | node tools/pi-bundle-check.ts
import { fileURLToPath } from 'node:url';

const BASENAME = [
  /^\.env(\..*)?$/, /\.env$/,                                     // studio.env, .env.local
  /\.(pem|key|p12|pfx|jks|keystore)$/i, /^id_(rsa|dsa|ecdsa|ed25519)/, /^\.(npmrc|netrc|pgpass)$/,
  /^credentials(\.json)?$/i, /^\.?htpasswd$/,
];
// Under the bundle's top folder: Studio's data (STUDIO_DATA's default), backups, the Pi's own settings, git.
const TOP = /^(data|backups|\.git|pi\/local)(\/|$)|^pi\/(config|light)\.json$/;
// Packages' own test fixtures are no one's secrets, but the check names them all the same unless listed here.
const PACKAGE_FIXTURES = /^node_modules\/[^/]+(\/[^/]+)?\/(test|tests|fixtures?)\//;

/** The paths of a bundle listing that must not ship. */
export function secretsIn(paths: string[]): string[] {
  return paths.filter((p) => {
    const inner = p.replace(/^\.?\/?folly-studio\//, '').replace(/\/$/, '');
    const base = inner.split('/').pop()!;
    if (TOP.test(inner)) return true;
    return BASENAME.some((re) => re.test(base)) && !PACKAGE_FIXTURES.test(inner);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const paths = text.split('\n').filter(Boolean);
  const found = secretsIn(paths);
  if (!paths.length) {
    console.error('pi-bundle-check: an empty listing');
    process.exit(1);
  }
  if (found.length) {
    console.error(`pi-bundle-check: ${found.length} path(s) must not ship:\n  ${found.slice(0, 20).join('\n  ')}`);
    process.exit(1);
  }
  console.log(`pi-bundle-check: ${paths.length} paths, nothing secret`);
}
