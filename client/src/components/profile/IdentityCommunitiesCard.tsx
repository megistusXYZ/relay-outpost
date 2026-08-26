/**
 * "Communities" on a profile — the adoption loop the owner asked for
 * (2026-08-18): see a person → see the public communities they're in →
 * shared ones first (mutual-servers social proof) → one-tap join the rest.
 *
 * Sourced ONLY from the subject's public kind-10009 (what they already told
 * the network) — never their NIP-65 (infrastructure, not places) and never
 * Concord (encrypted, invisible by design). Additive surface: renders
 * NOTHING when the subject has no public list or nobody answered — absence
 * claims nothing (TopicsStrip precedent), so no reach states are carried.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import type { Event } from "nostr-tools";
import { Users, Check } from "lucide-react";
import { pool, DEFAULT_RELAYS, FAST_RELAYS } from "@/lib/nostr";
import { fetchNip11, type Nip11Document } from "@/lib/nip11";
import { subjectCommunityRows, type SubjectCommunityRow } from "@/lib/profile-communities";
import { getOutpostRelays, getOutpostMeta, joinOutpostWithEnrichment } from "@/lib/outpost-relays";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { FOCUS_RING } from "@/lib/a11y";

const KIND_SIMPLE_GROUPS_LIST = 10009;

function hostnameOf(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

/**
 * The subject's community rows, fetched where the LAYOUT decision is made.
 * Lifted out of the card (owner QA, 2026-08-18): the section wrapper used to
 * gate on "was a card element passed", which is always true — so profiles
 * with no public list rendered an EMPTY labelled box. The page calls this
 * hook and only passes the slot when rows exist; empty means no section at
 * all, and the mobile Circle/Communities toggle only offers chips when both
 * sides truly have content.
 */
export function useSubjectCommunityRows(subjectPubkey: string | null): SubjectCommunityRow[] {
  const [rows, setRows] = useState<SubjectCommunityRow[]>([]);
  useEffect(() => {
    setRows([]);
    if (!subjectPubkey) return;
    let cancelled = false;
    const viewerJoined = new Set(getOutpostRelays().map((r) => r.url));
    const relays = Array.from(new Set([...FAST_RELAYS, ...DEFAULT_RELAYS.slice(0, 5)]));
    pool.querySync(relays, { kinds: [KIND_SIMPLE_GROUPS_LIST], authors: [subjectPubkey], limit: 3 })
      .then((events: Event[]) => {
        if (cancelled) return;
        const newest = events.sort((a, b) => b.created_at - a.created_at)[0] ?? null;
        setRows(subjectCommunityRows(newest, viewerJoined));
      })
      .catch(() => { /* additive surface — absence claims nothing */ });
    return () => { cancelled = true; };
  }, [subjectPubkey]);
  return rows;
}

export function IdentityCommunitiesCard({ rows }: { rows: SubjectCommunityRow[] }) {
  const [, navigate] = useLocation();
  const { pubkey: myPubkey } = useNostrAuth();
  const { toast } = useToast();
  const [joining, setJoining] = useState<string | null>(null);
  const [joinedNow, setJoinedNow] = useState<Set<string>>(new Set());
  // NIP-11 per row — ONE fetch answers three questions at once: the real
  // name, the icon (owner report: unjoined communities rendered generic
  // glyphs — getOutpostMeta only knows JOINED outposts), and whether the
  // relay is private (auth_required/restricted_writes → the button says
  // "Request", because that's what joining a private community IS).
  const [nip11Docs, setNip11Docs] = useState<Record<string, Nip11Document | null>>({});

  useEffect(() => {
    let cancelled = false;
    for (const row of rows) {
      if (nip11Docs[row.url] !== undefined) continue;
      fetchNip11(row.url)
        .then((doc) => { if (!cancelled) setNip11Docs((prev) => ({ ...prev, [row.url]: doc })); })
        .catch(() => { if (!cancelled) setNip11Docs((prev) => ({ ...prev, [row.url]: null })); });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const isPrivate = (url: string): boolean => {
    const lim = nip11Docs[url]?.limitation;
    return !!(lim?.auth_required || lim?.restricted_writes);
  };

  const join = async (url: string) => {
    if (!myPubkey) {
      // Guest: the community DETAIL is behind the account gate — send them to
      // the hub seeded with the name (UniversalBar's goCommunity precedent).
      navigate(`/outposts?q=${encodeURIComponent(hostnameOf(url))}`);
      return;
    }
    setJoining(url);
    const priv = isPrivate(url);
    try {
      await joinOutpostWithEnrichment(url, undefined, myPubkey);
      setJoinedNow((prev) => new Set(prev).add(url));
      const name = getOutpostMeta(url).name || nip11Docs[url]?.name || hostnameOf(url);
      toast(priv
        ? { title: "Request sent", description: `${name} is private — its operator decides who gets in. It's in your communities, waiting.` }
        : { title: "Joined", description: `You're in ${name} now.` });
    } catch {
      toast({ title: "Couldn't join", description: "The community didn't accept the join right now.", variant: "destructive" });
    } finally {
      setJoining(null);
    }
  };

  if (rows.length === 0) return null;
  return (
    <div className="space-y-1.5" data-testid="profile-communities">
      {rows.map((row) => {
        const meta = getOutpostMeta(row.url);
        const doc = nip11Docs[row.url];
        const name = meta.name || doc?.name || hostnameOf(row.url);
        const icon = meta.icon || doc?.icon;
        const priv = isPrivate(row.url);
        const isIn = row.shared || joinedNow.has(row.url);
        return (
          <div key={row.url} className="flex items-center gap-2.5" data-testid={`profile-community-${hostnameOf(row.url)}`}>
            <button
              type="button"
              onClick={() => navigate(myPubkey ? `/outposts/${encodeURIComponent(row.url)}` : `/outposts?q=${encodeURIComponent(hostnameOf(row.url))}`)}
              className={`flex items-center gap-2 min-w-0 flex-1 text-left rounded-md py-1 -my-1 px-1 -mx-1 hover:bg-primary/[0.06] transition-colors ${FOCUS_RING}`}
            >
              {icon ? (
                <img src={icon} alt="" className="w-6 h-6 rounded-md object-cover shrink-0" loading="lazy" />
              ) : (
                <span className="w-6 h-6 rounded-md bg-brand/10 text-brand flex items-center justify-center shrink-0">
                  <Users className="w-3.5 h-3.5" />
                </span>
              )}
              <span className="text-sm font-medium truncate">{name}</span>
            </button>
            {isIn ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-brand shrink-0" data-testid={`profile-community-shared-${hostnameOf(row.url)}`}>
                <Check className="w-3 h-3" /> You're both here
              </span>
            ) : (
              <button
                type="button"
                onClick={() => join(row.url)}
                disabled={joining === row.url}
                className={`shrink-0 rounded-full border border-primary/40 bg-primary/10 px-3 min-h-[32px] text-xs font-medium text-brand hover:bg-primary/20 transition-colors disabled:opacity-60 ${FOCUS_RING}`}
                title={priv ? "This community is private — the operator approves who gets in" : undefined}
                data-testid={`profile-community-join-${hostnameOf(row.url)}`}
              >
                {joining === row.url ? (priv ? "Requesting…" : "Joining…") : priv ? "Request" : "Join"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
