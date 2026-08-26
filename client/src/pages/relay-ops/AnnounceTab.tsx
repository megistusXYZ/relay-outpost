import type { Event as NostrEvent } from "nostr-tools";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { pool, publishEvent } from "@/lib/nostr";
import { getSoftwareDisplay, type Nip11Document } from "@/lib/nip11";
import { copyNostrId } from "@/lib/clipboard-bridge";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";
import { OpsCard, OpsSectionHeader } from "./ops-ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Lock,
  RefreshCw,
  Globe,
  Copy,
  Check,
  AlertTriangle,
  AlertCircle,
  Trash2,
  Megaphone,
  Clock,
  User,
  Pin,
  PinOff,
  Pencil,
  X,
} from "lucide-react";
import {
  ProfileInfo,
  pubkeyToNpub,
  RenderedEventPreview,
  resolveProfileBatch,
} from "./shared";
import { isProtectedEvent } from "@/lib/nostr-helpers";
import {
  KIND_APP_DATA,
  APP_DATA_RELAYS,
  featuredDTag,
  parseFeaturedDoc,
  buildFeaturedEventTemplate,
  setDocAnnouncement,
  announcementBody,
  isAnnouncementPinnedFrom,
  emptyFeaturedDoc,
  type FeaturedDoc,
} from "@/lib/featured";

// Sentinel for `pinningId` while the unpin write is in flight (no event owns it).
const UNPIN_KEY = "__unpin__";

export function AnnounceTab({ relayUrl, nip11 }: { relayUrl: string; nip11: Nip11Document | null }) {
  const { pubkey, signer, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [announcementText, setAnnouncementText] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [privateOnly, setPrivateOnly] = useState(false);
  const [pastAnnouncements, setPastAnnouncements] = useState<NostrEvent[]>([]);
  const [fetchStatus, setFetchStatus] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Author profiles keyed by pubkey for every distinct announcement author —
  // derived from each event, not hardcoded to the signed-in operator.
  const [profiles, setProfiles] = useState<Map<string, ProfileInfo>>(new Map());
  const [copiedNpubId, setCopiedNpubId] = useState<string | null>(null);
  const [expandedAnnouncementId, setExpandedAnnouncementId] = useState<string | null>(null);
  const [announcementView, setAnnouncementView] = useState<"rendered" | "raw">("rendered");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // The community page's pinned announcement (kind-30078 "featured" doc). Loaded
  // so the outbox can show which announcement is pinned and preserve pinned items
  // when (un)pinning. `UNPIN_KEY` marks the unpin action for the busy spinner.
  const [featuredDoc, setFeaturedDoc] = useState<FeaturedDoc | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const loadingPast = fetchStatus === "loading";

  const copyRelayUrl = useCallback(() => {
    navigator.clipboard.writeText(relayUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  }, [relayUrl]);

  const fetchPastAnnouncements = useCallback(async () => {
    if (!pubkey) { setPastAnnouncements([]); setFetchStatus("done"); return; }
    setFetchStatus("loading");
    const events: NostrEvent[] = [];
    // Track whether the relay actually answered (any event OR an EOSE). A silent
    // timeout with zero response is a connectivity failure, not an empty inbox —
    // we surface that distinctly so a slow relay offers Retry instead of implying
    // "no announcements".
    let gotResponse = false;
    await new Promise<void>((resolve) => {
      let settled = false;
      let softTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        if (softTimer) clearTimeout(softTimer);
        try { sub.close(); } catch { /* already closed */ }
        resolve();
      };
      const sub = pool.subscribeMany([relayUrl], { kinds: [1], authors: [pubkey], "#r": [relayUrl], limit: 50 }, {
        onevent(event: NostrEvent) { gotResponse = true; events.push(event); },
        oneose() { gotResponse = true; softTimer = setTimeout(finish, 250); },
      });
      const hardTimer = setTimeout(finish, 6500);
    });
    const seen = new Set<string>();
    const deduped = events.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });
    deduped.sort((a, b) => b.created_at - a.created_at);
    setPastAnnouncements(deduped);
    setFetchStatus(gotResponse ? "done" : "error");
  }, [relayUrl, pubkey]);

  useEffect(() => {
    fetchPastAnnouncements();
  }, [fetchPastAnnouncements]);

  // Resolve a profile for every distinct announcement author (merged into cache).
  useEffect(() => {
    const authors = Array.from(new Set(pastAnnouncements.map(e => e.pubkey)));
    if (authors.length === 0) return;
    resolveProfileBatch(authors).then(resolved => {
      if (resolved.size === 0) return;
      setProfiles(prev => {
        const next = new Map(prev);
        resolved.forEach((v, k) => next.set(k, v));
        return next;
      });
    });
  }, [pastAnnouncements]);

  // Read the operator's community "featured" doc (the single kind-30078 pinned
  // announcement + highlights). Bounded, and it never mutates on failure so the
  // pinned-items set is safe from a slow-relay clobber.
  const readFeaturedDoc = useCallback((): Promise<FeaturedDoc | null> => {
    if (!pubkey) return Promise.resolve(null);
    return new Promise((resolve) => {
      let doc: FeaturedDoc | null = null;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { sub.close(); } catch { /* already closed */ }
        resolve(doc);
      };
      const sub = pool.subscribeMany(
        APP_DATA_RELAYS,
        { kinds: [KIND_APP_DATA], authors: [pubkey], "#d": [featuredDTag(relayUrl)], limit: 1 },
        { onevent(e: NostrEvent) { doc = parseFeaturedDoc(e.content, relayUrl); }, oneose() { finish(); } },
      );
      const timer = setTimeout(finish, 6000);
    });
  }, [pubkey, relayUrl]);

  useEffect(() => {
    if (!pubkey) { setFeaturedDoc(null); return; }
    let cancelled = false;
    readFeaturedDoc().then(doc => { if (!cancelled) setFeaturedDoc(doc); });
    return () => { cancelled = true; };
  }, [pubkey, readFeaturedDoc]);

  const copyNpub = useCallback((authorPubkey: string, eventId: string) => {
    copyNostrId(pubkeyToNpub(authorPubkey));
    setCopiedNpubId(eventId);
    setTimeout(() => setCopiedNpubId(prev => (prev === eventId ? null : prev)), 2000);
  }, []);

  // Shared featured-doc write: build the kind-30078 event via the same lib helper
  // the Community tab uses, sign, publish, and reflect it locally.
  const writeFeatured = useCallback(async (doc: FeaturedDoc) => {
    if (!signer) throw new Error("no signer");
    const template = buildFeaturedEventTemplate(doc, relayUrl);
    const signed = await signWithTimeout(signer, template);
    await publishEvent(signed, APP_DATA_RELAYS);
    setFeaturedDoc(doc);
  }, [signer, relayUrl]);

  const pinAnnouncement = useCallback(async (event: NostrEvent) => {
    if (!signer || !pubkey) {
      toast({ title: "Not signed in", description: "Sign in to pin announcements.", variant: "destructive" });
      return;
    }
    setPinningId(event.id);
    try {
      // Read the freshest doc first so we preserve any pinned items rather than
      // clobber them; fall back to the loaded copy, then an empty doc.
      const base = (await readFeaturedDoc()) ?? featuredDoc ?? emptyFeaturedDoc(relayUrl);
      const doc = setDocAnnouncement(base, { text: announcementBody(event.content, relayUrl), sourceId: event.id }, relayUrl);
      await writeFeatured(doc);
      toast({ title: "Pinned to community page", description: "Members will see it atop the community timeline." });
    } catch (err) {
      if (isSignerError(err)) { await handleSignerError(err, toast, attemptReconnect); }
      else { toast({ title: "Failed to pin", description: "Could not update the community page.", variant: "destructive" }); }
    }
    setPinningId(null);
  }, [signer, pubkey, relayUrl, featuredDoc, readFeaturedDoc, writeFeatured, toast, attemptReconnect]);

  const unpinAnnouncement = useCallback(async () => {
    if (!signer || !pubkey) return;
    setPinningId(UNPIN_KEY);
    try {
      const base = (await readFeaturedDoc()) ?? featuredDoc ?? emptyFeaturedDoc(relayUrl);
      const doc = setDocAnnouncement(base, null, relayUrl);
      await writeFeatured(doc);
      toast({ title: "Unpinned", description: "Removed from the community page. Pinned items are kept." });
    } catch (err) {
      if (isSignerError(err)) { await handleSignerError(err, toast, attemptReconnect); }
      else { toast({ title: "Failed to unpin", description: "Could not update the community page.", variant: "destructive" }); }
    }
    setPinningId(null);
  }, [signer, pubkey, relayUrl, featuredDoc, readFeaturedDoc, writeFeatured, toast, attemptReconnect]);

  const startEdit = useCallback((event: NostrEvent) => {
    setEditingId(event.id);
    setAnnouncementText(announcementBody(event.content, relayUrl));
    setPrivateOnly(isProtectedEvent(event));
    setExpandedAnnouncementId(null);
    requestAnimationFrame(() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [relayUrl]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setAnnouncementText("");
  }, []);

  const deleteAnnouncement = useCallback(async (eventId: string) => {
    if (!signer || !pubkey) return;
    setDeletingId(eventId);
    try {
      const target = pastAnnouncements.find(e => e.id === eventId);
      const wasPinned = !!target && isAnnouncementPinnedFrom(featuredDoc, target, relayUrl);
      const deleteEvent = {
        kind: 5 as const,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["e", eventId]],
        content: "Deleted announcement",
      };
      const signed = await signWithTimeout(signer, deleteEvent);
      await Promise.any(pool.publish([relayUrl], signed));
      setPastAnnouncements(prev => prev.filter(e => e.id !== eventId));
      // The featured doc stores the announcement *text*, so deleting the kind-1
      // alone would leave the community page showing a now-deleted announcement.
      // Unpin it too when it was the pinned one, preserving any pinned items.
      if (wasPinned) {
        try {
          const base = (await readFeaturedDoc()) ?? featuredDoc ?? emptyFeaturedDoc(relayUrl);
          await writeFeatured(setDocAnnouncement(base, null, relayUrl));
        } catch { /* delete already succeeded; pin cleanup is best-effort */ }
      }
      toast({
        title: "Announcement deleted",
        description: wasPinned
          ? "Deletion request published and unpinned from your community page."
          : "Deletion request published.",
      });
    } catch (err) {
      if (isSignerError(err)) { await handleSignerError(err, toast, attemptReconnect); }
      else { toast({ title: "Failed", description: "Could not delete announcement.", variant: "destructive" }); }
    }
    setDeletingId(null);
  }, [signer, pubkey, relayUrl, pastAnnouncements, featuredDoc, readFeaturedDoc, writeFeatured, toast, attemptReconnect]);

  const publishAnnouncement = useCallback(async () => {
    if (!signer || !pubkey) {
      toast({ title: "Not signed in", description: "Sign in to publish announcements.", variant: "destructive" });
      return;
    }
    if (!announcementText.trim()) {
      toast({ title: "Empty announcement", description: "Write something to announce.", variant: "destructive" });
      return;
    }
    setPublishing(true);
    const oldId = editingId;
    const oldEvent = oldId ? pastAnnouncements.find(e => e.id === oldId) : undefined;
    try {
      const content = `${announcementText.trim()}\n\n${relayUrl}`;
      const tags: string[][] = [["r", relayUrl]];
      if (privateOnly) tags.push(["-"]);
      const event = {
        kind: 1 as const,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content,
      };
      const signed = await signWithTimeout(signer, event);
      const targetRelays = privateOnly
        ? [relayUrl]
        : [relayUrl, "wss://relay.damus.io", "wss://nos.lol"];
      await Promise.any(pool.publish(targetRelays, signed));

      if (oldId) {
        // kind-1 notes aren't replaceable, so an "edit" is: publish the new note,
        // then request deletion (kind 5) of the previous one — a repost + retract.
        try {
          const del = {
            kind: 5 as const,
            created_at: Math.floor(Date.now() / 1000),
            tags: [["e", oldId]],
            content: "Edited announcement",
          };
          const signedDel = await signWithTimeout(signer, del);
          await Promise.any(pool.publish(targetRelays, signedDel));
        } catch { /* the new note is already live; retract is best-effort */ }
        setPastAnnouncements(prev => prev.filter(e => e.id !== oldId));
        // If the note being edited was pinned to the community page, re-point the
        // pin at the fresh note so the page never references a retracted event.
        if (oldEvent && isAnnouncementPinnedFrom(featuredDoc, oldEvent, relayUrl)) {
          try {
            const base = (await readFeaturedDoc()) ?? featuredDoc ?? emptyFeaturedDoc(relayUrl);
            await writeFeatured(setDocAnnouncement(base, { text: announcementBody(signed.content, relayUrl), sourceId: signed.id }, relayUrl));
          } catch { /* pin re-point best-effort */ }
        }
      }

      toast({
        title: oldId ? "Announcement updated" : "Announcement published",
        description: oldId
          ? "Republished as a new post and requested deletion of the previous one."
          : privateOnly
            ? "Posted to this relay only and tagged Protected — other clients shouldn't rebroadcast it."
            : "Posted to your relay and public relays.",
      });
      setAnnouncementText("");
      setEditingId(null);
      setTimeout(fetchPastAnnouncements, 1500);
    } catch (err) {
      if (isSignerError(err)) { await handleSignerError(err, toast, attemptReconnect); }
      else {
        console.warn("[RelayOps] Announcement failed:", err);
        toast({ title: "Failed", description: "Could not publish announcement.", variant: "destructive" });
      }
    }
    setPublishing(false);
  }, [signer, pubkey, announcementText, relayUrl, privateOnly, editingId, pastAnnouncements, featuredDoc, readFeaturedDoc, writeFeatured, toast, fetchPastAnnouncements, attemptReconnect]);

  const softwareDisplay = nip11 ? getSoftwareDisplay(nip11) : null;

  const nip11Checklist = useMemo(() => {
    if (!nip11) return [];
    const checks: { field: string; present: boolean; tip: string; comingSoon?: boolean }[] = [
      { field: "Name", present: !!nip11.name, tip: "Set a relay name so users know what your relay is about." },
      { field: "Description", present: !!nip11.description, tip: "Add a description to help users understand your relay's purpose." },
      { field: "Icon", present: !!nip11.icon, tip: "Add a relay icon for better visual identity in relay lists." },
      { field: "Contact", present: !!nip11.contact, tip: "Provide a contact email or URL for users to reach you." },
      { field: "Operator Pubkey", present: !!nip11.pubkey, tip: "Set your operator pubkey so clients can verify you manage this relay." },
      { field: "Supported NIPs", present: (nip11.supported_nips?.length || 0) > 0, tip: "List supported NIPs so clients know what features are available." },
    ];
    return checks;
  }, [nip11]);

  const completenessScore = nip11Checklist.length > 0 ? Math.round((nip11Checklist.filter(c => c.present).length / nip11Checklist.length) * 100) : 0;

  const formatAnnouncementDate = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const pendingDeleteTarget = pendingDeleteId ? pastAnnouncements.find(e => e.id === pendingDeleteId) : undefined;
  const pendingDeleteIsPinned = !!pendingDeleteTarget && isAnnouncementPinnedFrom(featuredDoc, pendingDeleteTarget, relayUrl);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <OpsCard>
          <OpsSectionHeader
            icon={Globe}
            label="Relay Card"
            action={nip11 && (
              <Badge variant="outline" className={`text-[10px] ${completenessScore === 100 ? "border-green-400/30 dark:border-green-400/20 text-green-600 dark:text-green-400/70" : "border-amber-400/30 dark:border-amber-400/20 text-amber-600 dark:text-amber-400/70"}`}>
                {completenessScore}% complete
              </Badge>
            )}
          />
          <div className="rounded-lg bg-gradient-to-br from-brand/10 to-blue-500/5 border border-border dark:border-brand/20 p-4">
            <div className="flex items-start gap-3">
              {nip11?.icon && <img src={nip11.icon} alt="" className="w-10 h-10 rounded-lg object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-foreground">{nip11?.name || relayUrl.replace("wss://", "")}</h3>
                {nip11?.description && <p className="text-xs text-muted-foreground/70 mt-0.5 line-clamp-2">{nip11.description}</p>}
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] font-mono text-brand/70 dark:text-brand/60">{relayUrl}</span>
                  <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8 shrink-0" onClick={copyRelayUrl} aria-label="Copy relay URL">
                    {copiedUrl ? <Check className="w-3.5 h-3.5 text-green-800 dark:text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {softwareDisplay && (
                    <Badge variant="outline" className="text-[10px] border-border dark:border-brand/20 text-brand dark:text-brand/70">{softwareDisplay}</Badge>
                  )}
                  {nip11?.supported_nips && (
                    <Badge variant="outline" className="text-[10px] border-border dark:border-brand/20 text-brand dark:text-brand/70">{nip11.supported_nips.length} NIPs</Badge>
                  )}
                  {nip11?.limitation?.auth_required && (
                    <Badge variant="outline" className="text-[10px] border-amber-400/30 dark:border-amber-400/20 text-amber-600 dark:text-amber-400/70">Auth Required</Badge>
                  )}
                </div>
              </div>
            </div>
          </div>

          {nip11Checklist.length > 0 && completenessScore < 100 && (
            <div className="mt-3 space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">NIP-11 Completeness</span>
              <div className="w-full h-1.5 bg-muted dark:bg-white/[0.06] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${completenessScore === 100 ? "bg-green-500" : completenessScore >= 60 ? "bg-amber-500" : "bg-red-500"}`}
                  style={{ width: `${completenessScore}%` }}
                />
              </div>
              <div className="space-y-0.5 mt-1.5">
                {nip11Checklist.filter(c => !c.present).map(c => (
                  <div key={c.field} className="flex items-start gap-1.5 text-[10px]">
                    <AlertTriangle className="w-2.5 h-2.5 text-amber-500 shrink-0 mt-0.5" />
                    <span className="text-muted-foreground/70"><span className="font-medium text-amber-700 dark:text-amber-400/80">{c.field}</span> — {c.tip}{c.comingSoon ? <span className="ml-1 text-[10px] text-brand dark:text-brand/70 font-medium">(coming soon)</span> : null}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </OpsCard>

        <OpsCard ref={composerRef}>
          <OpsSectionHeader
            icon={editingId ? Pencil : Megaphone}
            label={editingId ? "Edit Announcement" : "Publish Announcement"}
            action={editingId ? (
              <Button variant="ghost" size="sm" className="text-[10px] h-8 px-2 shrink-0" onClick={cancelEdit} data-testid="button-cancel-edit-announcement">
                <X className="w-3 h-3 sm:mr-1" /><span className="hidden sm:inline">Cancel</span>
              </Button>
            ) : undefined}
          />
          {editingId && (
            <div className="flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-500/10 px-2.5 py-2 mb-3" data-testid="banner-editing-announcement">
              <Pencil className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p className="text-[10px] text-amber-700 dark:text-amber-300/90 leading-relaxed">
                Editing republishes as a new post and requests deletion of the original. Copies already relayed to other relays (damus, nos.lol) may linger.
              </p>
            </div>
          )}
          <Textarea
            placeholder="Write an announcement about your relay..."
            value={announcementText}
            onChange={(e) => setAnnouncementText(e.target.value)}
            className="min-h-[80px] text-xs mb-3"
          />
          <div className="flex items-center gap-2 sm:gap-3 mb-3">
            <button
              onClick={() => setPrivateOnly(false)}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] sm:min-h-[36px] sm:py-1.5 rounded-md text-[11px] font-medium transition-all border ${ !privateOnly ? "bg-accent border-brand/20 text-accent-foreground dark:text-brand" : "bg-transparent border-border dark:border-white/[0.06] text-muted-foreground/70 hover:text-muted-foreground/70 hover:border-border dark:hover:border-white/10" }`}
            >
              <Globe className="w-3.5 h-3.5" />
              Public
            </button>
            <button
              onClick={() => setPrivateOnly(true)}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] sm:min-h-[36px] sm:py-1.5 rounded-md text-[11px] font-medium transition-all border ${
                privateOnly
                  ? "bg-amber-500/15 border-amber-400/30 text-amber-700 dark:text-amber-300"
                  : "bg-transparent border-border dark:border-white/[0.06] text-muted-foreground/70 hover:text-muted-foreground/70 hover:border-border dark:hover:border-white/10"
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              Private
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] text-muted-foreground/60 min-w-0 flex-1">
              {privateOnly
                ? "Will be posted only to your relay. Not visible on public relays."
                : "Will be posted to your relay + public relays (damus, nos.lol)."}
            </p>
            <Button size="sm" onClick={publishAnnouncement} disabled={publishing || !announcementText.trim()} className="text-xs h-9 sm:h-8 shrink-0" data-testid="button-publish-announcement">
              <Megaphone className={`w-3 h-3 mr-1 ${publishing ? "animate-pulse" : ""}`} />
              {publishing ? (editingId ? "Updating..." : "Publishing...") : (editingId ? "Republish" : "Publish")}
            </Button>
          </div>
        </OpsCard>
      </div>

      <OpsCard>
        <OpsSectionHeader
          icon={Clock}
          label="Announcement Outbox"
          action={
            <Button variant="ghost" size="sm" className="text-[10px] h-8 px-2 shrink-0" onClick={fetchPastAnnouncements} disabled={loadingPast} data-testid="button-refresh-announcements">
              <RefreshCw className={`w-3 h-3 sm:mr-1 ${loadingPast ? "animate-spin" : ""}`} /><span className="hidden sm:inline">Refresh</span>
            </Button>
          }
        >
          <Badge variant="outline" className="text-[10px] border-border dark:border-brand/20 text-brand dark:text-brand/70">{pastAnnouncements.length}</Badge>
          {featuredDoc?.announcement?.text?.trim() && (
            <Badge
              variant="outline"
              className="text-[10px] border-amber-400/30 dark:border-amber-400/20 text-amber-600 dark:text-amber-400/70"
              data-testid="badge-community-pinned"
              title="One announcement is pinned to the top of your community page."
            >
              <Pin className="w-2.5 h-2.5 mr-0.5 rotate-45 inline" />1 pinned
            </Badge>
          )}
        </OpsSectionHeader>

        {!pubkey ? (
          <div className="text-center py-8" data-testid="empty-announcements-signed-out">
            <User className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground/50">Sign in to view and manage your announcements.</p>
            <p className="text-[10px] text-muted-foreground/40 mt-1">Your outbox and the community pin live under your operator key.</p>
          </div>
        ) : loadingPast && pastAnnouncements.length === 0 ? (
          <div className="flex items-center justify-center py-8" data-testid="loading-announcements">
            <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground/50 mr-2" />
            <span className="text-xs text-muted-foreground/60">Loading announcements...</span>
          </div>
        ) : fetchStatus === "error" && pastAnnouncements.length === 0 ? (
          <div className="text-center py-8" data-testid="error-announcements">
            <AlertCircle className="w-8 h-8 text-amber-500/40 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground/60">Couldn't reach {relayUrl.replace(/^wss?:\/\//, "")}.</p>
            <p className="text-[10px] text-muted-foreground/40 mt-1">The relay didn't respond in time — your announcements may still be there.</p>
            <Button variant="outline" size="sm" className="text-[10px] h-8 mt-3" onClick={fetchPastAnnouncements} data-testid="button-retry-announcements">
              <RefreshCw className="w-3 h-3 mr-1" /> Retry
            </Button>
          </div>
        ) : pastAnnouncements.length === 0 ? (
          <div className="text-center py-8" data-testid="empty-announcements">
            <Megaphone className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground/50">No announcements found.</p>
            <p className="text-[10px] text-muted-foreground/40 mt-1">Publish your first announcement above to let users know about your relay.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {pastAnnouncements.map(event => {
              const contentClean = announcementBody(event.content, relayUrl);
              const protectedTagged = isProtectedEvent(event);
              const author = profiles.get(event.pubkey);
              const isPinned = isAnnouncementPinnedFrom(featuredDoc, event, relayUrl);
              const pinBusy = pinningId === event.id || (isPinned && pinningId === UNPIN_KEY);
              return (
                <div
                  key={event.id}
                  className={`rounded-lg border p-3 hover:bg-muted/20 transition-colors group cursor-pointer ${expandedAnnouncementId === event.id ? "border-brand/30 dark:border-brand/20 bg-muted/10" : isPinned ? "border-amber-400/30 dark:border-amber-400/20 bg-amber-500/[0.04]" : "border-border/30"}`}
                  onClick={() => setExpandedAnnouncementId(expandedAnnouncementId === event.id ? null : event.id)}
                  data-testid={`announcement-row-${event.id.slice(0, 8)}`}
                >
                  <div className="flex items-start gap-2.5">
                    {author?.picture ? (
                      <img src={author.picture} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 mt-0.5" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-primary/10 shrink-0 mt-0.5 flex items-center justify-center">
                        <User className="w-4 h-4 text-brand/50" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-[11px] font-medium text-foreground/90 truncate">
                          {author?.name || pubkeyToNpub(event.pubkey).slice(0, 16) + "..."}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); copyNpub(event.pubkey, event.id); }}
                          className="shrink-0 p-0.5 rounded text-muted-foreground/40 hover:text-brand transition-colors"
                          title="Copy npub"
                          data-testid={`button-copy-npub-${event.id.slice(0, 8)}`}
                        >
                          {copiedNpubId === event.id ? <Check className="w-2.5 h-2.5 text-green-800 dark:text-green-400" /> : <Copy className="w-2.5 h-2.5" />}
                        </button>
                        {isPinned && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 border-amber-400/30 dark:border-amber-400/20 text-amber-600 dark:text-amber-400/70"
                            data-testid={`badge-announcement-pinned-${event.id.slice(0, 8)}`}
                            title="Pinned to the top of your community page."
                          >
                            <Pin className="w-2 h-2 mr-0.5 rotate-45 inline" />Pinned
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${
                            protectedTagged
                              ? "border-amber-400/30 dark:border-amber-400/20 text-amber-600 dark:text-amber-400/70"
                              : "border-green-400/30 dark:border-green-400/20 text-green-600 dark:text-green-400/70"
                          }`}
                          title={protectedTagged
                            ? `NIP-70 ["-"] tag present — well-behaved relays will not rebroadcast this beyond ${relayUrl.replace(/^wss?:\/\//, "")}.`
                            : "No NIP-70 protected tag — this announcement may be rebroadcast by other relays."}
                          data-testid={`badge-announcement-visibility-${event.id.slice(0, 8)}`}
                        >
                          {protectedTagged
                            ? <><Lock className="w-2 h-2 mr-0.5 inline" />Protected</>
                            : <><Globe className="w-2 h-2 mr-0.5 inline" />Public</>}
                        </Badge>
                      </div>
                      <p className={`text-xs text-foreground/90 whitespace-pre-wrap break-words ${expandedAnnouncementId === event.id ? "" : "line-clamp-4"}`}>{contentClean}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[10px] text-muted-foreground/50 font-mono">{formatAnnouncementDate(event.created_at)}</span>
                        <span className="text-[10px] text-muted-foreground/40 font-mono">{event.id.slice(0, 12)}...</span>
                        {expandedAnnouncementId !== event.id && (
                          <span className="text-[10px] text-brand/50 ml-auto">Click to expand</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => (isPinned ? unpinAnnouncement() : pinAnnouncement(event))}
                        disabled={pinBusy || !signer}
                        className={`shrink-0 p-1.5 rounded transition-all disabled:opacity-40 ${isPinned ? "text-amber-500 hover:bg-amber-500/10" : "text-muted-foreground/40 hover:text-amber-500 hover:bg-amber-500/10"}`}
                        title={isPinned ? "Unpin from community page" : "Pin to community page"}
                        data-testid={isPinned ? `button-unpin-announcement-${event.id.slice(0, 8)}` : `button-pin-announcement-${event.id.slice(0, 8)}`}
                      >
                        {pinBusy ? <RefreshCw className="w-3 h-3 animate-spin" /> : isPinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3 rotate-45" />}
                      </button>
                      <button
                        onClick={() => startEdit(event)}
                        disabled={!signer}
                        className="shrink-0 p-1.5 rounded text-muted-foreground/40 hover:text-brand hover:bg-brand/10 transition-all disabled:opacity-40"
                        title="Edit announcement (republish + retract original)"
                        data-testid={`button-edit-announcement-${event.id.slice(0, 8)}`}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setPendingDeleteId(event.id)}
                        disabled={deletingId === event.id}
                        className="shrink-0 p-1.5 rounded text-muted-foreground/40 hover:text-red-500 hover:bg-red-500/10 transition-all disabled:opacity-50"
                        title="Delete announcement"
                        data-testid={`button-delete-announcement-${event.id.slice(0, 8)}`}
                      >
                        {deletingId === event.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                  {expandedAnnouncementId === event.id && (
                    <div className="mt-3 pt-3 border-t border-border dark:border-white/[0.06]">
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <Button
                          size="sm"
                          variant={isPinned ? "default" : "outline"}
                          onClick={(e) => { e.stopPropagation(); isPinned ? unpinAnnouncement() : pinAnnouncement(event); }}
                          disabled={pinBusy || !signer}
                          className={`h-7 text-[10px] px-2.5 ${isPinned ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}`}
                          data-testid={isPinned ? `button-unpin-announcement-detail-${event.id.slice(0, 8)}` : `button-pin-announcement-detail-${event.id.slice(0, 8)}`}
                        >
                          {pinBusy ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : isPinned ? <PinOff className="w-3 h-3 mr-1" /> : <Pin className="w-3 h-3 mr-1 rotate-45" />}
                          {isPinned ? "Unpin from community" : "Pin to community"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => { e.stopPropagation(); startEdit(event); }}
                          disabled={!signer}
                          className="h-7 text-[10px] px-2.5"
                          data-testid={`button-edit-announcement-detail-${event.id.slice(0, 8)}`}
                        >
                          <Pencil className="w-3 h-3 mr-1" /> Edit
                        </Button>
                        {isPinned && (
                          <span className="text-[10px] text-amber-600/80 dark:text-amber-400/70">Shown atop your community timeline.</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mb-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); setAnnouncementView("rendered"); }}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${announcementView === "rendered" ? "bg-accent text-accent-foreground dark:text-brand" : "text-muted-foreground/70 hover:text-muted-foreground/70"}`}
                        >
                          Rendered
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setAnnouncementView("raw"); }}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${announcementView === "raw" ? "bg-accent text-accent-foreground dark:text-brand" : "text-muted-foreground/70 hover:text-muted-foreground/70"}`}
                        >
                          Raw JSON
                        </button>
                      </div>
                      {announcementView === "rendered" ? (
                        <RenderedEventPreview event={event} profiles={profiles} relayUrl={relayUrl} />
                      ) : (
                        <pre className="text-[10px] font-mono text-muted-foreground/60 whitespace-pre-wrap max-h-60 overflow-y-auto bg-muted dark:bg-black/20 rounded p-2" onClick={(e) => e.stopPropagation()}>
                          {JSON.stringify(event, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </OpsCard>

      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
        <AlertDialogContent className="glass-dialog-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-sm">
              <Trash2 className="w-4 h-4 text-red-500" /> Delete Announcement
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              This publishes a deletion request (kind 5 — advisory) asking relays to drop this note. This relay should honor it, but public copies already broadcast to damus / nos.lol may linger and can't be force-recalled.
              {pendingDeleteIsPinned && " It will also be unpinned from your community page."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs h-8">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="text-xs h-8 bg-red-600 hover:bg-red-700 text-white"
              onClick={() => { if (pendingDeleteId) { deleteAnnouncement(pendingDeleteId); setPendingDeleteId(null); } }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

