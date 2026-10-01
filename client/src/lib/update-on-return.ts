/**
 * Installed apps move onto a new build by themselves (owner, 2026-09-29).
 *
 * An installed app on iOS resumes rather than relaunches, so a phone kept
 * running an old build until someone tapped "Update ready · Restart" or
 * forced it from the menu, and people did exactly that to get a fix. Now,
 * coming back after AWAY_MS or more with a newer build ready restarts onto it:
 * to the person it's a fresh open (the launch screen, then the app). A
 * shorter break keeps their place; the pill still offers the update.
 *
 * Never while they've typed something unsent, or while audio or video is
 * playing (a call, a podcast): the pill waits instead.
 */
export const AWAY_MS = 15 * 60 * 1000;

/** Something a restart would lose: unsent writing, or playing media. */
export function pageLooksBusy(doc: Document): boolean {
  for (const m of Array.from(doc.querySelectorAll<HTMLMediaElement>("audio, video"))) {
    if (!m.paused) return true;
  }
  const fields = doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input");
  for (const f of Array.from(fields)) {
    if (f instanceof HTMLInputElement) {
      const type = (f.type || "text").toLowerCase();
      if (type !== "text") continue; // search, checkbox, number, … aren't writing
      if (f.getAttribute("role") === "searchbox" || /search/i.test(f.placeholder || "")) continue;
    }
    if (f.value.trim().length > 0) return true;
  }
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[contenteditable='true']"))) {
    if ((el.textContent || "").trim().length > 0) return true;
  }
  return false;
}

export function installUpdateOnReturn(opts: {
  /** Is a newer build ready? (asks the server when needed) */
  checkForUpdate: () => Promise<boolean>;
  /** Restart onto it. */
  apply: () => void;
  now?: () => number;
  doc?: Document;
  /** Anything else that means "in the middle of something" (a call, the signup flow). */
  alsoBusy?: () => boolean;
}): () => void {
  const doc = opts.doc ?? document;
  const now = opts.now ?? Date.now;
  let hiddenAt: number | null = doc.visibilityState === "hidden" ? now() : null;

  const onVisibility = async () => {
    if (doc.visibilityState === "hidden") {
      hiddenAt = now();
      return;
    }
    if (hiddenAt === null) return;
    const away = now() - hiddenAt;
    hiddenAt = null;
    if (away < AWAY_MS) return;
    let ready = false;
    try { ready = await opts.checkForUpdate(); } catch { ready = false; }
    if (ready && doc.visibilityState === "visible" && !pageLooksBusy(doc) && !opts.alsoBusy?.()) opts.apply();
  };

  doc.addEventListener("visibilitychange", onVisibility);
  return () => doc.removeEventListener("visibilitychange", onVisibility);
}
