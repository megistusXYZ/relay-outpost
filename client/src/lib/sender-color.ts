/**
 * Deterministic per-sender name color for GROUP chats (Slack-style).
 *
 * A pubkey hashes to one of a curated 13-hue palette defined ONCE as CSS
 * variables in index.css (`--chat-sender-0` … `--chat-sender-12`, with `.dark`
 * variants), so the same person keeps the same color in every group surface
 * (NIP-29 channel chat and Concord encrypted chat) and across both themes.
 *
 * Palette rules (hand-tuned, verified in sender-color.test.ts):
 *  - every value passes WCAG AA (>= 4.5:1, small bold text) against BOTH the
 *    light canvas/card and the dark canvas/card backgrounds;
 *  - no red hues (~350–15deg — they read as errors/deletion), and no hues in
 *    the app's violet primary band (262 +/- ~25deg — they'd read as
 *    selected/primary state);
 *  - mid saturation, controlled lightness: names get a hue, not a highlighter.
 *
 * Scope: callers apply this ONLY to the display-name text of OTHER users'
 * messages in group contexts, and only when a real profile name resolved — a
 * raw-npub fallback stays muted/neutral, never colored.
 */

/** Number of `--chat-sender-N` variables defined in index.css. Keep in sync. */
export const SENDER_PALETTE_SIZE = 13;

/**
 * Stable palette index for a pubkey (FNV-1a over the hex string). Pure and
 * deterministic: the same pubkey always lands on the same index, in every
 * chat system, on every load.
 */
export function senderColorIndex(pubkey: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < pubkey.length; i++) {
    h ^= pubkey.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % SENDER_PALETTE_SIZE;
}

/**
 * CSS color value for a sender's name, e.g. `hsl(var(--chat-sender-4))`.
 * Theme switching is automatic — the variable resolves per-theme in CSS.
 */
export function senderColor(pubkey: string): string {
  return `hsl(var(--chat-sender-${senderColorIndex(pubkey)}))`;
}
