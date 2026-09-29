/**
 * Build-time HTML transform: load the app's own stylesheet without blocking
 * the first paint.
 *
 * Browsers paint nothing while a <link rel="stylesheet"> in <head> is still
 * loading, so the inline launch splash waited behind the app's 501 KB
 * stylesheet (2026-09-29). The link becomes a preload that switches itself to
 * a stylesheet on load, and calls window.__roCssDone (defined inline in
 * index.html) so the splash stays up until the styles are really in. An error
 * calls it too: a failed stylesheet must never hold the splash forever.
 * Browsers without JavaScript get the plain link inside <noscript>.
 */
const APP_CSS = /<link rel="stylesheet" crossorigin href="(\/assets\/index-[^"]+\.css)">/;

export function nonBlockingAppCss(html: string): string {
  return html.replace(APP_CSS, (_m, href: string) =>
    `<link rel="preload" as="style" crossorigin href="${href}" ` +
    `onload="this.onload=null;this.rel='stylesheet';window.__roCssDone&&window.__roCssDone()" ` +
    `onerror="window.__roCssDone&&window.__roCssDone()">` +
    `<noscript><link rel="stylesheet" crossorigin href="${href}"></noscript>`,
  );
}
