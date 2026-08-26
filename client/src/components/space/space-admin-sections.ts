import type { SpaceCapabilities, SpaceBackend } from "@/lib/space-admin";

/**
 * Which sections the admin drawer shows, for whom, on which backend.
 *
 * TWO gates, and they answer different questions. SpaceCapabilities answers
 * "may I?" — a fact about this person. This table answers "does the concept even
 * exist here?" — a fact about the protocol. Conflating them is how a control
 * ships with nothing behind it.
 *
 * The descriptor genuinely cannot carry the second one:
 *
 *  - `manageChannels` is false on NIP-29 because a NIP-29 group IS the room.
 *    Capability and existence happen to agree, so a caps check alone would work.
 *  - `removeMessages` is TRUE for a Concord admin holding PERM.MANAGE_MESSAGES
 *    — the permission is real — but ConcordChat's receive-side fold drops any
 *    delete whose author is not the message's own author. The bit is honest and
 *    the button would still be a silent no-op.
 *
 * That second case is the whole argument. A capability can be legitimately true
 * on a backend that has nowhere to put it, so the table carries what the
 * descriptor must not lie about, and no `if (backend === …)` appears anywhere in
 * the render path.
 *
 * Two capabilities deliberately have NO section:
 *  - `removeMessages` — removal belongs on the message row, in the moment,
 *    where NIP-29 already puts it. A drawer is the wrong place to hunt for a
 *    message, and on Concord it cannot work at all (above).
 *  - `invite` — inviting is member-level, not authority. It stays in the ⋯ menu
 *    where every member reaches it. Putting it behind an admin door would REMOVE
 *    a capability from most of the people who have it.
 *
 * Pure and node-testable, in the habit of lib/admission-queue.ts: the rules that
 * decide what a moderator sees should not need a relay to check.
 */
export interface SpaceAdminSectionDef {
  id: "requests" | "people" | "history" | "channels" | "access" | "details" | "danger";
  /** Sentence-case, plain language — no protocol nouns. */
  label: string;
  /**
   * Per-backend label, where the two protocols name the same section's SUBJECT
   * differently. Only `danger` needs it, and it needs it badly: a NIP-29 drawer
   * administers ONE room, a Concord drawer administers the group chat those
   * rooms live inside. "Delete this room" is true on one and offers to delete
   * the wrong thing on the other.
   */
  labelByBackend?: Partial<Record<SpaceBackend, string>>;
  /** Absent unless this is true for the viewer. */
  capability: keyof SpaceCapabilities;
  /** Absent unless the backend has the concept at all. */
  backends: SpaceBackend[];
}

/**
 * Fixed order, most time-sensitive first.
 *
 * Someone waiting at the door outranks the roster, which outranks history,
 * which outranks configuration. "Danger" is last because nobody should reach it
 * by accident on the way to something else.
 *
 * Within configuration, `access` sits above `details` because a door is not a
 * name. `requests` still leads: someone already waiting outranks the policy
 * that let them wait.
 */
export const SPACE_ADMIN_SECTIONS: readonly SpaceAdminSectionDef[] = [
  // NIP-29 only: a Concord community admits through invites, so there is no
  // queue of strangers to approve and no section to render.
  { id: "requests", label: "Waiting to join", capability: "manageMembers", backends: ["nip29"] },
  { id: "people", label: "People", capability: "manageMembers", backends: ["concord", "nip29"] },
  { id: "history", label: "Moderation history", capability: "viewAuditLog", backends: ["concord", "nip29"] },
  // Concord only: see the module note — a NIP-29 group has no channels inside it.
  { id: "channels", label: "Rooms", capability: "manageChannels", backends: ["concord"] },
  // The door of THIS space — never the relay's allowlist. Relay Ops' Access
  // Control is NIP-86 `allowpubkey`/`banpubkey` and reaches every space on the
  // box; a space admin must not get that lever over their neighbours.
  //
  // Rides `editMetadata` because that is genuinely where both protocols put it:
  // Concord's fold checks PERM.MANAGE_METADATA for `allowMemberInvites`, and a
  // NIP-29 room's door is a kind-9002 tag behind the same single admin bit. A
  // `manageAccess` capability would invent granularity neither protocol has.
  { id: "access", label: "Who can get in", capability: "editMetadata", backends: ["concord", "nip29"] },
  { id: "details", label: "Name & description", capability: "editMetadata", backends: ["concord", "nip29"] },
  {
    id: "danger",
    label: "Delete this room",
    labelByBackend: { concord: "Delete this group chat" },
    capability: "dissolve",
    backends: ["concord", "nip29"],
  },
];

/**
 * The sections to render, in order. Everything else is ABSENT — not disabled.
 *
 * There is no third state. A disabled control still teaches that the action
 * exists and that you are being refused, which is the wrong lesson when the
 * truth is either "you don't have this" or "this doesn't exist here". The
 * drawer's header says once what you hold; the sections say nothing about what
 * you don't.
 *
 * `labelByBackend` is resolved HERE, into `label`, so every renderer keeps
 * reading one field. A drawer that had to pick between two label fields is a
 * drawer that can pick the wrong one.
 */
export function visibleSections(
  caps: SpaceCapabilities | null | undefined,
  backend: SpaceBackend,
): SpaceAdminSectionDef[] {
  if (!caps) return [];
  return SPACE_ADMIN_SECTIONS.filter(
    (s) => caps[s.capability] && s.backends.includes(backend),
  ).map((s) => {
    const override = s.labelByBackend?.[backend];
    return override ? { ...s, label: override } : s;
  });
}
