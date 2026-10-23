/**
 * Is `origin` (e.g. "https://www.shop.com") allowed by the tenant's list?
 *
 * Entries are hostnames with an optional port, same rules as CSP host sources
 * (which is what the browser enforces for framing, so the two checks agree):
 *   "shop.com"          → exactly shop.com on the default port (80/443)
 *   "*.shop.com"        → any subdomain (www.shop.com, a.b.shop.com), not shop.com itself
 *   "localhost:3000"    → that host on that port
 * An empty list allows nothing: a new widget is off until domains are added.
 */
export function isAllowedOrigin(origin: string, allowedDomains: string[]): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase();

  return allowedDomains.some((entry) => {
    const [pattern, port = ''] = entry.toLowerCase().split(':');
    if (port !== url.port) return false; // url.port is '' for the scheme's default port
    if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1));
    return host === pattern;
  });
}
