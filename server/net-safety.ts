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
  const s = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (s === 'localhost') return true;

  const v4 = ipv4ToInt(s);
  if (v4 !== null) return isPrivateV4(v4);

  if (!s.includes(':')) return false;
  const words = ipv6Words(s);
  if (!words) return true; // unparseable IPv6: refuse rather than guess

  // An IPv4 address carried inside IPv6 is judged as that IPv4 address:
  // ::a.b.c.d (compatible), ::ffff:a.b.c.d (mapped), 64:ff9b::/96 (NAT64).
  const tail = ((words[6] << 16) >>> 0) + words[7];
  const zero = (from: number, to: number) => words.slice(from, to).every((w) => w === 0);
  if (zero(0, 6) && !(words[6] === 0 && words[7] <= 1)) return isPrivateV4(tail);
  if (zero(0, 5) && words[5] === 0xffff) return isPrivateV4(tail);
  if (words[0] === 0x64 && words[1] === 0xff9b && zero(2, 6)) return isPrivateV4(tail);
  // 6to4 (2002::/16) carries an IPv4 address in its next 32 bits.
  if (words[0] === 0x2002) return isPrivateV4(((words[1] << 16) >>> 0) + words[2]);

  if (zero(0, 8)) return true;                               // ::
  if (zero(0, 7) && words[7] === 1) return true;             // ::1
  if ((words[0] & 0xfe00) === 0xfc00) return true;           // fc00::/7 unique local
  if ((words[0] & 0xffc0) === 0xfe80) return true;           // fe80::/10 link-local
  if ((words[0] & 0xffc0) === 0xfec0) return true;           // fec0::/10 site-local
  if ((words[0] & 0xff00) === 0xff00) return true;           // ff00::/8 multicast
  if (words[0] === 0x100 && zero(1, 4)) return true;         // 100::/64 discard
  return false;
}

function isPrivateV4(v4: number): boolean {
  return (
    inCidr(v4, '0.0.0.0', 8) ||        // "this" network / 0.0.0.0
    inCidr(v4, '10.0.0.0', 8) ||
    inCidr(v4, '100.64.0.0', 10) ||    // CGNAT
    inCidr(v4, '127.0.0.0', 8) ||      // loopback (whole block)
    inCidr(v4, '169.254.0.0', 16) ||   // link-local incl. cloud metadata
    inCidr(v4, '172.16.0.0', 12) ||
    inCidr(v4, '192.0.0.0', 24) ||     // IETF protocol assignments
    inCidr(v4, '192.168.0.0', 16) ||
    inCidr(v4, '198.18.0.0', 15) ||    // benchmarking
    inCidr(v4, '224.0.0.0', 4) ||      // multicast
    inCidr(v4, '240.0.0.0', 4)         // reserved, incl. 255.255.255.255
  );
}

/** The eight 16-bit words of an IPv6 address, or null when it doesn't parse. */
function ipv6Words(s: string): number[] | null {
  let text = s.split('%')[0];
  // A trailing dotted IPv4 becomes two words.
  const dotted = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const v4 = ipv4ToInt(dotted[2]);
    if (v4 === null) return null;
    text = `${dotted[1]}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === '' ? [] : part.split(':'));
  const head = parse(halves[0]);
  const tailParts = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - tailParts.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tailParts];
  const words: number[] = [];
  for (const w of all) {
    if (!/^[0-9a-f]{1,4}$/.test(w)) return null;
    words.push(parseInt(w, 16));
  }
  return words.length === 8 ? words : null;
}

/**
 * Resolve a hostname and return its vetted public IPs, or null when it doesn't
 * resolve or resolves to any private/loopback/link-local address.
 *
 * Returning the ACTUAL addresses (not just a boolean) lets a caller PIN the
 * connection to exactly these IPs — closing the DNS-rebinding TOCTOU where the
 * safety check and the connect resolve the name separately and can disagree
 * (validate → public IP, connect → private IP). See safe-fetch.ts.
 */
export async function resolveVettedAddresses(hostname: string): Promise<string[] | null> {
  try {
    const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
    const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    const allAddrs = [...addresses, ...addresses6];
    if (allAddrs.length === 0) return null;
    if (allAddrs.some(isPrivateIp)) return null;
    return allAddrs;
  } catch {
    return null;
  }
}

export async function validateHostSafety(hostname: string): Promise<boolean> {
  return (await resolveVettedAddresses(hostname)) !== null;
}
