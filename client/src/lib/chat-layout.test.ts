/**
 * The group chat's desktop layout as you left it: which sections are open and
 * how wide you dragged each side. One layout per device, for every group.
 */
import { describe, it, expect } from "vitest";
import { loadChatLayout, saveChatLayout, toggleSection, resizePane, togglePane, fitPanes, resetPane, showPane, PANE_LIMITS, CHAT_MIN_WIDTH } from "./chat-layout";

describe("asking for a side the window has no room for", () => {
  const narrow = PANE_LIMITS.rooms.initial + PANE_LIMITS.info.initial + CHAT_MIN_WIDTH - 1;

  it("showing Members + About in a narrow window folds the rooms list to make room", () => {
    const shown = showPane(loadChatLayout(null), "info", narrow);
    expect(fitPanes(shown, narrow).info).toBe(PANE_LIMITS.info.initial);
    expect(shown.collapsed.rooms).toBe(true);
  });

  it("in a wide window it just opens it", () => {
    const shown = showPane(togglePane(loadChatLayout(null), "info"), "info", 2000);
    expect(shown.collapsed).toEqual({ rooms: false, info: false });
  });
});

describe("after this update", () => {
  it("a members panel you hid before stays hidden", () => {
    expect(loadChatLayout(null, { membersHidden: true }).collapsed.info).toBe(true);
    expect(loadChatLayout(null, { membersHidden: false }).collapsed.info).toBe(false);
  });

  it("once the new layout is saved, it wins over the old setting", () => {
    const saved = saveChatLayout(loadChatLayout(null));
    expect(loadChatLayout(saved, { membersHidden: true }).collapsed.info).toBe(false);
  });
});

describe("resetting a side (double-click its divider)", () => {
  it("goes back to its first width, open, and leaves the other side as you set it", () => {
    let layout = resizePane(loadChatLayout(null), "info", 400);
    layout = resizePane(resizePane(layout, "rooms", 320), "rooms", 10);
    const reset = resetPane(layout, "rooms");
    expect(reset.widths.rooms).toBe(PANE_LIMITS.rooms.initial);
    expect(reset.collapsed.rooms).toBe(false);
    expect(reset.widths.info).toBe(400);
  });
});

describe("a narrow window", () => {
  const { rooms, info } = { rooms: PANE_LIMITS.rooms.initial, info: PANE_LIMITS.info.initial };

  it("the chat keeps a readable width: the right side gives way first, then the rooms list", () => {
    const layout = loadChatLayout(null);
    expect(fitPanes(layout, rooms + info + CHAT_MIN_WIDTH)).toEqual({ rooms, info });
    expect(fitPanes(layout, rooms + info + CHAT_MIN_WIDTH - 1)).toEqual({ rooms, info: 0 });
    expect(fitPanes(layout, rooms + CHAT_MIN_WIDTH - 1)).toEqual({ rooms: 0, info: 0 });
  });

  it("gives way without forgetting: the saved layout still has both sides open", () => {
    const layout = loadChatLayout(null);
    fitPanes(layout, 300);
    expect(layout.collapsed).toEqual({ rooms: false, info: false });
  });

  it("a side you folded takes no room", () => {
    expect(fitPanes(togglePane(loadChatLayout(null), "rooms"), 2000)).toEqual({ rooms: 0, info });
  });
});

describe("folding a side away", () => {
  it("dragging a side well past its narrowest folds it away, and it reopens at its last width", () => {
    const folded = resizePane(resizePane(loadChatLayout(null), "rooms", 300), "rooms", 40);
    expect(folded.collapsed.rooms).toBe(true);
    const back = togglePane(loadChatLayout(saveChatLayout(folded)), "rooms");
    expect(back.collapsed.rooms).toBe(false);
    expect(back.widths.rooms).toBe(300);
  });

  it("a drag that ends folded reopens at the width from before the drag, not one it passed through", () => {
    // Found in the browser: a real drag reports every width on the way down,
    // so the narrowest was saved just before the fold.
    let l = resizePane(loadChatLayout(null), "rooms", 300);
    for (const w of [260, 220, 180, 120, 40]) l = resizePane(l, "rooms", w, { from: 300 });
    expect(l.collapsed.rooms).toBe(true);
    expect(togglePane(l, "rooms").widths.rooms).toBe(300);
  });

  it("just under the narrowest stops there instead of folding", () => {
    const out = resizePane(loadChatLayout(null), "rooms", PANE_LIMITS.rooms.min - 10);
    expect(out.widths.rooms).toBe(PANE_LIMITS.rooms.min);
    expect(out.collapsed.rooms).toBe(false);
  });

  it("both sides start open", () => {
    expect(loadChatLayout(null).collapsed).toEqual({ rooms: false, info: false });
  });
});

describe("side widths you drag", () => {
  it("come back next visit", () => {
    const wide = resizePane(loadChatLayout(null), "rooms", 300);
    expect(loadChatLayout(saveChatLayout(wide)).widths.rooms).toBe(300);
  });

  it("stay between the side's narrowest and widest", () => {
    const layout = loadChatLayout(null);
    expect(resizePane(layout, "info", 5000).widths.info).toBe(PANE_LIMITS.info.max);
    expect(loadChatLayout(JSON.stringify({ widths: { rooms: 9999 } })).widths.rooms).toBe(PANE_LIMITS.rooms.max);
  });

  it("a corrupt saved layout reads as the defaults", () => {
    expect(loadChatLayout("{not json").widths).toEqual({ rooms: PANE_LIMITS.rooms.initial, info: PANE_LIMITS.info.initial });
    expect(loadChatLayout(JSON.stringify({ widths: { rooms: "wide", info: null } })).widths).toEqual({ rooms: PANE_LIMITS.rooms.initial, info: PANE_LIMITS.info.initial });
  });
});

describe("sections you open and close", () => {
  it("rooms and members start open, about starts closed", () => {
    const layout = loadChatLayout(null);
    expect(layout.sections).toEqual({ rooms: true, members: true, about: false });
  });

  it("a section you close stays closed next visit", () => {
    const closed = toggleSection(loadChatLayout(null), "members");
    expect(loadChatLayout(saveChatLayout(closed)).sections.members).toBe(false);
  });
});
