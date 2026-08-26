import { forwardRef, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface MentionHighlightTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  mentionPattern?: RegExp;
  emojiMap?: Map<string, string>;
}

function highlightHashtags(parts: (string | JSX.Element)[]): (string | JSX.Element)[] {
  const result: (string | JSX.Element)[] = [];
  const regex = /(?:^|[\s\n])#(\w+)/g;

  for (const part of parts) {
    if (typeof part !== "string") {
      result.push(part);
      continue;
    }
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((m = regex.exec(part)) !== null) {
      const hashStart = m.index + m[0].indexOf("#");
      if (hashStart > lastIdx) {
        result.push(part.slice(lastIdx, hashStart));
      }
      const hashtag = "#" + m[1];
      result.push(
        <mark
          key={`h-${hashStart}-${m[1]}`}
          style={{
            color: "rgb(129, 140, 248)",
            background: "rgba(99, 102, 241, 0.15)",
            borderRadius: "3px",
            padding: "0 2px",
            margin: "0 -2px",
          }}
        >
          {hashtag}
        </mark>
      );
      lastIdx = hashStart + hashtag.length;
    }
    if (lastIdx < part.length) {
      result.push(part.slice(lastIdx));
    }
  }
  return result;
}

function highlightMentions(text: string, pattern: RegExp): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(pattern.source, "g");

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const visible = match[0].replace(/[\u200B\u200C]/g, "");
    const invisibleSuffix = match[0].slice(visible.length);
    parts.push(
      <mark
        key={`m-${match.index}`}
        style={{
          color: "rgb(192, 132, 252)",
          background: "rgba(168, 85, 247, 0.15)",
          borderRadius: "3px",
          padding: "0 2px",
          margin: "0 -2px",
        }}
      >
        {visible}
      </mark>
    );
    if (invisibleSuffix) {
      parts.push(invisibleSuffix);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function renderEmojis(parts: (string | JSX.Element)[], emojiMap: Map<string, string>): (string | JSX.Element)[] {
  const result: (string | JSX.Element)[] = [];
  for (const part of parts) {
    if (typeof part !== "string") {
      result.push(part);
      continue;
    }
    const segments = part.split(/:([a-zA-Z0-9_]+):/g);
    if (segments.length === 1) {
      result.push(part);
      continue;
    }
    for (let i = 0; i < segments.length; i++) {
      if (i % 2 === 0) {
        if (segments[i]) result.push(segments[i]);
      } else {
        const url = emojiMap.get(segments[i]);
        if (url) {
          result.push(
            <img
              key={`ce-${i}-${segments[i]}`}
              src={url}
              alt={`:${segments[i]}:`}
              style={{ display: "inline", width: "1.3em", height: "1.3em", verticalAlign: "middle", objectFit: "contain", margin: "0 1px" }}
            />
          );
        } else {
          result.push(`:${segments[i]}:`);
        }
      }
    }
  }
  return result;
}

const DEFAULT_MENTION_PATTERN = /@[^\n@]+?[\u200B\u200C][\u200B\u200C]+/;

export const MentionHighlightTextarea = forwardRef<
  HTMLTextAreaElement,
  MentionHighlightTextareaProps
>(({ value, onChange, mentionPattern, emojiMap, className, style, ...props }, ref) => {
  const backdropRef = useRef<HTMLDivElement>(null);
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  const pattern = mentionPattern || DEFAULT_MENTION_PATTERN;

  const setRefs = useCallback(
    (node: HTMLTextAreaElement | null) => {
      internalRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
    },
    [ref]
  );

  const syncScroll = useCallback(() => {
    if (internalRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = internalRef.current.scrollTop;
      backdropRef.current.scrollLeft = internalRef.current.scrollLeft;
    }
  }, []);

  useEffect(() => {
    syncScroll();
  }, [value, syncScroll]);

  const hasMentions = new RegExp(pattern.source).test(value || "");
  const hasEmojis = emojiMap && emojiMap.size > 0 && /:[a-zA-Z0-9_]+:/.test(value || "");
  const hasHashtags = /(?:^|\s)#\w+/.test(value || "");
  const hasOverlay = hasMentions || hasEmojis || hasHashtags;
  let highlighted = highlightMentions(value || "", pattern);
  if (hasHashtags) {
    highlighted = highlightHashtags(highlighted);
  }
  if (hasEmojis && emojiMap) {
    highlighted = renderEmojis(highlighted, emojiMap);
  }

  return (
    <div className="relative w-full">
      {hasOverlay && (
        <div
          ref={backdropRef}
          aria-hidden="true"
          className={cn(
            "absolute inset-0 pointer-events-none overflow-hidden whitespace-pre-wrap break-words",
            className
          )}
          style={{
            ...style,
            fontSize: 16,
            // No forced border here: the backdrop mirror and the textarea must share
            // identical box geometry. Both receive the same `className` (incl. any
            // caller border-* class), so letting the class drive the border keeps the
            // highlighted @mentions pixel-aligned instead of 1px off.
            color: "hsl(var(--foreground) / 0.9)",
            background: "transparent",
            overflow: "hidden",
            maxHeight: "none",
          }}
        >
          {highlighted}
          {"\n"}
        </div>
      )}
      <textarea
        ref={setRefs}
        value={value}
        onChange={onChange}
        onScroll={syncScroll}
        className={cn("mention-highlight-textarea border-0 outline-none focus:outline-none focus:ring-0", className)}
        style={{
          ...style,
          fontSize: 16,
          ...(hasOverlay
            ? {
                color: "transparent",
                caretColor: "hsl(var(--foreground) / 0.9)",
                WebkitTextFillColor: "transparent",
              }
            : {}),
        }}
        {...props}
      />
    </div>
  );
});

MentionHighlightTextarea.displayName = "MentionHighlightTextarea";
