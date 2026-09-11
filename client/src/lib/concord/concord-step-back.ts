/**
 * What leaving a group chat says, for a member and for its owner.
 *
 * An owner can step back without ending the group. Ownership can't be handed
 * over (the group's id is a commitment to the owner's key, CORD-02), so an
 * owner who leaves stays its owner and can come back with an invite; the group
 * keeps running under its admins. Ending it for everyone is Delete, a separate
 * act. When the host can count the group's other staff, an owner leaving with
 * none is told plainly that nobody could manage it meanwhile.
 */
export interface LeaveCopy { title: string; body: string; confirm: string; done: string }

const OWNER_TAIL = "It'll disappear from your devices. You stay its owner: come back with an invite and you can do everything you could before. To end it for everyone, delete it instead.";

export function leaveCopy({ isOwner, otherStaff }: { isOwner: boolean; otherStaff?: number }): LeaveCopy {
  if (!isOwner) {
    return {
      title: "Leave this group chat?",
      body: "You'll be removed from the roster and it'll disappear from your devices. You can rejoin later with a new invite.",
      confirm: "Leave",
      done: "Left group chat",
    };
  }
  const title = "Step back from this group chat?";
  const done = "Stepped back";
  if (otherStaff === undefined) {
    return { title, body: `It keeps going without you. ${OWNER_TAIL}`, confirm: "Step back", done };
  }
  if (otherStaff > 0) {
    return { title, body: `It keeps going, and its admins run it. ${OWNER_TAIL}`, confirm: "Step back", done };
  }
  return {
    title,
    body: `It keeps going without you. ${OWNER_TAIL} No one else can manage it: until you come back, nobody can invite people, rename it or remove anyone. Make someone an admin first, or delete it instead.`,
    confirm: "Step back anyway",
    done,
  };
}
