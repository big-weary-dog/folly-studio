/** A browser socket must name this host in Origin. Pi's HTTP listener strips port 80 only. */
export function socketOrigin(origin: string | undefined, host: string, https = true): boolean {
  const normalized = (h: string) => h.toLowerCase().replace(https ? /:(80|443)$/ : /:80$/, '');
  try { return normalized(new URL(String(origin)).host) === normalized(host); }
  catch { return false; }
}
