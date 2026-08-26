/**
 * What a Chats "Refresh" press is honestly allowed to claim.
 *
 * The button showed a green check and "Up to date" from a `finally` block that
 * fired unconditionally — even offline, where `loadConversations` resolves
 * without reaching a single relay (queryWithTimeout resolves on its timer, and
 * the no-signer path bails after only the IndexedDB read). So the one outcome
 * a user most needs to distrust — "we could not check" — rendered identically
 * to a real all-clear. That is the same confident-wrong-claim the reachability
 * work exists to prevent, on the control whose whole job is to answer "is
 * there anything new?".
 *
 * The refresh runs a reachability probe (canReachAny over the DM receive
 * relays) alongside the fetch; this maps the probe to the three honest states.
 */
export type RefreshOutcome = "up-to-date" | "unreachable";

export function refreshOutcome(reachedAnyRelay: boolean): RefreshOutcome {
  // "Up to date" is a claim about the network having answered. Only a relay we
  // actually reached earns it; anything else is "we couldn't ask", never a
  // silent all-clear.
  return reachedAnyRelay ? "up-to-date" : "unreachable";
}
