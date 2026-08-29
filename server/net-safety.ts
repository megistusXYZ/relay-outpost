import dns from "dns/promises";

/**
 * SSRF guards shared by server-side fetchers (link previews in routes.ts,
 * avatar fetches in og-cards.ts): refuse to talk to loopback/private/link-local
 * addresses, resolving hostnames first so DNS-rebinding-style names are caught.
 * Extracted from routes.ts.
 */
function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1).map((n) => Number(n));
  if (o.some((n) => n > 255)) return null;
  return ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3];
}

function inCidr(ipInt: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/**
 * True for any loopback/private/link-local address. Ranges are checked as whole
 * CIDR blocks, not string prefixes: an earlier exact-match on `127.0.0.1` left
 * the rest of `127.0.0.0/8` (e.g. `127.0.0.2`) reachable through an
 * attacker-controlled DNS name — this closes that.
 *
 * Inputs are DNS-RESOLVED addresses (see validateHostSafety), so they arrive as
 * canonical dotted-quad IPv4 or canonical IPv6; alternate encodings (decimal,
 * hex) never resolve and are rejected upstream by the empty-result guard.
 */
export function isPrivateIp(ip: string): boolean {
  const s = ip.trim().toLowerCase();
  if (s === 'localhost') return true;

  // IPv4-mapped IPv6 (textual ::ffff:127.0.0.1) — unwrap and re-check.
  if (s.startsWith('::ffff:')) {
    const mapped = s.slice(7);
    if (ipv4ToInt(mapped) !== null) return isPrivateIp(mapped);
  }
  // IPv6 loopback / unspecified / ULA (fc00::/7) / link-local (fe80::/10).
  if (s === '::1' || s === '::' || s === '0:0:0:0:0:0:0:1' || s === '0:0:0:0:0:0:0:0') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(s) || /^fe[89ab][0-9a-f]:/.test(s)) return true;

  const v4 = ipv4ToInt(s);
  if (v4 !== null) {
    return (
      inCidr(v4, '0.0.0.0', 8) ||        // "this" network / 0.0.0.0
      inCidr(v4, '10.0.0.0', 8) ||
      inCidr(v4, '100.64.0.0', 10) ||    // CGNAT
      inCidr(v4, '127.0.0.0', 8) ||      // loopback (whole block)
      inCidr(v4, '169.254.0.0', 16) ||   // link-local incl. cloud metadata
      inCidr(v4, '172.16.0.0', 12) ||
      inCidr(v4, '192.168.0.0', 16)
    );
  }
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
