/**
 * Chromium's Web Install API. With no arguments it installs the current
 * document, which needs a manifest with an `id` (ours is "/"). It rejects with
 * an AbortError when the person cancels, and needs a tap's user activation.
 */
interface Navigator {
  install?: () => Promise<unknown>;
}
