/**
 * Joins and Leaves (kind 3306, Guestbook): "self-signed, the content is the
 * verb" (CORD-02 §5; examples §3.1). Ours carried the verb in an `action` tag
 * with empty content, and read anything without that tag as a Join. So a Leave
 * sent from Armada or Vector read here as a Join, and they could not read ours.
 */
import { describe, it, expect } from "vitest";
import { computeRoster, foldEditions, buildJoinLeaveRumor } from "./concord-events";
import { computeMembershipEvents } from "./concord-activity";

const owner = "0a".repeat(32), alice = "0d".repeat(32);
const fromArmada = (pk: string, verb: string, t: number) =>
  ({ id: `${verb}-${t}`, kind: 3306, pubkey: pk, created_at: t, content: verb, tags: [["ms", "0"]] });

describe("joins and leaves between apps", () => {
  it("a Leave from Armada or Vector, the verb in its content, reads as a leave", () => {
    const events = [fromArmada(alice, "join", 100), fromArmada(alice, "leave", 200)];
    expect(computeRoster(events, foldEditions([], owner), owner).map((m) => m.pubkey)).not.toContain(alice);
    expect(computeMembershipEvents(events)[0]).toMatchObject({ pubkey: alice, action: "leave" });
  });

  it("ours carry the verb in the content for other apps, and keep the tag older versions of this app read", () => {
    const leave = buildJoinLeaveRumor(alice, false, 200);
    expect(leave.content).toBe("leave");
    expect(leave.tags).toContainEqual(["action", "leave"]);
    expect(buildJoinLeaveRumor(alice, true, 100).content).toBe("join");
  });
});
