import dns from "dns/promises";

/**
 * SSRF guards shared by server-side fetchers (link previews in routes.ts,
 * avatar fetches in og-cards.ts): refuse to talk to loopback/private/link-local
 * addresses, resolving hostnames first so DNS-rebinding-style names are caught.
 * Extracted from routes.ts.
 */
export function isPrivateIp(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '0.0.0.0' || ip === '::1' || ip === '::' || ip === 'localhost') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true;
  if (ip.startsWith('::ffff:')) {
    const mapped = ip.slice(7);
    return isPrivateIp(mapped);
  }
  if (ip === '0:0:0:0:0:0:0:1' || ip === '0:0:0:0:0:0:0:0') return true;
  return false;
}

export async function validateHostSafety(hostname: string): Promise<boolean> {
  try {
    const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
    const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    const allAddrs = [...addresses, ...addresses6];
    if (allAddrs.length === 0) return false;
    return !allAddrs.some(isPrivateIp);
  } catch {
    return false;
  }
}
