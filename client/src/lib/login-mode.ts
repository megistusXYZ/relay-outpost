/**
 * Where a visit to the sign-in screen starts, and where a sign-up draft
 * resumes (owner, 2026-10-10). Stated once, pure, because LoginOptions
 * carried the rule inline and it never looked at the sign-up draft: the
 * "Resume signup" pill warped to the generic fork, and a reload after the
 * password was saved opened the unlock screen for an unfinished account.
 */
export type LoginStart = "select" | "create" | "import" | "unlock";

export function initialLoginMode(env: {
  /** Adding a second account: the stored account is the one already signed in. */
  addAccountPending: boolean;
  /** The local account stored in this browser, if any. */
  localAccountPubkey: string | null;
  /** The sign-up draft in this tab, if any: whether it carries work, and its key. */
  signupDraft: { resumable: boolean; pubkey: string | null } | null;
  importDraft: boolean;
}): LoginStart {
  if (env.addAccountPending) return "select";
  const draft = env.signupDraft?.resumable ? env.signupDraft : null;
  if (env.localAccountPubkey) {
    // A stored account IS the draft's key: the password was saved, Finish
    // wasn't reached. Resume the sign-up, don't ask them to unlock it.
    return draft && draft.pubkey === env.localAccountPubkey ? "create" : "unlock";
  }
  if (draft) return "create";
  if (env.importDraft) return "import";
  return "select";
}

/** 1 = the profile step; 2 = the secure / save-your-key step (the key is stored under a password). */
export function resumeStep(env: { draftPubkey: string | null; storedPubkey: string | null }): 1 | 2 {
  return env.draftPubkey && env.storedPubkey === env.draftPubkey ? 2 : 1;
}
