import createDOMPurify, { type DOMPurify as Purifier } from "dompurify";

/**
 * Cleaning for a news feed's article HTML, which is written by whoever runs
 * the feed and shown inside the app, on the app's own page.
 *
 * DOMPurify's defaults stop scripts but keep page-level styling and forms. A
 * feed could then cover the whole app with a look-alike screen (a <style>
 * block, a style attribute, or the app's own utility classes such as
 * "fixed inset-0") and put a form or a full-screen link on it. So on top of
 * the defaults this drops:
 *   - styling: <style>, <link>, style=, class=, id= (the reader styles the
 *     article itself, so a feed's own classes never matched anything);
 *   - forms and their controls;
 *   - <meta> and <base>;
 *   - an embedded frame's `allow` (no camera, microphone or screen for a
 *     frame a feed chose).
 * Every link opens in a new tab with no access back to the app.
 *
 * Its own DOMPurify instance, so the link rule never reaches other callers.
 */
let purifier: Purifier | null = null;

function feedPurifier(): Purifier {
  if (purifier) return purifier;
  const p = createDOMPurify(window);
  p.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
  purifier = p;
  return p;
}

const FEED_HTML = {
  ADD_TAGS: ["figure", "figcaption", "picture", "source", "iframe", "video"],
  ADD_ATTR: ["loading", "srcset", "sizes", "allowfullscreen", "frameborder", "target"],
  FORBID_TAGS: ["style", "link", "meta", "base", "form", "input", "textarea", "select", "option", "button", "fieldset", "label", "dialog"],
  FORBID_ATTR: ["style", "class", "id", "name", "allow", "popover", "form", "formaction"],
};

/** A feed article's HTML, safe to show inside the app. */
export function sanitizeFeedHtml(html: string): string {
  return feedPurifier().sanitize(html, FEED_HTML) as string;
}
