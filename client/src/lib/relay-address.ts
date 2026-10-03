/** "relay.example.com", "https://…", "wss://…/" → "wss://relay.example.com". Null when it isn't an address. */
export function normalizeRelayAddress(input: string): string | null {
  let u = input.trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) u = u.replace(/^http/i, "ws");
  if (!/^wss?:\/\//i.test(u)) u = "wss://" + u;
  try {
    const parsed = new URL(u);
    if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") return null;
    return (parsed.protocol + "//" + parsed.host + parsed.pathname).replace(/\/+$/, "");
  } catch {
    return null;
  }
}
