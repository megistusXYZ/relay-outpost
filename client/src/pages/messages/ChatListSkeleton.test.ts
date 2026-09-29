/**
 * Chats on a cold load: rows the shape of real ones (owner-approved launch,
 * 2026-09-29), not a spinner. Screen readers still hear what's happening.
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import path from "path";
import { ChatListSkeleton } from "./ChatListSkeleton";

describe("ChatListSkeleton", () => {
  it("is announced as loading conversations", () => {
    const html = renderToStaticMarkup(createElement(ChatListSkeleton));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading conversations"');
    expect(html).toContain('aria-busy="true"');
  });

  it("draws rows the shape of a conversation: a 40px avatar and two lines", () => {
    const html = renderToStaticMarkup(createElement(ChatListSkeleton, { rows: 3 }));
    expect(html.match(/data-testid="chat-skeleton-row"/g)).toHaveLength(3);
    expect(html.match(/w-10 h-10 rounded-full/g)).toHaveLength(3);
  });
});

describe("the Chats cold load", () => {
  const src = readFileSync(path.resolve(import.meta.dirname, "ChatList.tsx"), "utf8");
  it("shows the skeleton, not the spinner", () => {
    expect(src).toContain("<ChatListSkeleton");
    expect(src).not.toContain('label="Loading conversations..."');
  });
});
