/**
 * Build-time HTML transform: load the app's own stylesheet without blocking
 * the first paint.
 *
 * Browsers paint nothing while a <link rel="stylesheet"> in <head> is still
 * loading, so the inline launch splash waited behind the app's 501 KB
 * stylesheet (2026-09-29). Now:
 *  - a preload fetches it early, at high priority;
 *  - a media="print" stylesheet on the same URL reuses that fetch and doesn't
 *    block painting;
 *  - an inline <script> switches it to media="all" once it has loaded, and
 *    calls window.__roCssDone (defined inline in index.html) so the splash
 *    stays up until the styles are really in. An error calls it too: a failed
 *    stylesheet must never hold the splash.
 * No inline event handlers (onload=""): production's CSP has
 * script-src-attr 'none', which silently blocked the first version (#184).
 * Browsers without JavaScript get the plain link inside <noscript>.
 */
const APP_CSS = /<link rel="stylesheet" crossorigin href="(\/assets\/index-[^"]+\.css)">/;

// Runs right after the link is parsed. If the sheet already loaded before the
// listener could attach, it's applied at once.
const SWITCH_ON =
  "(function(){var l=document.getElementById('ro-app-css');if(!l)return;" +
  "var done=function(){window.__roCssDone&&window.__roCssDone()};" +
  "var on=function(){l.media='all';done()};" +
  "if(l.sheet)on();else{l.addEventListener('load',on);l.addEventListener('error',done)}})()";

export function nonBlockingAppCss(html: string): string {
  return html.replace(APP_CSS, (_m, href: string) =>
    `<link rel="preload" as="style" crossorigin href="${href}">` +
    `<link rel="stylesheet" crossorigin href="${href}" media="print" id="ro-app-css">` +
    `<script>${SWITCH_ON}</script>` +
    `<noscript><link rel="stylesheet" crossorigin href="${href}"></noscript>`,
  );
}
