/**
 * "Maya invited you" on the landing, for a visitor who arrived from someone's
 * invite link. App.tsx captures ?inviter= into sessionStorage before anything
 * else; this reads it, fetches the inviter's public profile (kind 0) and names
 * them (lib/invite-greeting.ts). Nothing renders for a visitor with no inviter.
 */
import { useEffect, useState } from "react";
import { eventStore, fetchProfilesCached } from "@/lib/nostr";
import { KIND_METADATA } from "@/lib/nostr-helpers";
import { inviteGreeting } from "@/lib/invite-greeting";

type Profile = { display_name?: string; name?: string; picture?: string };

function readInviter(): string | null {
  try {
    const hex = sessionStorage.getItem("relay-outpost-inviter");
    return hex && /^[0-9a-f]{64}$/.test(hex) ? hex : null;
  } catch { return null; }
}

export function InviteGreeting() {
  const [inviter] = useState(readInviter);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!inviter) return;
    try { fetchProfilesCached([inviter]); } catch { /* the poll below still tries */ }
    let tries = 0;
    const read = () => {
      const ev = eventStore.getReplaceable?.(KIND_METADATA, inviter) as { content: string } | undefined;
      if (!ev) return false;
      try { setProfile(JSON.parse(ev.content)); } catch { /* unreadable profile: keep "A friend" */ }
      return true;
    };
    if (read()) return;
    // No awaitable "profile ready": poll the store briefly, then settle on "A friend".
    const i = setInterval(() => { if (read() || ++tries > 20) clearInterval(i); }, 500);
    return () => clearInterval(i);
  }, [inviter]);

  if (!inviter) return null;
  const picture = profile?.picture && /^https:\/\//.test(profile.picture) ? profile.picture : null;
  return (
    <div className="flex items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.06] py-1.5 pl-1.5 pr-4 backdrop-blur" data-testid="landing-invite-greeting">
      {picture
        ? <img src={picture} alt="" className="h-7 w-7 rounded-full object-cover" referrerPolicy="no-referrer" />
        : <span className="h-7 w-7 rounded-full bg-brand/40" aria-hidden="true" />}
      <span className="text-sm font-medium text-white/90">{inviteGreeting(profile)}</span>
    </div>
  );
}
