import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { nip19 } from "nostr-tools";
import { ShieldCheck, BadgeCheck, Heart, MoreVertical, Pencil, Trash2, Clock } from "lucide-react";
import { use$ } from "applesauce-react/hooks";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { TrustReviewsPanel } from "@/components/TrustReviewsPanel";
import { VouchComposer } from "@/components/VouchComposer";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { ConfirmAction } from "@/components/ConfirmAction";
import { eventStore, getCachedProfile, fetchProfilesCached } from "@/lib/nostr";
import { KIND_METADATA, shortenNpub, resolveProfileDisplay } from "@/lib/nostr-helpers";
import {
  useAuthoredAttestations,
  revokeVouch,
  type AuthoredAttestation,
} from "@/hooks/use-attestations";

type Tab = "about" | "by";

function relativeTime(unix: number): string {
  const diff = Date.now() - unix * 1000;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const y = Math.floor(d / 365);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

function useSubjectProfile(pubkey: string) {
  const npub = useMemo(() => {
    try { return nip19.npubEncode(pubkey); } catch { return null; }
  }, [pubkey]);

  const storeEvent = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);

  useEffect(() => { fetchProfilesCached([pubkey]); }, [pubkey]);

  return useMemo(() => {
    const event = storeEvent ?? getCachedProfile(pubkey);
    const fallback = npub ? shortenNpub(npub) : pubkey.slice(0, 8) + "…";
    // resolveProfileDisplay never throws — a malformed subject kind-0 (numeric
    // name/picture, or a non-hex pubkey) would otherwise take down the whole
    // "By you" tab from inside this render-phase useMemo.
    const { name, avatar } = resolveProfileDisplay(event, fallback);
    return {
      npub,
      name,
      avatar,
      href: npub ? `/profile/${npub}` : "#",
    };
  }, [pubkey, npub, storeEvent]);
}

const NOTE_CLAMP = 240;

function AuthoredReviewCard({
  review,
  onEdit,
  onRemove,
}: {
  review: AuthoredAttestation;
  onEdit: (r: AuthoredAttestation, subjectName: string) => void;
  onRemove: (r: AuthoredAttestation, subjectName: string) => void;
}) {
  const profile = useSubjectProfile(review.subjectPubkey);
  const [expanded, setExpanded] = useState(false);
  const isIdentity = review.type === "identity";
  const note = review.note.trim();
  const isLong = note.length > NOTE_CLAMP;
  const shown = expanded || !isLong ? note : note.slice(0, NOTE_CLAMP).trimEnd() + "…";
  const idShort = review.subjectPubkey.slice(0, 12);

  return (
    <div
      className="rounded-lg p-3.5 space-y-2.5 bg-card/40 dark:bg-brand/[0.03]"
      style={{ border: "1px solid rgba(140, 100, 220, 0.14)" }}
      data-testid={`authored-review-${idShort}`}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={profile.href} className="flex items-center gap-2.5 min-w-0 group">
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarImage src={profile.avatar} alt={profile.name} />
            <AvatarFallback className="text-[10px]">{profile.name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <span className="block text-sm font-semibold text-foreground/90 truncate group-hover:text-foreground transition-colors">
              {profile.name}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground/50">
              <Clock className="h-2.5 w-2.5" />
              {relativeTime(review.timestamp)}
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-1.5 shrink-0">
          <Badge
            variant="outline"
            className={`gap-1 text-[10px] h-5 px-1.5 font-medium ${
              isIdentity
                ? "text-muted-foreground/70 bg-muted/20 border-border/30"
                : "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
            }`}
          >
            {isIdentity ? <BadgeCheck className="w-2.5 h-2.5" /> : <Heart className="w-2.5 h-2.5" />}
            {isIdentity ? "Identity" : "Vouched"}
          </Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/40 transition-colors"
                aria-label="Review options"
                data-testid={`button-authored-menu-${idShort}`}
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(review, profile.name)} data-testid={`menu-edit-${idShort}`}>
                <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onRemove(review, profile.name)}
                className="text-red-500 focus:text-red-500"
                data-testid={`menu-remove-${idShort}`}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {note ? (
        <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap break-words">
          {shown}
          {isLong && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="ml-1 text-xs text-brand hover:underline"
              data-testid={`button-authored-showmore-${idShort}`}
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </p>
      ) : (
        <p className="text-xs italic text-muted-foreground/50">Silent vouch (no note).</p>
      )}
    </div>
  );
}

function ByYouTimeline({ pubkey }: { pubkey: string }) {
  const { authored, loading, fetched, refetch, removeLocal } = useAuthoredAttestations(pubkey);
  const { signer } = useNostrAuth();
  const { toast } = useToast();

  const [editing, setEditing] = useState<{
    subjectPubkey: string;
    subjectName: string;
    content: string;
    type: AuthoredAttestation["type"];
  } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{ review: AuthoredAttestation; name: string } | null>(null);

  const onEdit = (r: AuthoredAttestation, subjectName: string) => {
    setEditing({ subjectPubkey: r.subjectPubkey, subjectName, content: r.note, type: r.type });
  };

  // A vouch removal is a public NIP-09 deletion — always confirm first.
  const requestRemove = (r: AuthoredAttestation, name: string) => {
    setPendingRemove({ review: r, name });
  };

  const doRemove = async (r: AuthoredAttestation) => {
    if (!signer) {
      toast({ title: "Sign in required", description: "Connect your signer to remove a vouch.", variant: "destructive" });
      return;
    }
    // Optimistic: drop the card immediately, restore (refetch) on failure.
    removeLocal(r.subjectPubkey);
    const ok = await revokeVouch({ signer, authorPubkey: pubkey, subjectPubkey: r.subjectPubkey, eventId: r.eventId });
    if (ok) {
      toast({ title: "Vouch removed" });
    } else {
      toast({ title: "Couldn't remove vouch", description: "Please try again.", variant: "destructive" });
      void refetch();
    }
  };

  if (loading && !fetched) {
    return (
      <div className="flex items-center justify-center gap-2 py-10">
        <RelayOutpostInlineLoader className="w-4 h-4 text-brand" />
        <span className="text-xs text-muted-foreground/60">Loading your reviews…</span>
      </div>
    );
  }

  if (fetched && authored.length === 0) {
    return (
      <div className="text-center py-10 space-y-2" data-testid="empty-authored-reviews">
        <Heart className="h-6 w-6 mx-auto text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground/70">You haven't vouched for anyone yet.</p>
        <p className="text-xs text-muted-foreground/50">Open someone's profile and leave a vouch to build up your network's trust.</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2.5" data-testid="list-authored-reviews">
        {authored.map((r) => (
          <AuthoredReviewCard key={r.subjectPubkey} review={r} onEdit={onEdit} onRemove={requestRemove} />
        ))}
      </div>

      <ConfirmAction
        open={!!pendingRemove}
        onOpenChange={(o) => { if (!o) setPendingRemove(null); }}
        title={pendingRemove ? `Remove your vouch for ${pendingRemove.name}?` : "Remove vouch?"}
        description="This publishes a public deletion request for your vouch. It will no longer appear on their profile or in your reviews."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => { if (pendingRemove) void doRemove(pendingRemove.review); setPendingRemove(null); }}
      />

      {editing && (
        <VouchComposer
          subjectPubkey={editing.subjectPubkey}
          subjectName={editing.subjectName}
          open={!!editing}
          onOpenChange={(o) => { if (!o) setEditing(null); }}
          existingContent={editing.content}
          existingType={editing.type}
          isUpdate
          onPublished={() => { setEditing(null); void refetch(); }}
        />
      )}
    </>
  );
}

/**
 * Trust reviews page with two views:
 *  - "About you" — vouches OTHERS left about the user (existing TrustReviewsPanel).
 *  - "By you" — a Google-Reviews-style timeline of vouches the user has AUTHORED,
 *    with edit (reuse VouchComposer) + remove (NIP-09 revoke) per card.
 */
export default function TrustReviews() {
  useDocumentTitle("Trust reviews");
  const { pubkey } = useNostrAuth();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<Tab>("about");

  useEffect(() => {
    if (!pubkey) setLocation("/");
  }, [pubkey, setLocation]);

  if (!pubkey) return null;

  return (
    <div className="max-w-xl mx-auto px-4 py-10 space-y-5" data-testid="page-trust-reviews">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/15 text-brand">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <h1 className="text-lg font-brand uppercase tracking-widest">Trust reviews</h1>
      </div>

      {/* Segmented toggle: received vs authored */}
      <div
        className="flex items-center gap-1 rounded-lg p-1"
        style={{ border: "1px solid rgba(140, 100, 220, 0.14)", background: "rgba(140, 100, 220, 0.04)" }}
        role="tablist"
      >
        <button
          role="tab"
          aria-selected={tab === "about"}
          onClick={() => setTab("about")}
          className={`flex-1 min-h-11 rounded-md text-sm font-medium transition-colors ${
            tab === "about" ? "bg-brand text-white shadow-sm" : "text-muted-foreground/70 hover:text-foreground"
          }`}
          data-testid="tab-about-you"
        >
          About you
        </button>
        <button
          role="tab"
          aria-selected={tab === "by"}
          onClick={() => setTab("by")}
          className={`flex-1 min-h-11 rounded-md text-sm font-medium transition-colors ${
            tab === "by" ? "bg-brand text-white shadow-sm" : "text-muted-foreground/70 hover:text-foreground"
          }`}
          data-testid="tab-by-you"
        >
          By you
        </button>
      </div>

      <p className="text-sm text-muted-foreground/70 leading-relaxed">
        {tab === "about"
          ? "Vouches people in your network have left about you. Trusted voices lead."
          : "Reviews you've written about other people. Edit or remove any of them."}
      </p>

      <Card className="glass-card p-4 sm:p-5">
        {tab === "about" ? <TrustReviewsPanel pubkey={pubkey} /> : <ByYouTimeline pubkey={pubkey} />}
      </Card>
    </div>
  );
}
