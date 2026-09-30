import { createElement, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * The standard for long text (owner, 2026-09-30). Text is limited by the
 * lines it takes on screen, not by characters: the 300-character rule never
 * cut a long list of short lines, and a reply's "replying to" preview had no
 * limit at all (one ran to 21,450 px). "Show more" appears only when the
 * limit actually hides something; measured, the way the profile bio does it.
 *
 * The limits, by surface:
 *   LINES.context 3: "replying to" previews and quoted posts. No Show more:
 *                    tapping them opens the post.
 *   LINES.post    8: post text in feeds, replies in a thread.
 *   LINES.comment 6: comments on videos and images.
 *   LINES.chat   20: chat messages; only long pastes are ever cut.
 * The main post of a thread you opened has no limit (`lines` undefined).
 */
export const LINES = { context: 3, comment: 6, post: 8, chat: 20 } as const;

/** Characters rendered per allowed line while text is cut: a phone line holds ~40. */
const CHARS_PER_LINE = 240;

/**
 * What a surface should render while its text is cut: enough to fill its
 * lines several times over, ending on a whole word, and no more. Rendering
 * everything and hiding the rest cost the full render of a 46,238-character
 * post in every feed it appeared in. Expanded, or with no limit, the text is
 * left whole.
 */
export function textForLines(text: string, lines: number | undefined, expanded: boolean): string {
  if (lines === undefined || expanded) return text;
  const cap = lines * CHARS_PER_LINE;
  if (text.length <= cap) return text;
  const cut = text.slice(0, cap);
  const lastSpace = cut.search(/\s\S*$/);
  return (lastSpace > cap * 0.8 ? cut.slice(0, lastSpace) : cut) + "…";
}

export function ClampedText({
  lines,
  expandable = true,
  children,
  as = "div",
  className,
  testId,
  toggleTestId,
  toggleClassName,
  expanded: expandedProp,
  onExpandedChange,
}: {
  /** How many lines to show; undefined shows everything. */
  lines?: number;
  /** Offer Show more / Show less. Context previews don't: tapping opens the post. */
  expandable?: boolean;
  children: ReactNode;
  as?: "div" | "p" | "span";
  className?: string;
  testId?: string;
  toggleTestId?: string;
  toggleClassName?: string;
  /**
   * Given by a surface that renders less text while cut (textForLines): the
   * surface owns the state and ClampedText reports taps instead.
   */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [ownExpanded, setOwnExpanded] = useState(false);
  const expanded = expandedProp ?? ownExpanded;
  const setExpanded = (next: boolean) => (onExpandedChange ? onExpandedChange(next) : setOwnExpanded(next));
  const [overflows, setOverflows] = useState(false);
  const boxRef = useRef<HTMLElement | null>(null);
  const clamped = lines !== undefined && !expanded;

  // Measured, not guessed: is the limit hiding anything? Re-measured when the
  // box resizes and when its content changes (names and emoji resolve after
  // the first render without changing the clamped box's size).
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || !clamped) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(measure) : null;
    mo?.observe(el, { childList: true, subtree: true, characterData: true });
    return () => { ro?.disconnect(); mo?.disconnect(); };
  }, [clamped, lines]);

  const style: CSSProperties | undefined = clamped
    ? { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines, overflow: "hidden" }
    : undefined;

  const box = createElement(
    as,
    {
      ref: boxRef,
      className,
      style,
      "data-testid": testId,
      "data-clamp-lines": clamped ? lines : undefined,
    },
    children,
  );
  const showToggle = expandable && lines !== undefined && (overflows || expanded);
  return (
    <>
      {box}
      {showToggle && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); setExpanded(!expanded); }}
          aria-expanded={expanded}
          className={toggleClassName ?? "text-xs text-brand/80 mt-1.5 cursor-pointer font-medium tracking-wide"}
          data-testid={toggleTestId}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}
