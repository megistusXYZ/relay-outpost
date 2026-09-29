/**
 * Create › Note did nothing on Chats (2026-09-29): the studio "clicked" the
 * composer's floating button through the DOM, and the composer rendered
 * nothing at all on /messages, so there was no button to click. Now Note asks
 * the composer through an event, and on Chats the composer hides only its
 * button, never its dialog.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { noteComposeAction } from "./note-compose";
import { OPEN_NOTE_COMPOSER, SHELL_OVERLAY_EVENTS } from "./shell-events";

describe("noteComposeAction: what starting a note means where you are", () => {
  it("anywhere ordinary: the note composer", () => {
    expect(noteComposeAction(null)).toEqual({ kind: "composer" });
  });

  it("in a community: that community's own composer (topic tab → a topic)", () => {
    expect(noteComposeAction({ activeTab: "posts", canPostHorizon: false })).toEqual({ kind: "outpost", type: "note" });
    expect(noteComposeAction({ activeTab: "topics", canPostHorizon: false })).toEqual({ kind: "outpost", type: "topic" });
  });

  it("on a community's horizon: a new entry if you may post there, otherwise nothing", () => {
    expect(noteComposeAction({ activeTab: "horizon", canPostHorizon: true })).toEqual({ kind: "horizon" });
    expect(noteComposeAction({ activeTab: "horizon", canPostHorizon: false })).toEqual({ kind: "none" });
  });
});

describe("the wiring", () => {
  const src = (p: string) => readFileSync(path.resolve(import.meta.dirname, p), "utf8");
  const studio = src("../components/CreateStudio.tsx");
  const composer = src("../components/CreatePost.tsx");

  it("Create › Note asks the composer by event, not by clicking its button", () => {
    expect(studio).toMatch(/setTimeout\(openNoteComposer, \d+\)|openNoteComposer\(\)/);
    expect(studio).not.toContain('querySelector(\'[data-testid="button-fab-compose"]\')');
  });

  it("the composer listens for it, and the lazy shell replays it if it arrives early", () => {
    expect(composer).toContain(`addEventListener(OPEN_NOTE_COMPOSER`);
    expect(SHELL_OVERLAY_EVENTS).toContain(OPEN_NOTE_COMPOSER);
  });

  it("on Chats the composer hides its button, not the whole composer", () => {
    expect(composer).not.toMatch(/if \(location\.startsWith\("\/messages"\)\) return null;/);
    expect(composer).toMatch(/\{!onChats && \(\s*<Button/);
  });
});
