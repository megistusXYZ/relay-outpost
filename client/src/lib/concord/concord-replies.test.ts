/**
 * How one Concord message references another (CORD-03, examples §2.1–2.2):
 * a reply in the room is an INLINE QUOTE (kind 9 + `q`, shown in the room);
 * a reply in a thread is a kind-1111 comment whose uppercase root tags are
 * inherited verbatim, so the root stays stable at any depth. We used to send
 * every reply as a 1111 whose root was its parent, so in Armada and Vector each
 * reply opened a thread of its own.
 */
import { describe, it, expect } from "vitest";
import { buildMessageRumor, buildReplyRumor, type RumorTemplate } from "./concord-events";
import { readMessageShape, threadReplyRef } from "./concord-replies";
import { groupThreads } from "./concord-threads";

const alice = "a1".repeat(32);
const bob = "b2".repeat(32);
const room = "c3".repeat(32);
const withId = (t: RumorTemplate, id: string) => ({ ...t, id });

describe("replying in the room", () => {
  it("is an inline quote: a kind 9 carrying q, shown in the room with the quoted card", () => {
    const quoted = withId(buildMessageRumor(bob, room, 0n, "Hey chat!", 1, 100), "11".repeat(32));
    const reply = withId(buildMessageRumor(alice, room, 0n, "Welcome!", 2, 101, { quote: { id: quoted.id, pubkey: bob } }), "22".repeat(32));

    expect(reply.kind).toBe(9);
    expect(reply.tags).toContainEqual(["q", quoted.id, "", bob]);

    const shape = readMessageShape(reply);
    expect(shape.replyTo).toEqual({ id: quoted.id, pubkey: bob });
    expect(shape.root).toBeUndefined();

    const grouped = groupThreads([
      { id: quoted.id, pubkey: bob, t: 100 },
      { id: reply.id, pubkey: alice, t: 101, rootId: shape.root?.id },
    ]);
    expect(grouped.timeline.map((m) => m.id)).toEqual([quoted.id, reply.id]);
  });
});

describe("replying in a thread", () => {
  const carol = "d4".repeat(32);
  const starter = withId(buildMessageRumor(bob, room, 0n, "Who's in for Friday?", 1, 100), "11".repeat(32));

  it("is a kind 1111; a reply to a reply keeps the thread's root, so the thread holds together", () => {
    const first = withId(buildReplyRumor(alice, room, 0n, "Me!", 2, 101,
      threadReplyRef({ id: starter.id, pubkey: bob, kind: 9 })), "22".repeat(32));
    expect(first.kind).toBe(1111);
    // examples §2.2: uppercase = the thread root, lowercase = the immediate parent.
    expect(first.tags).toEqual(expect.arrayContaining([
      ["K", "9"], ["E", starter.id, "", bob], ["P", bob],
      ["k", "9"], ["e", starter.id, "", bob], ["p", bob],
    ]));

    const firstShape = readMessageShape(first);
    const second = withId(buildReplyRumor(carol, room, 0n, "Me too", 3, 102,
      threadReplyRef({ id: first.id, pubkey: alice, kind: firstShape.kind, root: firstShape.root })), "33".repeat(32));
    // "A reply inherits its parent's uppercase root tags verbatim."
    expect(second.tags).toEqual(expect.arrayContaining([
      ["K", "9"], ["E", starter.id, "", bob], ["P", bob],
      ["k", "1111"], ["e", first.id, "", alice], ["p", alice],
    ]));

    const secondShape = readMessageShape(second);
    expect(secondShape.replyTo).toEqual({ id: first.id, pubkey: alice });
    expect(secondShape.root).toEqual({ id: starter.id, pubkey: bob, kind: 9 });

    const grouped = groupThreads([
      { id: starter.id, pubkey: bob, t: 100 },
      { id: first.id, pubkey: alice, t: 101, rootId: firstShape.root?.id },
      { id: second.id, pubkey: carol, t: 102, rootId: secondShape.root?.id },
    ]);
    expect(grouped.timeline.map((m) => m.id)).toEqual([starter.id]);
    expect(grouped.threads.get(starter.id)?.map((m) => m.id)).toEqual([first.id, second.id]);
  });
});

describe("replies sent before this change", () => {
  const starter = "11".repeat(32);
  const inRoom = (tags: string[][]) => ({ kind: 1111, tags: [["channel", room], ["epoch", "0"], ["ms", "1"], ...tags] });

  it("still gather under their thread: our old two-part root, and a reply with no root at all", () => {
    const ours = readMessageShape(inRoom([["K", "9"], ["E", starter], ["P", bob], ["k", "9"], ["e", starter], ["p", bob]]));
    const bare = readMessageShape(inRoom([["e", starter], ["p", bob]]));
    expect(ours.root).toEqual({ id: starter, pubkey: bob, kind: 9 });
    expect(bare.root).toEqual({ id: starter, pubkey: bob, kind: 9 });
    const grouped = groupThreads([
      { id: starter, pubkey: bob, t: 100 },
      { id: "22".repeat(32), pubkey: alice, t: 101, rootId: ours.root?.id },
      { id: "33".repeat(32), pubkey: alice, t: 102, rootId: bare.root?.id },
    ]);
    expect(grouped.timeline.map((m) => m.id)).toEqual([starter]);
    expect(grouped.threads.get(starter)).toHaveLength(2);
  });
});

describe("another client's reply to a reply, root named without its author", () => {
  it("keeps the thread's root, taking the root's author from P", () => {
    const starter = "11".repeat(32);
    const middle = "22".repeat(32);
    const shape = readMessageShape({ kind: 1111, tags: [["channel", room], ["epoch", "0"], ["K", "9"], ["E", starter], ["P", bob], ["k", "1111"], ["e", middle], ["p", alice]] });
    expect(shape.root).toEqual({ id: starter, pubkey: bob, kind: 9 });
    expect(shape.replyTo).toEqual({ id: middle, pubkey: alice });
  });
});
