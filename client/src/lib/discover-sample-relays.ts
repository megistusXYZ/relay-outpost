/**
 * The relays Discover asks for a broad sample (recent notes, articles, events
 * or videos from anyone, no authors list).
 *
 * relay.damus.io is left out. It allows about 1 MB of reads per minute per IP
 * and then answers "read bandwidth budget exhausted" and refuses connections.
 * A cold Discover load asked it for ~1.2 MB of samples (measured 2026-09-30:
 * the 300-note feed sample alone was 819 KB), enough to use the budget up in
 * one load, and people on a phone network share an IP. The other relays carry
 * the samples; damus keeps the small, targeted lookups (trusted people, your
 * follows), where it's worth the most.
 */
const LEFT_OUT = new Set(["relay.damus.io"]);

function host(url: string): string {
  return url.trim().toLowerCase().replace(/^wss?:\/\//, "").replace(/\/+$/, "");
}

export function sampleRelays(relays: readonly string[]): string[] {
  const kept = relays.filter((r) => !LEFT_OUT.has(host(r)));
  // Never a sample with nobody to ask.
  return kept.length > 0 ? kept : [...relays];
}
