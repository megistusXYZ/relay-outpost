// Compact count formatting shared by the feed's engagement bar and the Thread
// ancestor spine, so "1.2k" always means the same thing everywhere. Kept in a
// dependency-free lib module (no React / no window) so it stays node-testable.
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toString();
}
