import { describe, it, expect } from "vitest";
import {
  buildChatRenderItems,
  summarizeSystemRun,
  type ChatRenderItem,
  type ChatSystemEvent,
} from "./chat-render-items";
import type { GroupMessage } from "@/lib/nip29";

// Minimal GroupMessage factory — only the fields the render model reads.
function msg(id: string, pubkey: string, createdAt: number): GroupMessage {
  return { id, pubkey, content: id, createdAt, tags: [] } as unknown as GroupMessage;
}
function sys(id: string, pubkey: string, kind: "join" | "leave", createdAt: number): ChatSystemEvent {
  return { id, pubkey, kind, createdAt };
}

const groups = (items: ChatRenderItem[]) =>
  items.filter((i): i is Extract<ChatRenderItem, { type: "system-group" }> => i.type === "system-group");
const msgs = (items: ChatRenderItem[]) =>
  items.filter((i): i is Extract<ChatRenderItem, { type: "msg" }> => i.type === "msg");

describe("summarizeSystemRun", () => {
  it("collapses consecutive joins into one group with correct names/count", () => {
    const g = summarizeSystemRun([
      sys("e1", "alice", "join", 10),
      sys("e2", "bob", "join", 11),
      sys("e3", "carol", "join", 12),
    ]);
    expect(g).not.toBeNull();
    expect(g!.joins).toEqual(["alice", "bob", "carol"]);
    expect(g!.leaves).toEqual([]);
    expect(g!.createdAt).toBe(12);
  });

  it("suppresses a join+leave no-op by the SAME pubkey", () => {
    // "Ytuu joined · Ytuu left" must vanish entirely.
    const g = summarizeSystemRun([
      sys("e1", "ytuu", "join", 10),
      sys("e2", "ytuu", "leave", 11),
    ]);
    expect(g).toBeNull();
  });

  it("keeps real joiners/leavers while dropping only the churned pubkey", () => {
    const g = summarizeSystemRun([
      sys("e1", "ytuu", "join", 10), // churn (also leaves below)
      sys("e2", "alice", "join", 11),
      sys("e3", "ytuu", "leave", 12), // churn → drops ytuu
      sys("e4", "bob", "leave", 13),
    ]);
    expect(g).not.toBeNull();
    expect(g!.joins).toEqual(["alice"]);
    expect(g!.leaves).toEqual(["bob"]);
  });

  it("preserves first-seen order for joins and leaves independently", () => {
    const g = summarizeSystemRun([
      sys("e1", "carol", "join", 10),
      sys("e2", "alice", "join", 11),
      sys("e3", "bob", "join", 12),
    ]);
    expect(g!.joins).toEqual(["carol", "alice", "bob"]);
  });
});

describe("buildChatRenderItems", () => {
  it("collapses a run of adjacent membership events into ONE system-group item", () => {
    const items = buildChatRenderItems(
      [],
      [
        sys("e1", "alice", "join", 100),
        sys("e2", "bob", "join", 101),
        sys("e3", "carol", "leave", 102),
      ],
      null,
      0,
    );
    const g = groups(items);
    expect(g).toHaveLength(1);
    expect(g[0].joins).toEqual(["alice", "bob"]);
    expect(g[0].leaves).toEqual(["carol"]);
  });

  it("drops a pure join+leave no-op so no system-group is emitted", () => {
    const items = buildChatRenderItems(
      [],
      [sys("e1", "ytuu", "join", 100), sys("e2", "ytuu", "leave", 101)],
      null,
      0,
    );
    expect(groups(items)).toHaveLength(0);
  });

  it("a message between two system events BREAKS the group into two", () => {
    const items = buildChatRenderItems(
      [msg("m1", "alice", 150)],
      [sys("e1", "bob", "join", 100), sys("e2", "carol", "join", 200)],
      null,
      0,
    );
    const g = groups(items);
    expect(g).toHaveLength(2);
    expect(g[0].joins).toEqual(["bob"]);
    expect(g[1].joins).toEqual(["carol"]);
    // …and the message survives between them.
    expect(msgs(items)).toHaveLength(1);
  });

  it("preserves chronological ordering of groups and messages", () => {
    const items = buildChatRenderItems(
      [msg("m1", "alice", 50), msg("m2", "alice", 250)],
      [sys("e1", "bob", "join", 100), sys("e2", "carol", "join", 101), sys("e3", "dave", "leave", 300)],
      null,
      0,
    );
    const seq = items
      .filter((i) => i.type === "msg" || i.type === "system-group")
      .map((i) => (i.type === "msg" ? `msg:${i.msg.id}` : `grp:${i.joins.join("+")}|${i.leaves.join("+")}`));
    expect(seq).toEqual([
      "msg:m1",
      "grp:bob+carol|",
      "msg:m2",
      "grp:|dave",
    ]);
  });

  it("does not disturb per-sender message clustering around a system run", () => {
    // Two messages from the same author, a membership run between them → the run
    // ends the cluster, so the second message starts a fresh cluster (avatar+name
    // shown again).
    const items = buildChatRenderItems(
      [msg("m1", "alice", 10), msg("m2", "alice", 20)],
      [sys("e1", "bob", "join", 15)],
      null,
      0,
    );
    const m = msgs(items);
    expect(m).toHaveLength(2);
    expect(m[0].isClusterEnd).toBe(true);
    expect(m[1].isClusterStart).toBe(true);
  });
});
