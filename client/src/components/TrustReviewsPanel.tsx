import { useEffect, useMemo, useState, useCallback, type ElementType } from "react";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import {
  useAttestations,
  isActiveAttestation,
  fetchVouchResponses,
  publishVouchResponse,
  type Attestation,
  type VouchResponse,
} from "@/hooks/use-attestations";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { useNostrMuteList } from "@/hooks/use-nostr-mute-list";
import { isMutedPubkey, isReportedEvent, onMuteChange, onSpamListChange } from "@/lib/spam-filter";
import { use$ } from "applesauce-react/hooks";
import { eventStore, getCachedProfile, fetchProfilesCached } from "@/lib/nostr";
import { KIND_METADATA, getDisplayName, getAvatarUrl } from "@/lib/nostr-helpers";
import { shortenNpub } from "@/lib/nostr-helpers";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { TrustTierDot } from "@/components/nostr-post/author-hover";
import { ShieldCheck, ChevronDown, ChevronUp, Clock, BadgeCheck, Heart, Plus, MoreVertical, Flag, VolumeX, MessageSquare } from "lucide-react";
import { Link } from "wouter";
import { VouchComposer } from "@/components/VouchComposer";
import { ReportDialog } from "@/components/ReportDialog";

function formatDate(unix: number): string {
  const d = new Date(unix * 1000);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatFullDate(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function timeAgo(unix: number): string {
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  return formatDate(unix);
}

type EnrichedAttestation = Attestation & {
  influence: number | undefined;
  isTrusted: boolean;
};

// Resolve a reviewer's display name + avatar the way the rest of the app does
// (MentionProfileLink): a REACTIVE kind-0 subscription on the eventStore plus a
// cached fetch kick. The old version read getCachedProfile once inside a
// useMemo, so rows stayed on the shortened-npub fallback forever when the
// profile arrived after first render. Falls back to a shortened npub — never
// raw hex — while the kind-0 is still unknown.
function useReviewerProfile(pubkey: string) {
  const npub = useMemo(() => {
    try { return pubkey ? nip19.npubEncode(pubkey) : null; } catch { return null; }
  }, [pubkey]);

  // Re-renders when the reviewer's kind-0 lands in the eventStore
  // (fetchProfilesCached feeds the store as events stream in).
  const storeEvent = use$(
    () => (pubkey ? eventStore.replaceable(KIND_METADATA, pubkey) : undefined),
    [pubkey]
  );

  useEffect(() => {
    if (pubkey) fetchProfilesCached([pubkey]);
  }, [pubkey]);

  return useMemo(() => {
    const event = storeEvent ?? (pubkey ? getCachedProfile(pubkey) : undefined);
    const name = event ? getDisplayName(event) : undefined;
    const avatar = event ? getAvatarUrl(event) : undefined;
    const fallbackName = npub ? shortenNpub(npub) : pubkey.slice(0, 8) + "…";
    return {
      npub,
      name: name && name.trim() ? name : fallbackName,
      avatar: avatar || "",
      href: npub ? `/profile/${npub}` : "#",
    };
  }, [pubkey, npub, storeEvent]);
}

// ONE consolidated chip per card/modal — replaces the old dual
// (AttestationStatusBadge + TypeLabel) badges.
//   - Genuinely verified (status "verified" | "accepted")  → green "Verified" + BadgeCheck.
//   - Otherwise a type chip: "identity" → "Identity" (BadgeCheck), else "Vouch" (Heart).
//     Muted/subtle styling so it reads as a quiet label, not a status claim.
function VouchBadge({ attestation }: { attestation: Attestation }) {
  const isVerified = attestation.status === "verified" || attestation.status === "accepted";

  let label: string;
  let Icon: typeof BadgeCheck;
  let className: string;

  if (isVerified) {
    label = "Verified";
    Icon = BadgeCheck;
    className = "text-emerald-500 bg-emerald-500/10 border-emerald-500/20";
  } else if (attestation.type === "identity") {
    label = "Identity";
    Icon = BadgeCheck;
    className = "text-muted-foreground/70 bg-muted/20 border-border/30";
  } else {
    label = "Vouch";
    Icon = Heart;
    className = "text-muted-foreground/70 bg-muted/20 border-border/30";
  }

  return (
    <Badge
      variant="outline"
      className={`gap-1 text-[10px] h-5 px-1.5 font-medium ${className}`}
    >
      <Icon className="w-2.5 h-2.5" />
      {label}
    </Badge>
  );
}

// Reviewer identity row: clickable avatar + name → /profile/{npub}, plus a subtle
// in-network signal (TrustTierDot, which self-gates on WoT + presence of a score).
// We never render a raw negative influence percentage.
function AttesterInfo({
  pubkey,
  isTrusted,
  showNetworkLabel = true,
}: {
  pubkey: string;
  isTrusted: boolean;
  showNetworkLabel?: boolean;
}) {
  const profile = useReviewerProfile(pubkey);

  return (
    <div className="flex items-center gap-2 min-w-0">
      <Link href={profile.href} className="shrink-0">
        <Avatar className="w-8 h-8 ring-1 ring-border/30 border border-background cursor-pointer hover:ring-brand/40 transition-all">
          <AvatarImage src={profile.avatar} alt={profile.name} />
          <AvatarFallback className="text-[10px] bg-muted text-muted-foreground font-bold">
            {profile.name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={profile.href} className="no-underline">
          <span className="text-xs font-medium text-foreground/90 truncate block cursor-pointer hover:text-brand transition-colors">
            {profile.name}
          </span>
        </Link>
        {showNetworkLabel && (
          <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground/60">
            {isTrusted ? (
              <>
                <span className="inline-flex items-center justify-center">
                  <TrustTierDot pubkey={pubkey} />
                </span>
                <span className="text-emerald-500/80">in your network</span>
              </>
            ) : (
              <span className="text-muted-foreground/40">outside your network</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

// Per-vouch ⋮ moderation menu: Report (opens the shared ReportDialog targeting
// the VOUCH event, kind 1984) and Mute reviewer (NIP mute list). Hidden on the
// viewer's own vouch. The trigger stops click propagation so it doesn't open the
// card's review dialog. ≥44px tap target.
function VouchMenu({
  attestation,
  onReport,
  onMute,
}: {
  attestation: EnrichedAttestation;
  onReport: () => void;
  onMute: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 inline-flex items-center justify-center w-9 h-9 -m-1 rounded-md text-muted-foreground/50 hover:text-foreground/80 hover:bg-white/[0.05] transition-colors"
          aria-label="Vouch options"
          data-testid={`vouch-menu-${attestation.eventId}`}
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="glass-dropdown-content">
        <DropdownMenuItem
          className="gap-2.5 cursor-pointer text-destructive"
          onSelect={() => setTimeout(onReport, 0)}
          data-testid={`vouch-report-${attestation.eventId}`}
        >
          <Flag className="w-3.5 h-3.5" />
          Report vouch
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2.5 cursor-pointer text-destructive"
          onSelect={() => setTimeout(onMute, 0)}
          data-testid={`vouch-mute-${attestation.eventId}`}
        >
          <VolumeX className="w-3.5 h-3.5" />
          Mute reviewer
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// An existing owner response shown inline under its vouch. Plain text, breaks
// words. Visible to everyone.
function OwnerResponseBlock({ response }: { response: VouchResponse }) {
  return (
    <div className="mt-2 pl-3 border-l-2 border-emerald-500/25">
      <div className="text-[10px] font-medium text-emerald-800/80 dark:text-emerald-400/80 mb-0.5 flex items-center gap-1">
        <MessageSquare className="w-2.5 h-2.5" />
        Owner's response
      </div>
      <p className="text-xs text-foreground/75 leading-relaxed whitespace-pre-wrap break-words">
        {response.content}
      </p>
    </div>
  );
}

const RESPONSE_MAX_LEN = 500;

// Minimal inline composer for the profile owner to respond to a vouch. Reuses
// the VouchComposer textarea styling. Publishes a kind-1111 then calls onPublished.
function OwnerResponseComposer({
  attestation,
  subjectPubkey,
  existing,
  onPublished,
  onCancel,
}: {
  attestation: EnrichedAttestation;
  subjectPubkey: string;
  existing?: VouchResponse;
  onPublished: () => void;
  onCancel: () => void;
}) {
  const { signer } = useNostrAuth();
  const [text, setText] = useState(existing?.content || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePublish = async () => {
    setError(null);
    if (!signer) {
      setError("You need to be signed in to respond.");
      return;
    }
    if (!text.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const ok = await publishVouchResponse({
        signer,
        subjectPubkey,
        vouch: { eventId: attestation.eventId, attesterPubkey: attestation.attesterPubkey },
        content: text,
      });
      if (!ok) {
        setError("Could not publish your response. Please try again.");
        return;
      }
      onPublished();
    } catch {
      setError("Could not publish your response. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, RESPONSE_MAX_LEN))}
        placeholder="Write a public response…"
        className="text-sm bg-white/[0.03] border-emerald-500/15 focus-visible:border-emerald-500/30 min-h-[60px] resize-none"
        style={{ fontSize: 16 }}
        maxLength={RESPONSE_MAX_LEN}
        data-testid={`response-text-${attestation.eventId}`}
        aria-label="Owner response text"
      />
      {error && <p className="text-xs text-red-700/90 dark:text-red-400/90" role="alert">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <span className="text-[10px] text-muted-foreground/50 mr-auto">
          {text.length}/{RESPONSE_MAX_LEN}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-3 text-xs min-h-[44px]"
          onClick={onCancel}
          disabled={isSubmitting}
          data-testid={`response-cancel-${attestation.eventId}`}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-9 px-3 text-xs min-h-[44px] bg-emerald-600/80 hover:bg-emerald-600"
          onClick={handlePublish}
          disabled={isSubmitting || !text.trim() || !signer}
          data-testid={`response-publish-${attestation.eventId}`}
        >
          {isSubmitting ? "Publishing…" : "Publish"}
        </Button>
      </div>
    </div>
  );
}

function AttestationCard({
  attestation,
  onOpen,
  showTrust,
  isOwn,
  isOwnerView,
  response,
  onReport,
  onMute,
  onRespond,
}: {
  attestation: EnrichedAttestation;
  onOpen: () => void;
  // When false (logged out / WoT off) we do not render trust badges.
  showTrust: boolean;
  // The viewer's own vouch — no moderation menu on it.
  isOwn: boolean;
  // The viewer is the profile owner — show Respond action.
  isOwnerView: boolean;
  response?: VouchResponse;
  onReport: () => void;
  onMute: () => void;
  onRespond: () => void;
}) {
  const isActive = isActiveAttestation(attestation);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer ${isActive ? "bg-card/50 border-border/30 hover:border-emerald-500/30" : "bg-muted/20 border-border/20 opacity-70 hover:opacity-90"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <AttesterInfo pubkey={attestation.attesterPubkey} isTrusted={attestation.isTrusted} showNetworkLabel={showTrust} />
        <div className="flex items-start gap-1.5 shrink-0">
          <VouchBadge attestation={attestation} />
          {!isOwn && <VouchMenu attestation={attestation} onReport={onReport} onMute={onMute} />}
        </div>
      </div>

      {/* Content area is ALWAYS rendered for consistent vertical rhythm. */}
      {attestation.content ? (
        <p className="text-xs text-foreground/70 mt-2 leading-relaxed break-words line-clamp-2">
          {attestation.content}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground/50 italic mt-2 leading-relaxed">
          Silent vouch · no note
        </p>
      )}

      <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground/50">
        <span className="flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          {timeAgo(attestation.createdAt)}
        </span>
      </div>

      {response && <OwnerResponseBlock response={response} />}

      {isOwnerView && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRespond(); }}
          className="mt-2 inline-flex items-center gap-1 min-h-[44px] py-1 text-[11px] font-medium text-emerald-800/80 dark:text-emerald-400/80 hover:text-emerald-800 dark:hover:text-emerald-300 transition-colors"
          data-testid={`vouch-respond-${attestation.eventId}`}
        >
          <MessageSquare className="w-3 h-3" />
          {response ? "Edit response" : "Respond"}
        </button>
      )}
    </div>
  );
}

// Full review in a clean dialog: reviewer (clickable, with trust signal), full
// text, type, full date, and a profile link.
function ReviewDialog({
  attestation,
  open,
  onOpenChange,
  showTrust,
  isOwn,
  isOwnerView,
  subjectPubkey,
  response,
  onReport,
  onMute,
  onResponsePublished,
}: {
  attestation: EnrichedAttestation | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  showTrust: boolean;
  isOwn: boolean;
  isOwnerView: boolean;
  subjectPubkey: string;
  response?: VouchResponse;
  onReport: () => void;
  onMute: () => void;
  onResponsePublished: () => void;
}) {
  const profile = useReviewerProfile(attestation?.attesterPubkey || "");
  const [composing, setComposing] = useState(false);

  // Reset the composer whenever the dialog opens for a (possibly new) vouch.
  useEffect(() => {
    if (!open) setComposing(false);
  }, [open, attestation?.eventId]);

  if (!attestation) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="w-4 h-4 text-emerald-500/80" />
            Trust Review
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <AttesterInfo
              pubkey={attestation.attesterPubkey}
              isTrusted={attestation.isTrusted}
              showNetworkLabel={showTrust}
            />
            <div className="flex items-start gap-1.5 shrink-0">
              <VouchBadge attestation={attestation} />
              {!isOwn && <VouchMenu attestation={attestation} onReport={onReport} onMute={onMute} />}
            </div>
          </div>

          {attestation.content ? (
            <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap break-words">
              {attestation.content}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground/60 italic">
              No written review — a silent vouch.
            </p>
          )}

          {response && !composing && <OwnerResponseBlock response={response} />}

          {isOwnerView && composing ? (
            <OwnerResponseComposer
              attestation={attestation}
              subjectPubkey={subjectPubkey}
              existing={response}
              onPublished={() => { setComposing(false); onResponsePublished(); }}
              onCancel={() => setComposing(false)}
            />
          ) : isOwnerView ? (
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="inline-flex items-center gap-1 min-h-[44px] py-1 text-xs font-medium text-emerald-800/80 dark:text-emerald-400/80 hover:text-emerald-800 dark:hover:text-emerald-300 transition-colors"
              data-testid={`vouch-respond-dialog-${attestation.eventId}`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              {response ? "Edit response" : "Respond to this vouch"}
            </button>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-2 border-t border-border/20 text-[11px] text-muted-foreground/60">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatFullDate(attestation.createdAt)}
            </span>
            {attestation.validFrom && attestation.validTo && (
              <span>
                Valid {formatDate(attestation.validFrom)} — {formatDate(attestation.validTo)}
              </span>
            )}
          </div>

          <Link href={profile.href} className="no-underline">
            <Button variant="outline" size="sm" className="w-full text-xs">
              View {profile.name}'s profile
            </Button>
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TrustReviewsPanel({ pubkey, embedded = false }: { pubkey: string; embedded?: boolean }) {
  const { pubkey: myPubkey } = useNostrAuth();
  const { scores, requestScore, wotEnabled } = useGrapeRankScores();
  const { attestations, fetched, fetch: fetchAttestations } = useAttestations(pubkey);
  const { mutePubkey } = useNostrMuteList();
  const [expanded, setExpanded] = useState(false);
  const [showLowTrust, setShowLowTrust] = useState(false);
  const [selected, setSelected] = useState<EnrichedAttestation | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  // Vouch currently targeted by the shared ReportDialog.
  const [reportTarget, setReportTarget] = useState<EnrichedAttestation | null>(null);
  // Owner responses keyed by vouch id (latest per vouch).
  const [responses, setResponses] = useState<Map<string, VouchResponse>>(new Map());
  // Bumped on mute/report list changes so the filter below re-evaluates live.
  const [modVersion, setModVersion] = useState(0);

  useEffect(() => {
    fetchAttestations();
  }, [fetchAttestations]);

  // React live to mute / report / spam-list changes (a fresh mute or report must
  // immediately drop the offending vouch from the list). spam-filter exposes
  // onMuteChange (also fired by addReportedItem) and onSpamListChange.
  useEffect(() => {
    const bump = () => setModVersion((v) => v + 1);
    const offMute = onMuteChange(bump);
    const offSpam = onSpamListChange(bump);
    return () => { offMute(); offSpam(); };
  }, []);

  // Once attestations resolve, prefetch the kind-0 profiles for every reviewer so
  // names/avatars resolve reliably (instead of falling back to a shortened npub),
  // and request GrapeRank scores to compute the in-network signal.
  useEffect(() => {
    if (!fetched || attestations.length === 0) return;
    fetchProfilesCached(attestations.map((a) => a.attesterPubkey));
    if (scores && requestScore) {
      for (const att of attestations) {
        if (!scores.has(att.attesterPubkey)) requestScore(att.attesterPubkey);
      }
    }
  }, [fetched, attestations, scores, requestScore]);

  // After attestations load, fetch the profile owner's (subject's) kind-1111
  // responses that #e-tag any of the loaded vouch ids. Latest per vouch.
  const loadResponses = useCallback(async () => {
    if (!fetched || attestations.length === 0) return;
    const ids = attestations.map((a) => a.eventId);
    const map = await fetchVouchResponses(pubkey, ids);
    setResponses(map);
  }, [fetched, attestations, pubkey]);

  useEffect(() => {
    loadResponses();
  }, [loadResponses]);

  // Trust signals are only honest when the viewer is signed in AND WoT is on
  // (scores are observer-relative to myPubkey). Logged out / WoT off → no badges.
  const showTrust = !!myPubkey && wotEnabled;

  const enrichedAttestations = useMemo<EnrichedAttestation[]>(() => {
    if (!fetched || attestations.length === 0) return [];
    // Hide vouches whose reviewer is muted or whose event was reported. modVersion
    // is a dependency so this recomputes when the mute/report lists change live.
    void modVersion;
    const visible = attestations.filter(
      (att) => !isMutedPubkey(att.attesterPubkey) && !isReportedEvent(att.eventId)
    );
    const enriched = visible.map((att) => ({
      ...att,
      influence: scores?.get(att.attesterPubkey),
      isTrusted: (scores?.get(att.attesterPubkey) ?? -1) >= 0.02,
    }));
    // Trusted / in-network reviewers first, then by influence desc, then recency.
    return enriched.sort((a, b) => {
      const aActive = isActiveAttestation(a) ? 1 : 0;
      const bActive = isActiveAttestation(b) ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      const aInf = a.influence ?? -1;
      const bInf = b.influence ?? -1;
      if (aInf !== bInf) return bInf - aInf;
      return b.createdAt - a.createdAt;
    });
  }, [attestations, fetched, scores, modVersion]);

  const activeCount = useMemo(
    () => enrichedAttestations.filter((a) => isActiveAttestation(a)).length,
    [enrichedAttestations]
  );
  const trustedCount = useMemo(
    () => enrichedAttestations.filter((a) => isActiveAttestation(a) && a.isTrusted).length,
    [enrichedAttestations]
  );

  // Split trusted vs lower-trust so we can show the lower-trust set behind an
  // expander. The existing show-3-then-expand still applies within the trusted set.
  const trustedReviews = useMemo(
    () => enrichedAttestations.filter((a) => a.isTrusted),
    [enrichedAttestations]
  );
  const lowTrustReviews = useMemo(
    () => enrichedAttestations.filter((a) => !a.isTrusted),
    [enrichedAttestations]
  );

  const isOwnProfile = myPubkey === pubkey;
  // A signed-in viewer (not looking at their own profile) can write/update a vouch.
  const canVouch = !!myPubkey && !isOwnProfile;

  // Moderation handlers (Phase B). After report/mute, the Phase-A filter hides
  // the vouch — report flows through ReportDialog → addReportedItem (fires
  // onMuteChange), mute flows through the NIP mute list (fires onMuteChange too).
  const handleReport = useCallback((att: EnrichedAttestation) => {
    setReportTarget(att);
  }, []);
  const handleMute = useCallback((att: EnrichedAttestation) => {
    mutePubkey(att.attesterPubkey);
  }, [mutePubkey]);

  // The vouch the ReportDialog targets, shaped as the minimal Event it reads
  // (id + pubkey). Report is filed against the VOUCH event + reviewer, kind 1984.
  const reportEvent = useMemo<Event | null>(() => {
    if (!reportTarget) return null;
    return {
      id: reportTarget.eventId,
      pubkey: reportTarget.attesterPubkey,
      kind: reportTarget.kind,
      content: reportTarget.content,
      created_at: reportTarget.createdAt,
      tags: [],
      sig: "",
    } as Event;
  }, [reportTarget]);

  // Resolve the subject's display name for the composer copy (falls back to a
  // generic phrase when the kind-0 isn't cached yet).
  const subjectName = useMemo(() => {
    const ev = getCachedProfile(pubkey);
    const n = ev ? getDisplayName(ev) : "";
    return n && n.trim() ? n : "this person";
  }, [pubkey]);

  // The viewer's own existing vouch for this subject, if any — used to prefill
  // the composer and switch the action to "Update your vouch".
  const myVouch = useMemo(
    () => enrichedAttestations.find((a) => a.attesterPubkey === myPubkey && a.kind === 31871),
    [enrichedAttestations, myPubkey]
  );

  const vouchTrigger = canVouch ? (
    <Button
      size="sm"
      className="h-8 px-3 text-[11px] font-medium gap-1 bg-emerald-600/80 hover:bg-emerald-600 shrink-0"
      onClick={() => setComposerOpen(true)}
      data-testid="button-write-vouch"
    >
      <Plus className="w-3 h-3" />
      {myVouch ? "Update vouch" : "Vouch"}
    </Button>
  ) : null;

  const composer = canVouch ? (
    <VouchComposer
      subjectPubkey={pubkey}
      subjectName={subjectName}
      open={composerOpen}
      onOpenChange={setComposerOpen}
      onPublished={() => fetchAttestations()}
      existingContent={myVouch?.content}
      existingType={myVouch?.type}
      isUpdate={!!myVouch}
    />
  ) : null;

  // Phase A: we now WANT to show vouches even when logged out / WoT off — we just
  // suppress the trust badges + in-network counts (showTrust handles that) and add
  // a prompt. Empty profile (no reviews yet, or still loading) with no eligible
  // Vouch button still renders nothing.
  if (!fetched || enrichedAttestations.length === 0) {
    // As a TAB (embedded), the panel must NEVER render blank — show a centered
    // empty state even when the viewer can't vouch (logged out / own profile).
    if (embedded) {
      return (
        <div className="flex flex-col items-center justify-center text-center py-12 px-4">
          <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
            <ShieldCheck className="w-6 h-6 text-emerald-500/70" />
          </div>
          <h3 className="text-sm font-medium text-foreground/85">No vouches yet</h3>
          <p className="text-xs text-muted-foreground/60 mt-1 max-w-xs">
            {canVouch
              ? "Be the first to vouch for this person."
              : "When people in the network vouch for this person, their reviews will appear here."}
          </p>
          {canVouch && <div className="mt-4">{vouchTrigger}</div>}
          {composer}
        </div>
      );
    }
    if (!canVouch) return null;
    return (
      <Card className="glass-card overflow-hidden">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <ShieldCheck className="w-4 h-4 text-emerald-500/80 shrink-0" />
              <h3 className="text-xs font-brand tracking-wider uppercase text-emerald-800/90 dark:text-emerald-400/90">
                Trust Reviews
              </h3>
            </div>
            {vouchTrigger}
          </div>
          <p className="text-[11px] text-muted-foreground/60 mt-2">
            No vouches yet. Be the first to vouch for this person.
          </p>
        </div>
        {composer}
      </Card>
    );
  }

  // When the viewer has trusted reviews, lead with those (capped at 3 then
  // "show all"); the lower-trust set lives behind its own expander. When there
  // are no trusted reviews, fall back to showing the whole list directly.
  const primaryReviews = trustedReviews.length > 0 ? trustedReviews : enrichedAttestations;
  const displayLimit = expanded ? primaryReviews.length : 3;
  const hasMorePrimary = primaryReviews.length > 3;
  const hasLowTrustSplit = trustedReviews.length > 0 && lowTrustReviews.length > 0;

  // When embedded as a tab, drop the outer glass-card chrome so the panel sits
  // flush in the tab content; keep the Card wrapper for the standalone inline use.
  const Wrapper: ElementType = embedded ? "div" : Card;
  const wrapperClassName = embedded ? "" : "glass-card overflow-hidden";

  return (
    <Wrapper className={wrapperClassName}>
      <div className={`px-4 py-3 ${embedded ? "px-0" : "border-b border-border/20"}`}>
        {/* WRAPS rather than collides. The heading did not truncate and the
            right-hand block was shrink-0, so on a phone "TRUST REVIEWS" and
            "1 vouch · 1 from your network" were painted over each other — two
            flex children fighting for a width neither would give up. Allowing
            the row to wrap lets the count and the button drop to their own line
            instead of overlapping the title. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="w-4 h-4 text-emerald-500/80 shrink-0" />
            <h3 className="text-xs font-brand tracking-wider uppercase text-emerald-800/90 dark:text-emerald-400/90 truncate">
              Trust Reviews
            </h3>
          </div>

          <div className="flex items-center gap-3 min-w-0">
            <div className="text-[10px] text-muted-foreground/60">
              <span className="text-foreground/70 font-medium">
                {activeCount} {activeCount === 1 ? "vouch" : "vouches"}
              </span>
              {showTrust && trustedCount > 0 && !isOwnProfile && (
                <span className="text-emerald-800/70 dark:text-emerald-400/70">
                  {" · "}{trustedCount} from your network
                </span>
              )}
            </div>
            {vouchTrigger}
          </div>
        </div>

        {showTrust ? (
          <p className="text-[10px] text-muted-foreground/50 mt-1.5">
            Ranked by your web of trust
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground/50 mt-1.5">
            Sign in &amp; enable Web of Trust to see which vouches come from people you trust.
          </p>
        )}
      </div>

      <div className={`space-y-2 ${embedded ? "pt-3" : "p-3"}`}>
        {primaryReviews.slice(0, displayLimit).map((att) => (
          <AttestationCard
            key={att.eventId}
            attestation={att}
            onOpen={() => setSelected(att)}
            showTrust={showTrust}
            isOwn={att.attesterPubkey === myPubkey}
            isOwnerView={isOwnProfile}
            response={responses.get(att.eventId)}
            onReport={() => handleReport(att)}
            onMute={() => handleMute(att)}
            onRespond={() => setSelected(att)}
          />
        ))}

        {hasMorePrimary && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground/60 hover:text-foreground/80 gap-1"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <>
                <ChevronUp className="w-3 h-3" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" />
                Show all {primaryReviews.length} reviews
              </>
            )}
          </Button>
        )}

        {hasLowTrustSplit && (
          <>
            {showLowTrust &&
              lowTrustReviews.map((att) => (
                <AttestationCard
                  key={att.eventId}
                  attestation={att}
                  onOpen={() => setSelected(att)}
                  showTrust={showTrust}
                  isOwn={att.attesterPubkey === myPubkey}
                  isOwnerView={isOwnProfile}
                  response={responses.get(att.eventId)}
                  onReport={() => handleReport(att)}
                  onMute={() => handleMute(att)}
                  onRespond={() => setSelected(att)}
                />
              ))}
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground/50 hover:text-foreground/70 gap-1"
              onClick={() => setShowLowTrust(!showLowTrust)}
            >
              {showLowTrust ? (
                <>
                  <ChevronUp className="w-3 h-3" />
                  Hide lower-trust vouches
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3" />
                  Show {lowTrustReviews.length} more lower-trust {lowTrustReviews.length === 1 ? "vouch" : "vouches"}
                </>
              )}
            </Button>
          </>
        )}
      </div>

      <ReviewDialog
        attestation={selected}
        open={!!selected}
        onOpenChange={(v) => { if (!v) setSelected(null); }}
        showTrust={showTrust}
        isOwn={selected?.attesterPubkey === myPubkey}
        isOwnerView={isOwnProfile}
        subjectPubkey={pubkey}
        response={selected ? responses.get(selected.eventId) : undefined}
        onReport={() => { if (selected) handleReport(selected); }}
        onMute={() => { if (selected) handleMute(selected); }}
        onResponsePublished={() => loadResponses()}
      />

      {reportEvent && (
        <ReportDialog
          open={!!reportTarget}
          onOpenChange={(v) => { if (!v) setReportTarget(null); }}
          event={reportEvent}
        />
      )}

      {composer}
    </Wrapper>
  );
}
