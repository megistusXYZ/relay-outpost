/**
 * 1234 → "1.2k". Dependency-free on purpose: the landing page bundle must not
 * pull feed modules for a number format (bundle-allowlist rule).
 */
export function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}
