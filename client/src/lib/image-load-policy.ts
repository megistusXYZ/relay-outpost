/**
 * When a picture's request has been silent for a while: move on to the next
 * source, or keep waiting?
 *
 * Why this exists (owner's screen recording, 2026-10-13 06:58, iPhone PWA on
 * one bar of signal): the previous build counted a silent proxy attempt as failed
 * after 10 s and moved on to the picture's host. The host hands out the
 * ORIGINAL, which the phone decodes at full size — a dozen of those on one
 * screen starve iOS of graphics memory, and WebKit stops drawing layers: post
 * bodies went blank and the Feeds sheet opened empty. On a slow link nearly
 * every picture crossed 10 s, so nearly every picture went that way.
 *
 * The proxy is the only source whose answer is resized, so leaving it is the
 * costly move. It is left only when it looks hung: nothing from it for the
 * whole alive window, or past the first budget when it has never answered.
 * A direct source (the host, an IPFS gateway, a Blossom alternate) gets one
 * plain timeout as before.
 */

/** One silent attempt, for a direct source. */
export const ATTEMPT_TIMEOUT_MS = 10_000;
/** How long a proxy that has not answered anything yet is given. */
export const PROXY_FIRST_BUDGET_MS = 30_000;
/** The proxy counts as alive while it delivered some picture this recently. */
export const PROXY_ALIVE_WINDOW_MS = 20_000;
/** Never wait on one proxy attempt longer than this, however lively the proxy looks. */
export const PROXY_CEILING_MS = 90_000;

export type Silence = {
  /** The attempt in flight goes through the image proxy. */
  viaProxy: boolean;
  /** How long this attempt has been silent. */
  waitedMs: number;
  /** How long ago the proxy last delivered any picture; null = never in this session. */
  proxyAnsweredAgoMs: number | null;
};

export function nextOnSilence({ viaProxy, waitedMs, proxyAnsweredAgoMs }: Silence): "wait" | "move-on" {
  if (!viaProxy) return waitedMs >= ATTEMPT_TIMEOUT_MS ? "move-on" : "wait";
  if (waitedMs >= PROXY_CEILING_MS) return "move-on";
  if (proxyAnsweredAgoMs !== null && proxyAnsweredAgoMs < PROXY_ALIVE_WINDOW_MS) return "wait";
  return waitedMs >= PROXY_FIRST_BUDGET_MS ? "move-on" : "wait";
}

// The one shared fact: when the proxy last delivered a picture to this page.
let proxyAnsweredAt: number | null = null;

/** The proxy just delivered a picture. */
export function noteProxyAnswered(now: number = Date.now()): void {
  proxyAnsweredAt = now;
}

/** How long ago the proxy last delivered a picture; null when it never has. */
export function proxyAnsweredAgo(now: number = Date.now()): number | null {
  return proxyAnsweredAt === null ? null : Math.max(0, now - proxyAnsweredAt);
}

/** Tests only. */
export function resetProxyHealth(): void {
  proxyAnsweredAt = null;
}
