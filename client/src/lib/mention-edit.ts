/**
 * Editing around a tagged @name (lib/mention-edit.test.ts). A tag is the name
 * plus a short run of hidden characters (U+200B/U+200C) that use-mention.ts
 * uses to remember who it is. These keep it one thing: backspace takes the
 * whole tag, an edit that cuts into a name leaves plain text with nothing
 * hidden behind, and the caret never parks among the hidden characters.
 */

// The same shape MentionHighlightTextarea draws: "@" + a name + 2+ hidden.
const MENTION = /@[^\n@]+?[​‌][​‌]+/g;
// A tag's hidden run always starts with U+200B and is 2+ long. A lone U+200C
// is ordinary text in Persian, Kurdish and other scripts; never touch it.
const HIDDEN_RUN = /​[​‌]+/g;

interface Span { start: number; nameEnd: number; end: number; token: string; tag: string }

function spans(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(MENTION)) {
    const start = m.index ?? 0;
    const firstHidden = m[0].search(/[​‌]/);
    out.push({ start, nameEnd: start + firstHidden, end: start + m[0].length, token: m[0].slice(firstHidden), tag: m[0] });
  }
  return out;
}

/**
 * Backspace with the caret right after a tag, or among its hidden characters:
 * the whole tag goes. Null when it's an ordinary backspace.
 */
export function backspaceMention(text: string, caret: number): { text: string; caret: number } | null {
  for (const s of spans(text)) {
    if (caret > s.nameEnd && caret <= s.end) return { text: text.slice(0, s.start) + text.slice(s.end), caret: s.start };
  }
  return null;
}

/**
 * After an edit: any tag whose name was changed (cut into, typed into) and any
 * hidden run left on its own become plain text. `before` is the text before
 * the edit, so a tag just added is told apart from one just broken.
 */
export function tidyMentions(before: string, after: string, caret: number): { text: string; caret: number } {
  if (!/​/.test(after)) return { text: after, caret };
  const was = new Map(spans(before).map((s) => [s.token, s.tag]));
  const keep: Array<[number, number]> = [];
  for (const s of spans(after)) {
    const prior = was.get(s.token);
    if (prior === undefined || prior === s.tag) keep.push([s.start, s.end]);
  }
  const kept = (i: number) => keep.some(([a, b]) => i >= a && i < b);
  let text = "", newCaret = caret;
  let i = 0;
  for (const m of after.matchAll(HIDDEN_RUN)) {
    const at = m.index ?? 0;
    if (kept(at)) continue;
    text += after.slice(i, at);
    const gone = m[0].length;
    if (caret > at) newCaret -= Math.min(gone, caret - at);
    i = at + gone;
  }
  text += after.slice(i);
  return { text, caret: newCaret };
}

/**
 * A caret among a tag's hidden characters moves out of them: to just after
 * the tag, or — when it was moving left (`from` is where it came from) — to
 * the end of the name, so the left arrow is never stuck.
 */
export function snapOutOfMention(text: string, caret: number, from?: number): number {
  for (const s of spans(text)) {
    if (caret > s.nameEnd && caret < s.end) return from !== undefined && from > caret ? s.nameEnd : s.end;
  }
  return caret;
}
