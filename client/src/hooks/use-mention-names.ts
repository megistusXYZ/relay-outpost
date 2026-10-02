import { useEffect, useState } from "react";
import { fetchProfilesCached, getCachedProfile } from "@/lib/nostr";
import { getProfileContent } from "@/lib/nostr-helpers";
import { displayNameWith } from "@/lib/petnames";
import { mentionedPubkeys } from "@/lib/dm-text";

/** What this device calls someone (a petname first), or null when it doesn't know them yet. */
export function knownNameOf(pubkey: string): string | null {
  const event = getCachedProfile(pubkey);
  const profile = event ? getProfileContent(event as never) : null;
  const real = profile?.display_name || profile?.name || "";
  const shown = displayNameWith("person", pubkey, real);
  return shown || null;
}

/**
 * Names for the people a line of text mentions (lib/dm-text.ts readableLine).
 * Anyone not known yet is looked up, and the caller is drawn again when their
 * name arrives — so a preview says "@someone" for a moment, never a code.
 */
export function useMentionNames(text: string): (pubkey: string) => string | null {
  const [, setTick] = useState(0);
  const unknown = mentionedPubkeys(text).filter((pk) => !knownNameOf(pk)).join(",");
  useEffect(() => {
    if (!unknown) return;
    const keys = unknown.split(",");
    fetchProfilesCached(keys);
    let tries = 0;
    const poll = setInterval(() => {
      if (keys.some((pk) => knownNameOf(pk))) setTick((n) => n + 1);
      if (keys.every((pk) => knownNameOf(pk)) || ++tries >= 10) clearInterval(poll);
    }, 600);
    return () => clearInterval(poll);
  }, [unknown]);
  return knownNameOf;
}
