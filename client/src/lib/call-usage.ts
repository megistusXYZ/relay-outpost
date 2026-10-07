/**
 * The team's one line about calls (owner, 2026-10-06): "Calls right now: 3 of
 * 50", from /api/calls/usage, which answers only a request signed by the team's
 * key (server/concord-av.ts). call-usage.test.ts.
 */
import { useEffect, useState } from "react";
import { nip98 } from "nostr-tools";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { RELAY_OUTPOST_TEAM_PUBKEY } from "@shared/team-key";

export interface CallUsage { calls: number; max: number }

export function canSeeCallUsage(pubkey: string | null | undefined): boolean {
  return !!pubkey && pubkey.toLowerCase() === RELAY_OUTPOST_TEAM_PUBKEY;
}

export function callUsageLine(u: CallUsage): { text: string; nearlyFull: boolean } {
  return {
    text: u.calls === 0 ? "Calls right now: none" : `Calls right now: ${u.calls} of ${u.max}`,
    nearlyFull: u.calls >= u.max * 0.8,
  };
}

/** The figure for the team, refreshed every minute; null for everyone else, or until it answers. */
export function useCallUsage(pubkey: string | null | undefined): CallUsage | null {
  const [usage, setUsage] = useState<CallUsage | null>(null);
  const allowed = canSeeCallUsage(pubkey);
  useEffect(() => {
    if (!allowed) { setUsage(null); return; }
    let live = true;
    const load = async () => {
      const signer = getGlobalSigner();
      if (!signer) return;
      try {
        const url = `${window.location.origin}/api/calls/usage`;
        const token = await nip98.getToken(url, "GET", (e) => signer.signEvent(e as never) as never, true);
        const res = await fetch(url, { headers: { Authorization: token } });
        if (res.ok && live) setUsage((await res.json()) as CallUsage);
      } catch { /* the line just stays away */ }
    };
    void load();
    const again = setInterval(load, 60_000);
    return () => { live = false; clearInterval(again); };
  }, [allowed]);
  return usage;
}
