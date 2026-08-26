/**
 * Pure helpers for the Media Servers (Blossom) view. Kept separate from the
 * React page so the normalization/validation logic is trivially unit-testable
 * and shared, rather than re-implemented per call site.
 */

export type NormalizeResult =
  | { ok: true; url: string }
  | { ok: false; reason: "empty" | "invalid" };

/**
 * Normalize a user-typed Blossom server URL: trim, default to https:// when no
 * scheme is given, and validate it parses as a URL. Mirrors the exact behavior
 * of the Settings → Media uploads add-server input.
 */
export function normalizeBlossomUrl(raw: string): NormalizeResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  const withScheme =
    trimmed.startsWith("https://") || trimmed.startsWith("http://")
      ? trimmed
      : "https://" + trimmed;
  try {
    // Validates structure; throws for garbage like "https://".
    const parsed = new URL(withScheme);
    if (!parsed.hostname) return { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, url: withScheme };
}
