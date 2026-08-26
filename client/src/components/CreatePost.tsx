import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Send, X, ImagePlus, Film, FileText, ShieldCheck, Music, Radio, ChevronDown, Archive, Trash2, RotateCcw, Image, Images, Video, BarChart3, Plus, Minus } from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { publishEvent, wasAuthRequiredRecently } from "@/lib/nostr";
import { KIND_TEXT_NOTE, clientTags, extractHashtags } from "@/lib/nostr-helpers";
import { markHasPosted } from "@/lib/adoption-flags";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";
import { RelayPublishPicker, usePublishRelayPreference } from "@/components/RelayPublishPicker";
import { withOutboxFloor, fetchRelayLists } from "@/lib/outbox";
import { classifyRelayUrl, getOutpostRelays } from "@/lib/outpost-relays";
import { isAuthEnabled } from "@/lib/nip42-auth";
import { useToast } from "@/hooks/use-toast";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useMention } from "@/hooks/use-mention";
import { MentionSearch } from "@/components/MentionSearch";
import { MentionHighlightTextarea } from "@/components/MentionHighlightTextarea";
import { uploadToNostrBuild, startAutoMirror, UploadError, validateFile, isVideoFile, isAudioFile, canStripAudioMetadata } from "@/lib/media-upload";
import { buildImetaTag } from "@/lib/blossom-media";
import { buildPictureEvent, canPostAsPicture } from "@/lib/picture-post";
import { KIND_PICTURE } from "@/lib/media-frame";
import { parseImetaTags } from "@/lib/media-utils";
import { KIND_MUSIC_TRACK } from "@/lib/music";
import { useOutpostCompose } from "@/contexts/OutpostComposeContext";
import { ComposeEmojiPicker, useEmojiTags } from "@/components/ComposeEmojiPicker";
import { useCustomEmojis } from "@/hooks/use-custom-emojis";
import type { CustomEmoji } from "@/hooks/use-custom-emojis";
import { getDrafts, saveDraft, updateDraft, deleteDraft, getDraftCount, formatDraftAge, getDraftPreview, type Draft } from "@/lib/drafts";
import { createScheduledPost, updateScheduledPost, type ScheduledPostWithDecrypted } from "@/lib/schedule";
import { getScheduleBackend, setScheduleBackend, createLocalScheduledPost, updateLocalScheduledPost, type ScheduleBackend } from "@/lib/local-schedule";
import { Calendar, Clock } from "lucide-react";

function getRelayModeStyle(preset: string): { text: string; icon: string; dot: string } {
  switch (preset) {
    case "private": return { text: "text-amber-600 dark:text-amber-400/80", icon: "text-amber-500/70", dot: "bg-amber-400" };
    case "public": return { text: "text-green-600 dark:text-green-400/80", icon: "text-green-500/70", dot: "bg-green-400" };
    case "all": return { text: "text-brand dark:text-brand/80", icon: "text-brand/70", dot: "bg-brand" };
    default: return { text: "text-muted-foreground/70", icon: "text-muted-foreground/50", dot: "bg-muted-foreground/40" };
  }
}

interface AudioAttachment {
  url: string;
  fileName: string;
  title: string;
  coverUrl: string;
  metadataStripped: boolean;
  /** Content fingerprint + mirror data for the NIP-92 imeta tag (may be absent on old drafts). */
  mime?: string;
  sha256?: string;
  fallbackUrl?: string;
}

interface MediaAttachment {
  id: string;
  url: string;
  type: "image" | "video";
  metadataStripped: boolean;
  /** Content fingerprint + mirror data for the NIP-92 imeta tag (may be absent on old drafts). */
  mime?: string;
  sha256?: string;
  /** Pixel dimensions as `WxH` (NIP-94 `dim`) — images only. */
  dim?: string;
  fallbackUrl?: string;
}

/**
 * NIP-92 imeta tags for the media this note embeds: url + m + x (sha256) and,
 * when the background BUD-04 mirror landed in time, a `fallback` mirror URL.
 * Standard space-separated key/value format — readable by Amethyst/Damus etc.
 * Attachments without a fingerprint (old drafts) simply emit no tag.
 */
function buildMediaImetaTags(
  mediaAttachments: MediaAttachment[],
  audioAttachment: AudioAttachment | null,
): string[][] {
  const tags: string[][] = [];
  for (const media of mediaAttachments) {
    const tag = buildImetaTag({
      url: media.url,
      mime: media.mime,
      sha256: media.sha256,
      fallbacks: media.fallbackUrl ? [media.fallbackUrl] : undefined,
    });
    if (tag) tags.push(tag);
  }
  if (audioAttachment) {
    const tag = buildImetaTag({
      url: audioAttachment.url,
      mime: audioAttachment.mime,
      sha256: audioAttachment.sha256,
      fallbacks: audioAttachment.fallbackUrl ? [audioAttachment.fallbackUrl] : undefined,
    });
    if (tag) tags.push(tag);
  }
  return tags;
}

let mediaIdCounter = 0;

function RelayOutpostIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M5.64999 7.64999L2.85001 4.85001C2.54001 4.54001 2.76001 4 3.20001 4H6.79001C6.92001 4 7.05001 4.04999 7.14001 4.14999L12.14 9.14999C12.45 9.45999 12.23 10 11.79 10H8.5C6.57 10 5 11.57 5 13.5C5 15.43 6.57 17 8.5 17H10L12.15 19.15C12.46 19.46 12.24 20 11.8 20H8.51001C4.92001 20 2.01001 17.09 2.01001 13.5C2.01001 11.01 3.41001 8.84 5.48001 7.75L5.64999 7.64999Z" fill="currentColor" />
      <path d="M18.35 16.35L21.15 19.15C21.46 19.46 21.24 20 20.8 20H17.21C17.08 20 16.95 19.95 16.86 19.85L11.86 14.85C11.55 14.54 11.77 14 12.21 14H15.5C17.43 14 19 12.43 19 10.5C19 8.57 17.43 7 15.5 7H14L11.85 4.85001C11.54 4.54001 11.76 4 12.2 4H15.49C19.08 4 21.99 6.91 21.99 10.5C21.99 12.99 20.59 15.16 18.52 16.25L18.35 16.35Z" fill="currentColor" />
    </svg>
  );
}

export function CreatePostFAB() {
  const { outpostCompose } = useOutpostCompose();
  const [isOpen, setIsOpen] = useState(false);
  const [showShieldInfo, setShowShieldInfo] = useState(false);
  const [content, setContent] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("Uploading...");
  const { toast } = useToast();
  const { pubkey, signer, profile, isReconnecting, attemptReconnect } = useNostrAuth();
  const [location, setLocation] = useLocation();
  const [audioAttachment, setAudioAttachment] = useState<AudioAttachment | null>(null);
  const [mediaAttachments, setMediaAttachments] = useState<MediaAttachment[]>([]);
  const [previewMedia, setPreviewMedia] = useState<MediaAttachment | null>(null);
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const audioCoverInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { mentionActive, mentionQuery, detectMention, insertMention, closeMention, resolveContent, getMentionTags, clearMentionTags } = useMention();
  const { trackEmoji, getEmojiTags, clearEmojiTags } = useEmojiTags();
  const { emojis: customEmojis } = useCustomEmojis();
  const composeEmojiMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of customEmojis) map.set(e.shortcode, e.url);
    return map;
  }, [customEmojis]);
  const [isMobile, setIsMobile] = useState(false);
  const [vpRect, setVpRect] = useState<{ height: number; top: number } | null>(null);
  const [showRelayPicker, setShowRelayPicker] = useState(false);
  const [showDrafts, setShowDrafts] = useState(false);
  const [draftCount, setDraftCount] = useState(() => getDraftCount());
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [isPollMode, setIsPollMode] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollExpiration, setPollExpiration] = useState<string>("1d");
  // NIP-68 opt-in. Kind 1 stays the default (MEDIA_FEED_PLAN decision 9, as
  // amended): kind 20 is only offered when the post is picture-dominant, and
  // only published when the author flips this on.
  const [postAsPicture, setPostAsPicture] = useState(false);
  const [pictureTitle, setPictureTitle] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDateTime, setScheduleDateTime] = useState("");
  const [scheduleBackend, setScheduleBackendState] = useState<ScheduleBackend>(() => getScheduleBackend());
  const chooseBackend = (b: ScheduleBackend) => { setScheduleBackendState(b); setScheduleBackend(b); };
  const [editingPost, setEditingPost] = useState<ScheduledPostWithDecrypted | null>(null);
  const { pref: relayPref, relays: selectedRelays, label: relayLabel, updatePref: setRelayPref } = usePublishRelayPreference();
  const [outpostCount, setOutpostCount] = useState(() => getOutpostRelays().length);
  useEffect(() => {
    const sync = () => setOutpostCount(getOutpostRelays().length);
    window.addEventListener("outpost-relays-changed", sync);
    return () => window.removeEventListener("outpost-relays-changed", sync);
  }, []);

  const willBeProtected = useMemo(() => {
    if (relayPref.preset === "private") return true;
    if (relayPref.preset === "all" || selectedRelays.length === 0) return false;
    return selectedRelays.every((url) => classifyRelayUrl(url) === "private" || isAuthEnabled(url));
  }, [relayPref.preset, selectedRelays]);

  // Outbox floor: public posts always also reach the user's advertised NIP-65
  // write relays — a curated picker selection must never make posts invisible
  // to followers on other clients (they resolve the outbox from kind-10002).
  // Protected / private-only posts keep the exact selection (no broadcast).
  const publishTargets = useMemo(
    () => (willBeProtected ? selectedRelays : withOutboxFloor(selectedRelays, pubkey)),
    [willBeProtected, selectedRelays, pubkey],
  );
  // Warm the own-relay-list cache when the composer opens so the floor is
  // usually resolved by post time (getWriteRelays reads a module cache).
  useEffect(() => {
    if (isOpen && pubkey) { try { fetchRelayLists([pubkey]); } catch {} }
  }, [isOpen, pubkey]);

  useEffect(() => {
    const handler = (e: Event) => {
      setShowSchedule(true);
      setDraftCount(getDraftCount());
      const detail = (e as CustomEvent).detail;
      if (detail?.date) {
        const d = new Date(detail.date);
        if (!isNaN(d.getTime())) {
          const now = new Date();
          if (d > now) {
            d.setHours(9, 0, 0, 0);
          } else {
            d.setHours(now.getHours() + 1, 0, 0, 0);
          }
          if (d.getTime() <= Date.now() + 5 * 60000) {
            d.setTime(Date.now() + 10 * 60000);
          }
          const pad = (n: number) => String(n).padStart(2, "0");
          const localISO = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
          setScheduleDateTime(localISO);
          setShowSchedule(true);
        }
      }
      setIsOpen(true);
    };
    window.addEventListener("open-compose-schedule", handler);
    return () => window.removeEventListener("open-compose-schedule", handler);
  }, []);

  // Generic "open the composer" entry point (e.g. the Get Started checklist's
  // "Write a post"). Opens the standard note composer from anywhere in the app.
  useEffect(() => {
    const handler = () => {
      setDraftCount(getDraftCount());
      setIsOpen(true);
    };
    window.addEventListener("open-compose", handler);
    return () => window.removeEventListener("open-compose", handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const post = (e as CustomEvent).detail as ScheduledPostWithDecrypted;
      if (!post) return;
      setEditingPost(post);
      const eventContent = post.decryptedEvent?.content || "";
      setContent(eventContent);
      setShowSchedule(true);
      const scheduledDate = new Date(post.scheduledAt);
      const pad = (n: number) => String(n).padStart(2, "0");
      const localISO = `${scheduledDate.getFullYear()}-${pad(scheduledDate.getMonth() + 1)}-${pad(scheduledDate.getDate())}T${pad(scheduledDate.getHours())}:${pad(scheduledDate.getMinutes())}`;
      setScheduleDateTime(localISO);
      if (post.kind === 1068) {
        setIsPollMode(true);
        const opts = post.decryptedEvent?.tags?.filter((t: string[]) => t[0] === "option")?.map((t: string[]) => t[2] || "") || ["", ""];
        setPollOptions(opts.length >= 2 ? opts : ["", ""]);
        const expTag = post.decryptedEvent?.tags?.find((t: string[]) => t[0] === "expiration");
        if (expTag) {
          const created = post.decryptedEvent?.created_at || 0;
          const diff = parseInt(expTag[1], 10) - created;
          const expMap: Record<number, string> = { 3600: "1h", 21600: "6h", 86400: "1d", 259200: "3d", 604800: "7d" };
          setPollExpiration(expMap[diff] || "1d");
        }
      } else {
        setIsPollMode(false);
      }
      if (post.kind === KIND_PICTURE) {
        // A kind-20's pictures live ONLY in its imeta tags (the caption holds
        // no URLs), so editing must rebuild the attachment list from them or
        // the re-scheduled post silently loses every image.
        const imetas = parseImetaTags(post.decryptedEvent?.tags || []);
        setMediaAttachments(imetas.filter((d) => d.url).map((d) => ({
          id: `media-${++mediaIdCounter}`,
          url: d.url,
          type: "image" as const,
          metadataStripped: false,
          mime: d.mimeType,
          sha256: d.sha256,
          dim: d.dimensions ? `${d.dimensions.width}x${d.dimensions.height}` : undefined,
          fallbackUrl: d.fallbacks?.[0],
        })));
        setPostAsPicture(true);
        setPictureTitle(post.decryptedEvent?.tags?.find((t: string[]) => t[0] === "title")?.[1] || "");
      }
      setDraftCount(getDraftCount());
      setIsOpen(true);
    };
    window.addEventListener("edit-scheduled-post", handler);
    return () => window.removeEventListener("edit-scheduled-post", handler);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const mobile = window.innerWidth < 640;
    let savedScrollY = 0;
    if (mobile) {
      savedScrollY = window.scrollY;
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.width = "100%";
      document.body.style.top = `-${savedScrollY}px`;
    }

    const vv = window.visualViewport;

    const update = () => {
      const m = window.innerWidth < 640;
      setIsMobile(m);
      if (m && vv) {
        setVpRect({ height: vv.height, top: vv.offsetTop });
      } else {
        setVpRect(null);
      }
    };
    update();
    if (vv) {
      vv.addEventListener("resize", update);
      vv.addEventListener("scroll", update);
    }
    window.addEventListener("resize", update);
    return () => {
      if (vv) {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
      }
      window.removeEventListener("resize", update);
      if (mobile) {
        document.documentElement.style.overflow = "";
        document.body.style.overflow = "";
        document.body.style.position = "";
        document.body.style.width = "";
        document.body.style.top = "";
        window.scrollTo(0, savedScrollY);
      }
    };
  }, [isOpen]);

  const handleFileUpload = useCallback(async (file: File) => {
    try {
      validateFile(file);
    } catch (err) {
      toast({ title: "Invalid file", description: err instanceof UploadError ? err.message : "Unsupported file.", variant: "destructive" });
      return;
    }

    if (isVideoFile(file)) {
      toast({ title: "Privacy notice", description: "Video metadata cannot be stripped in-browser. Consider removing location data before uploading." });
    }

    const fileIsVideo = isVideoFile(file);
    setIsUploading(true);
    setUploadStatus("Preparing...");
    try {
      const result = await uploadToNostrBuild(file, setUploadStatus, signer);
      const attachmentId = `media-${++mediaIdCounter}`;
      setMediaAttachments((prev) => [...prev, {
        id: attachmentId,
        url: result.url,
        type: fileIsVideo ? "video" : "image",
        metadataStripped: result.metadataStripped || false,
        mime: result.mime || file.type || undefined,
        sha256: result.sha256,
        dim: result.dim }]);
      // Fire-and-forget: mirror the blob to the user's other Blossom server in
      // the background. If it lands before the post is sent, the mirror URL is
      // included as an imeta `fallback`; otherwise the note still carries the
      // sha256 fingerprint and heals via server-list lookup.
      startAutoMirror(result, signer)
        .then((m) => {
          if (m.ok && m.url) {
            setMediaAttachments((prev) => prev.map((a) => (a.id === attachmentId ? { ...a, fallbackUrl: m.url } : a)));
          }
        })
        .catch(() => {});
      const desc = result.metadataStripped
        ? "Media attached. Location and device data were removed."
        : "Media attached to your note.";
      toast({ title: "Uploaded", description: desc });
    } catch (err) {
      console.error("Upload error:", err);
      toast({
        title: "Upload failed",
        description: err instanceof UploadError ? err.message : "Could not upload the file. Try again or use a smaller file.",
        variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  }, [signer, toast]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = "";
  };

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = "";
  };

  const handleAudioSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    try {
      validateFile(file);
    } catch (err) {
      toast({ title: "Invalid file", description: err instanceof UploadError ? err.message : "Unsupported file.", variant: "destructive" });
      return;
    }

    if (isAudioFile(file) && !canStripAudioMetadata(file)) {
      toast({ title: "Privacy notice", description: "This audio format's metadata could not be stripped. Consider removing location data before uploading." });
    }

    setIsUploading(true);
    setUploadStatus("Preparing...");
    try {
      const result = await uploadToNostrBuild(file, setUploadStatus, signer);
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
      setAudioAttachment({
        url: result.url,
        fileName: file.name,
        title: nameWithoutExt,
        coverUrl: "",
        metadataStripped: result.metadataStripped || false,
        mime: result.mime || file.type || undefined,
        sha256: result.sha256 });
      // Background mirror; recorded as imeta fallback only if this attachment
      // is still the active one (matched by URL) when the mirror completes.
      startAutoMirror(result, signer)
        .then((m) => {
          if (m.ok && m.url) {
            setAudioAttachment((prev) => (prev && prev.url === result.url ? { ...prev, fallbackUrl: m.url } : prev));
          }
        })
        .catch(() => {});
      const desc = result.metadataStripped
        ? "Audio uploaded. Metadata was scrubbed."
        : "Audio uploaded.";
      toast({ title: "Uploaded", description: desc });
    } catch (err) {
      console.error("Audio upload error:", err);
      toast({ title: "Upload failed", description: err instanceof UploadError ? err.message : "Could not upload audio.", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  }, [signer, toast]);

  const handleAudioCoverSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setCoverUploading(true);
    try {
      const result = await uploadToNostrBuild(file, undefined, signer);
      setAudioAttachment(prev => prev ? { ...prev, coverUrl: result.url } : prev);
      toast({ title: "Cover added", description: result.metadataStripped ? "Location data was removed." : "Cover art set." });
    } catch (err) {
      toast({ title: "Cover upload failed", description: "Could not upload cover art.", variant: "destructive" });
    } finally {
      setCoverUploading(false);
    }
  }, [signer, toast]);

  const handleArticleNav = () => {
    setIsOpen(false);
    setLocation("/articles/write");
  };

  const pictureEligible = useMemo(
    () => canPostAsPicture({
      attachments: mediaAttachments,
      hasAudio: !!audioAttachment,
      hasGif: !!gifUrl,
      isPoll: isPollMode,
      caption: content,
    }),
    [mediaAttachments, audioAttachment, gifUrl, isPollMode, content],
  );
  const isPictureMode = postAsPicture && pictureEligible;

  const pollHasContent = isPollMode && content.trim() && pollOptions.filter(o => o.trim()).length >= 2;
  const hasAnyContent = content.trim() || audioAttachment || mediaAttachments.length > 0 || gifUrl || pollHasContent;

  const handleSaveDraft = useCallback(() => {
    if (!hasAnyContent) {
      toast({ title: "Nothing to save", description: "Add some content before saving a draft." });
      return;
    }
    const draftData = {
      content,
      mediaAttachments,
      audioAttachment,
      gifUrl,
      relayPreset: relayPref.preset,
      relayLabel,
      isPollMode: isPollMode || undefined,
      pollOptions: isPollMode ? pollOptions : undefined,
      pollExpiration: isPollMode ? pollExpiration : undefined,
      postAsPicture: postAsPicture || undefined,
      pictureTitle: pictureTitle.trim() || undefined };
    if (activeDraftId) {
      updateDraft(activeDraftId, draftData);
      toast({ title: "Draft updated" });
    } else {
      const draft = saveDraft(draftData);
      setActiveDraftId(draft.id);
      toast({ title: "Draft saved" });
    }
    setDraftCount(getDraftCount());
  }, [content, mediaAttachments, audioAttachment, gifUrl, relayPref.preset, relayLabel, activeDraftId, hasAnyContent, toast, isPollMode, pollOptions, pollExpiration, postAsPicture, pictureTitle]);

  const applyDraft = useCallback((draft: Draft) => {
    setContent(draft.content);
    setMediaAttachments(draft.mediaAttachments);
    setAudioAttachment(draft.audioAttachment);
    setGifUrl(draft.gifUrl);
    if (draft.relayPreset) {
      setRelayPref({ preset: draft.relayPreset as any });
    }
    setIsPollMode(!!draft.isPollMode);
    setPollOptions(draft.pollOptions && draft.pollOptions.length >= 2 ? draft.pollOptions : ["", ""]);
    setPollExpiration(draft.pollExpiration || "1d");
    setPostAsPicture(!!draft.postAsPicture);
    setPictureTitle(draft.pictureTitle || "");
    setActiveDraftId(draft.id);
    setShowDrafts(false);
    toast({ title: "Draft restored" });
  }, [toast, setRelayPref]);

  const [pendingDraft, setPendingDraft] = useState<Draft | null>(null);

  const handleRestoreDraft = useCallback((draft: Draft) => {
    if (hasAnyContent && activeDraftId !== draft.id) {
      setPendingDraft(draft);
    } else {
      applyDraft(draft);
    }
  }, [hasAnyContent, activeDraftId, applyDraft]);

  const handleDeleteDraft = useCallback((id: string) => {
    deleteDraft(id);
    setDraftCount(getDraftCount());
    if (activeDraftId === id) setActiveDraftId(null);
  }, [activeDraftId]);

  const handlePublish = async () => {
    if (isPollMode) {
      if (!content.trim() || pollOptions.filter(o => o.trim()).length < 2) return;
    } else {
      if (!content.trim() && !audioAttachment && mediaAttachments.length === 0 && !gifUrl) return;
    }

    if (!signer) {
      toast({
        title: isReconnecting ? "Reconnecting..." : "Not signed in",
        description: isReconnecting
          ? "Still reconnecting to your signer. Try again in a moment."
          : "Sign in with a Nostr extension to post.",
        variant: "destructive" });
      return;
    }

    setIsPublishing(true);
    try {
      if (isPollMode) {
        const validOptions = pollOptions.filter(o => o.trim());
        const tags: string[][] = validOptions.map((label, i) => ["option", String(i), label.trim()]);

        if (pollExpiration) {
          const durations: Record<string, number> = {
            "1h": 3600,
            "6h": 21600,
            "1d": 86400,
            "3d": 259200,
            "7d": 604800 };
          const seconds = durations[pollExpiration];
          if (seconds) {
            tags.push(["expiration", String(Math.floor(Date.now() / 1000) + seconds)]);
          }
        }

        tags.push(...extractHashtags(content));
        tags.push(...clientTags());
        if (willBeProtected) tags.push(["-"]);

        const pollEvent = {
          kind: 1068,
          created_at: Math.floor(Date.now() / 1000),
          tags,
          content: content.trim() };

        const signedPoll = await signWithTimeout(signer, pollEvent);
        const isUserSelected = relayPref.preset !== "all";
        const isPrivateOnly = relayPref.preset === "private";
        const published = await publishEvent(signedPoll, publishTargets, undefined, isUserSelected, isPrivateOnly);
        if (!published) {
          throw new Error("Poll was rejected by all relays");
        }

        setContent("");
        setPollOptions(["", ""]);
        setPollExpiration("1d");
        setIsPollMode(false);
        setIsOpen(false);
        clearMentionTags();
        clearEmojiTags();
        if (activeDraftId) {
          deleteDraft(activeDraftId);
          setActiveDraftId(null);
          setDraftCount(getDraftCount());
        }
        toast({ title: "Poll published", description: "Your poll has been broadcast to the network." });
        setIsPublishing(false);
        return;
      }

      if (isPictureMode) {
        const extraTags: string[][] = [...getMentionTags(content), ...getEmojiTags(content), ...extractHashtags(content), ...clientTags()];
        if (willBeProtected) extraTags.push(["-"]);
        const template = buildPictureEvent({
          caption: resolveContent(content),
          title: pictureTitle,
          attachments: mediaAttachments,
          extraTags,
          createdAt: Math.floor(Date.now() / 1000),
        });
        // Gated by canPostAsPicture, so a null here is a bug — surface it
        // rather than silently downgrading the post the author asked for.
        if (!template) throw new Error("Couldn't assemble the picture post");
        const signedEvent = await signWithTimeout(signer, template);
        markHasPosted(signedEvent.pubkey);
        const isUserSelected = relayPref.preset !== "all";
        const isPrivateOnly = relayPref.preset === "private";
        // Same optimistic contract as notes below: local echo immediately,
        // background publish, retry toast on total rejection.
        publishEvent(signedEvent, publishTargets, undefined, isUserSelected, isPrivateOnly)
          .then((published) => { if (!published) throw new Error("Event was rejected by all relays"); })
          .catch((err) => {
            console.error(err);
            if (!wasAuthRequiredRecently()) {
              toast({
                title: "Couldn't publish",
                description: "Your picture post didn't reach any relays.",
                variant: "destructive",
                action: (
                  <button
                    onClick={() => { publishEvent(signedEvent, publishTargets, undefined, isUserSelected, isPrivateOnly).catch(() => {}); }}
                    className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium bg-foreground/10 hover:bg-foreground/20 transition-colors"
                  >
                    Retry
                  </button>
                ) as any,
              });
            }
          });
        if (activeDraftId) {
          deleteDraft(activeDraftId);
          setActiveDraftId(null);
          setDraftCount(getDraftCount());
        }
        setContent("");
        setMediaAttachments([]);
        setPreviewMedia(null);
        setPostAsPicture(false);
        setPictureTitle("");
        setIsOpen(false);
        clearMentionTags();
        clearEmojiTags();
        toast({ title: "Published", description: "Your picture post has been broadcast." });
        setIsPublishing(false);
        return;
      }

      if (audioAttachment) {
        const trackTitle = audioAttachment.title.trim() || "Untitled Track";
        const artistName = profile?.display_name || profile?.name || "Unknown Artist";
        const dTag = `${trackTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Math.floor(Date.now() / 1000)}`;

        const trackTags: string[][] = [
          ["d", dTag],
          ["title", trackTitle],
          ["subject", trackTitle],
          ["artist", artistName],
          ["media", audioAttachment.url],
          ["url", audioAttachment.url],
        ];
        if (audioAttachment.coverUrl) {
          trackTags.push(["cover", audioAttachment.coverUrl]);
          trackTags.push(["image", audioAttachment.coverUrl]);
        }
        trackTags.push(["t", "music"]);
        trackTags.push(...clientTags());
        if (willBeProtected) trackTags.push(["-"]);

        const trackEvent = {
          kind: KIND_MUSIC_TRACK,
          created_at: Math.floor(Date.now() / 1000),
          tags: trackTags,
          content: "" };
        const signedTrack = await signWithTimeout(signer, trackEvent);
        const isUserSelected = relayPref.preset !== "all";
        const isPrivateOnly = relayPref.preset === "private";
        await publishEvent(signedTrack, publishTargets, undefined, isUserSelected, isPrivateOnly);
      }

      const tags: string[][] = [...getMentionTags(content), ...getEmojiTags(content), ...extractHashtags(content), ...clientTags()];
      tags.push(...buildMediaImetaTags(mediaAttachments, audioAttachment));
      if (willBeProtected) tags.push(["-"]);
      let publishContent = resolveContent(content);
      if (audioAttachment) {
        const separator = publishContent.trim() ? "\n" : "";
        publishContent = publishContent + separator + audioAttachment.url;
      }

      for (const media of mediaAttachments) {
        const separator = publishContent.trim() ? "\n" : "";
        publishContent = publishContent + separator + media.url;
      }

      if (gifUrl) {
        const separator = publishContent.trim() ? "\n" : "";
        publishContent = publishContent + separator + gifUrl;
      }

      if (publishContent.trim()) {
        const eventTemplate = {
          kind: KIND_TEXT_NOTE,
          created_at: Math.floor(Date.now() / 1000),
          tags,
          content: publishContent };
        const signedEvent = await signWithTimeout(signer, eventTemplate);
        markHasPosted(signedEvent.pubkey); // ticks the getting-started checklist
        const isUserSelected = relayPref.preset !== "all";
        const isPrivateOnly = relayPref.preset === "private";
        // Optimistic: publishEvent adds the note to the local eventStore
        // synchronously (for non-private notes), so it surfaces at the top of the
        // feed immediately and the composer can close without waiting for the
        // relay round-trip. The publish completes in the background; on failure we
        // surface a retry that re-broadcasts the already-signed event.
        publishEvent(signedEvent, publishTargets, undefined, isUserSelected, isPrivateOnly)
          .then((published) => { if (!published) throw new Error("Event was rejected by all relays"); })
          .catch((err) => {
            // Signing already succeeded in the foreground above, so a background
            // failure here is a relay/publish error (never a signer error).
            console.error(err);
            if (!wasAuthRequiredRecently()) {
              toast({
                title: "Couldn't publish",
                description: "Your note didn't reach any relays.",
                variant: "destructive",
                action: (
                  <button
                    onClick={() => { publishEvent(signedEvent, publishTargets, undefined, isUserSelected, isPrivateOnly).catch(() => {}); }}
                    className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium bg-foreground/10 hover:bg-foreground/20 transition-colors"
                  >
                    Retry
                  </button>
                ) as any,
              });
            }
          });
      }

      if (activeDraftId) {
        deleteDraft(activeDraftId);
        setActiveDraftId(null);
        setDraftCount(getDraftCount());
      }
      setContent("");
      setAudioAttachment(null);
      setMediaAttachments([]);
      setPreviewMedia(null);
      setGifUrl(null);
      setPostAsPicture(false);
      setPictureTitle("");
      setIsOpen(false);
      clearMentionTags();
      clearEmojiTags();
      toast({ title: "Published", description: audioAttachment ? "Your track and note have been broadcast." : "Your note has been broadcast." });

      try {
        const HINT_KEY = "nostr_first_post_outpost_hint_shown";
        if (outpostCount === 0 && localStorage.getItem(HINT_KEY) !== "true") {
          localStorage.setItem(HINT_KEY, "true");
          setTimeout(() => {
            toast({
              title: "Want to reach specific communities?",
              description: "Communities are relays focused on topics or groups. Discover them anytime.",
              action: (
                <button
                  onClick={() => setLocation("/outposts")}
                  className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium bg-accent text-brand hover:bg-accent/70 dark:bg-brand/15 dark:hover:bg-brand/25 transition-colors"
                >
                  Discover Communities
                </button>
              ) as any,
            });
          }, 1200);
        }
      } catch {}
    } catch (err) {
      console.error(err);
      if (isSignerError(err)) {
        await handleSignerError(err, toast, attemptReconnect);
      } else if (wasAuthRequiredRecently()) {
        // Suppress generic toast — the publish helper already surfaced a clear
        // AUTH-required message naming the relay.
      } else {
        const msg = err instanceof Error && err.message.includes("No relays")
          ? "No relays available. If using Private Only mode, make sure you have a private relay configured."
          : "Something went wrong while sending your note.";
        toast({
          title: "Failed to publish",
          description: msg,
          variant: "destructive" });
      }
    } finally {
      setIsPublishing(false);
    }
  };

  const handleSchedule = async () => {
    if (!scheduleDateTime) {
      toast({ title: "Select a date & time", description: "Pick when you'd like this post published.", variant: "destructive" });
      return;
    }
    const scheduledDate = new Date(scheduleDateTime);
    if (scheduledDate.getTime() <= Date.now()) {
      toast({ title: "Invalid time", description: "Scheduled time must be in the future.", variant: "destructive" });
      return;
    }
    if (!signer || !pubkey) {
      toast({ title: "Not signed in", description: "Sign in with a Nostr extension to schedule.", variant: "destructive" });
      return;
    }
    const scheduledCreatedAt = Math.floor(scheduledDate.getTime() / 1000);

    setIsPublishing(true);
    try {
      let signedEvent: any;
      let contentPreview = "";

      // Route to the on-device store or the server scheduler. When editing, follow
      // the existing item's backend; otherwise use the current preference.
      const useDevice = editingPost ? (editingPost as any).backend === "device" : scheduleBackend === "device";
      const doCreate = (ev: any, relays: string[], when: Date, pk: string, preview: string) =>
        useDevice
          ? Promise.resolve(createLocalScheduledPost(ev, relays, when, pk, preview))
          : createScheduledPost(ev, relays, when, pk, preview);
      const doUpdate = (id: number, pk: string, updates: any) =>
        useDevice
          ? Promise.resolve(updateLocalScheduledPost(id, pk, updates))
          : updateScheduledPost(id, pk, updates);

      if (isPollMode) {
        const validOptions = pollOptions.filter(o => o.trim());
        if (!content.trim() || validOptions.length < 2) return;
        const tags: string[][] = validOptions.map((label, i) => ["option", String(i), label.trim()]);
        if (pollExpiration) {
          const durations: Record<string, number> = { "1h": 3600, "6h": 21600, "1d": 86400, "3d": 259200, "7d": 604800 };
          const seconds = durations[pollExpiration];
          if (seconds) tags.push(["expiration", String(scheduledCreatedAt + seconds)]);
        }
        tags.push(...extractHashtags(content));
        tags.push(...clientTags());
        if (willBeProtected) tags.push(["-"]);
        signedEvent = await signWithTimeout(signer, { kind: 1068, created_at: scheduledCreatedAt, tags, content: content.trim() });
        contentPreview = content.trim();
      } else if (isPictureMode) {
        const extraTags: string[][] = [...getMentionTags(content), ...getEmojiTags(content), ...extractHashtags(content), ...clientTags()];
        if (willBeProtected) extraTags.push(["-"]);
        const template = buildPictureEvent({
          caption: resolveContent(content),
          title: pictureTitle,
          attachments: mediaAttachments,
          extraTags,
          createdAt: scheduledCreatedAt,
        });
        if (!template) throw new Error("Couldn't assemble the picture post");
        signedEvent = await signWithTimeout(signer, template);
        contentPreview = template.content || pictureTitle.trim() || "Picture post";
      } else {
        const tags: string[][] = [...getMentionTags(content), ...getEmojiTags(content), ...extractHashtags(content), ...clientTags()];
        tags.push(...buildMediaImetaTags(mediaAttachments, audioAttachment));
        if (willBeProtected) tags.push(["-"]);
        let publishContent = resolveContent(content);
        if (audioAttachment) publishContent = publishContent + (publishContent.trim() ? "\n" : "") + audioAttachment.url;
        for (const media of mediaAttachments) publishContent = publishContent + (publishContent.trim() ? "\n" : "") + media.url;
        if (gifUrl) publishContent = publishContent + (publishContent.trim() ? "\n" : "") + gifUrl;
        if (!publishContent.trim()) return;

        if (audioAttachment) {
          const trackTitle = audioAttachment.title.trim() || "Untitled Track";
          const artistName = profile?.display_name || profile?.name || "Unknown Artist";
          const dTag = `${trackTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${scheduledCreatedAt}`;
          const trackTags: string[][] = [["d", dTag], ["title", trackTitle], ["subject", trackTitle], ["artist", artistName], ["media", audioAttachment.url], ["url", audioAttachment.url]];
          if (audioAttachment.coverUrl) { trackTags.push(["cover", audioAttachment.coverUrl]); trackTags.push(["image", audioAttachment.coverUrl]); }
          trackTags.push(["t", "music"]); trackTags.push(...clientTags());
          if (willBeProtected) trackTags.push(["-"]);
          const signedTrack = await signWithTimeout(signer, { kind: KIND_MUSIC_TRACK, created_at: scheduledCreatedAt, tags: trackTags, content: "" });
          await doCreate(signedTrack, selectedRelays, scheduledDate, pubkey, trackTitle);
        }

        signedEvent = await signWithTimeout(signer, { kind: KIND_TEXT_NOTE, created_at: scheduledCreatedAt, tags, content: publishContent });
        contentPreview = publishContent;
      }

      if (editingPost) {
        await doUpdate(editingPost.id, pubkey, {
          scheduledAt: scheduledDate,
          signedEvent,
          contentPreview,
          kind: signedEvent.kind,
        });
        setEditingPost(null);
        window.dispatchEvent(new CustomEvent("scheduled-post-updated"));
      } else {
        await doCreate(signedEvent, selectedRelays, scheduledDate, pubkey, contentPreview);
        window.dispatchEvent(new CustomEvent("scheduled-post-updated"));
      }

      setContent("");
      setAudioAttachment(null);
      setMediaAttachments([]);
      setPreviewMedia(null);
      setGifUrl(null);
      setPollOptions(["", ""]);
      setPollExpiration("1d");
      setIsPollMode(false);
      setPostAsPicture(false);
      setPictureTitle("");
      setShowSchedule(false);
      setScheduleDateTime("");
      setIsOpen(false);
      clearMentionTags();
      clearEmojiTags();
      if (activeDraftId) {
        deleteDraft(activeDraftId);
        setActiveDraftId(null);
        setDraftCount(getDraftCount());
      }

      const timeLabel = scheduledDate.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      toast({ title: editingPost ? "Updated" : "Scheduled", description: editingPost ? `Your scheduled post has been updated for ${timeLabel}.` : `Your post will be published ${timeLabel}.` });
    } catch (err: any) {
      console.error(err);
      toast({ title: "Schedule failed", description: err.message || "Something went wrong.", variant: "destructive" });
    } finally {
      setIsPublishing(false);
    }
  };

  const handleComposeTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    const cursor = e.target.selectionStart ?? val.length;
    detectMention(val, cursor);
  }, [detectMention]);

  const handleMentionSelect = useCallback((result: import("@/components/MentionSearch").MentionResult) => {
    const newContent = insertMention(result, content, textareaRef);
    setContent(newContent);
  }, [content, insertMention]);

  const handleEmojiInsert = useCallback((text: string, emoji?: CustomEmoji) => {
    if (emoji) trackEmoji(emoji);
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? content.length;
    const before = content.slice(0, cursor);
    const after = content.slice(cursor);
    const spaceBefore = before.length > 0 && !before.endsWith(" ") && !text.startsWith("\n") ? " " : "";
    const spaceAfter = after.length > 0 && !after.startsWith(" ") && !text.endsWith("\n") ? " " : "";
    const newContent = before + spaceBefore + text + spaceAfter + after;
    setContent(newContent);
    requestAnimationFrame(() => {
      if (ta) {
        const newCursor = (before + spaceBefore + text + spaceAfter).length;
        ta.selectionStart = newCursor;
        ta.selectionEnd = newCursor;
        ta.focus();
      }
    });
  }, [content, trackEmoji]);

  const removeMediaAttachment = useCallback((id: string) => {
    setMediaAttachments((prev) => prev.filter((m) => m.id !== id));
    setPreviewMedia(null);
  }, []);

  if (!pubkey) return null;
  if (location.startsWith("/messages")) return null;

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-hidden max-w-[100vw]" data-testid="overlay-create-post">
          <div
            className="absolute inset-0 bg-black/60 sm:backdrop-blur-sm"
            onClick={() => { setIsOpen(false); setEditingPost(null); }}
          />
          <div
            className={`z-10 w-full glass-dialog flex flex-col overflow-x-hidden overflow-y-hidden ${isMobile ? "fixed inset-x-0 max-w-[100vw]" : "relative max-w-lg mx-2 rounded-xl max-h-[85vh]"}`}
            style={vpRect ? { top: `${vpRect.top}px`, height: `${vpRect.height}px` } : isMobile ? { top: 0, bottom: 0, height: "100%" } : undefined}
            onClick={(e) => e.stopPropagation()}
            data-testid="container-create-post"
          >
            <div className={`absolute inset-0 pointer-events-none overflow-hidden ${isMobile ? "" : "rounded-xl"}`}>
              <div
                className="absolute -top-20 -right-20 w-48 h-48 rounded-full opacity-[0.07]"
                style={{ background: "radial-gradient(circle, rgba(140, 100, 220, 0.8), transparent 70%)" }}
              />
              <div
                className="absolute -bottom-16 -left-16 w-40 h-40 rounded-full opacity-[0.05]"
                style={{ background: "radial-gradient(circle, rgba(100, 60, 200, 0.7), transparent 70%)" }}
              />
            </div>

            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageSelect}
              data-testid="input-image-upload"
            />
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={handleVideoSelect}
              data-testid="input-video-upload"
            />
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={handleAudioSelect}
              data-testid="input-audio-upload"
            />
            <input
              ref={audioCoverInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAudioCoverSelect}
              data-testid="input-audio-cover-upload"
            />

            <div className={`relative z-10 glass-header shrink-0 ${isMobile ? "" : "rounded-t-xl"}`} style={{ paddingTop: isMobile ? "env(safe-area-inset-top, 0px)" : undefined }}>
              <div className="flex items-center gap-2 px-3 py-2 max-w-full">
                <Button
                  size="icon"
                  variant="ghost"
                  className="shrink-0 h-9 w-9"
                  onClick={() => { setIsOpen(false); setShowDrafts(false); setIsPollMode(false); setPollOptions(["", ""]); setPollExpiration("1d"); setPostAsPicture(false); setPictureTitle(""); setEditingPost(null); }}
                  data-testid="button-close-compose"
                >
                  <X className="w-4 h-4" />
                </Button>

                {outpostCount === 0 ? (
                  <button
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-muted-foreground/55 hover:text-foreground/80 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
                    onClick={() => setShowRelayPicker(true)}
                    data-testid="button-relay-manage-link"
                    title="Choose where this posts"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                    <span className="truncate">Posting to defaults</span>
                    <span className="opacity-40">·</span>
                    <span className="text-brand/80 hover:text-brand">Manage</span>
                  </button>
                ) : (() => {
                  const ms = getRelayModeStyle(relayPref.preset);
                  return (
                    <button
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors ${ms.text}`}
                      onClick={() => setShowRelayPicker(true)}
                      data-testid="button-relay-selector"
                    >
                      <span className={`w-2 h-2 rounded-full ${ms.dot} shrink-0`} />
                      <span className="truncate max-w-[160px]">{relayLabel}</span>
                      <ChevronDown className="w-3 h-3 opacity-50 shrink-0" />
                    </button>
                  );
                })()}

                {willBeProtected && (
                  <span
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 shrink-0"
                    title="This post will be tagged protected (NIP-70). It will only be sent to the selected relay(s) and other clients shouldn't rebroadcast it."
                    data-testid="hint-will-be-protected"
                  >
                    <ShieldCheck className="w-2.5 h-2.5" />
                    <span className="hidden sm:inline">Protected</span>
                  </span>
                )}

                <div className="flex-1" />

                <Button
                  variant="ghost"
                  size="sm"
                  className={`shrink-0 h-9 w-9 p-0 ${showSchedule ? "text-brand" : "text-muted-foreground/40 hover:text-foreground"}`}
                  onClick={() => setShowSchedule(!showSchedule)}
                  title="Schedule for later"
                  data-testid="button-toggle-schedule"
                >
                  <Calendar className="w-4 h-4" />
                </Button>

                {showSchedule ? (
                  <Button
                    onClick={handleSchedule}
                    disabled={isPollMode
                      ? (!content.trim() || pollOptions.filter(o => o.trim()).length < 2 || isPublishing || !scheduleDateTime)
                      : ((!content.trim() && !audioAttachment && mediaAttachments.length === 0 && !gifUrl) || isPublishing || isUploading || !scheduleDateTime)
                    }
                    size="sm"
                    className="shrink-0 h-9 px-4 bg-primary hover:bg-primary/90 text-primary-foreground dark:bg-brand dark:hover:bg-brand dark:text-white"
                    data-testid="button-schedule"
                  >
                    {isPublishing ? (
                      <RelayOutpostInlineLoader className="w-3.5 h-3.5 mr-1" />
                    ) : (
                      <Clock className="w-3.5 h-3.5 mr-1" />
                    )}
                    {editingPost ? "Update" : "Schedule"}
                  </Button>
                ) : (
                  <Button
                    onClick={handlePublish}
                    disabled={isPollMode
                      ? (!content.trim() || pollOptions.filter(o => o.trim()).length < 2 || isPublishing)
                      : ((!content.trim() && !audioAttachment && mediaAttachments.length === 0 && !gifUrl) || isPublishing || isUploading)
                    }
                    size="sm"
                    className="shrink-0 h-9 px-4"
                    data-testid="button-publish"
                  >
                    {isPublishing ? (
                      <RelayOutpostInlineLoader className="w-3.5 h-3.5 mr-1" />
                    ) : isPollMode ? (
                      <BarChart3 className="w-3.5 h-3.5 mr-1" />
                    ) : isPictureMode ? (
                      <Images className="w-3.5 h-3.5 mr-1" />
                    ) : (
                      <Send className="w-3.5 h-3.5 mr-1" />
                    )}
                    {isPollMode ? "Publish Poll" : isPictureMode ? "Post Picture" : "Post"}
                  </Button>
                )}
              </div>

              {showSchedule && (() => {
                const tzAbbr = new Intl.DateTimeFormat([], { timeZoneName: "short" }).formatToParts(new Date()).find(p => p.type === "timeZoneName")?.value || "";
                const offsetMin = new Date().getTimezoneOffset();
                const sign = offsetMin <= 0 ? "+" : "-";
                const absH = Math.floor(Math.abs(offsetMin) / 60);
                const absM = Math.abs(offsetMin) % 60;
                const utcLabel = `UTC${sign}${absH}${absM ? `:${String(absM).padStart(2, "0")}` : ""}`;
                const toLocal = (d: Date) => {
                  const y = d.getFullYear();
                  const mo = String(d.getMonth() + 1).padStart(2, "0");
                  const da = String(d.getDate()).padStart(2, "0");
                  const h = String(d.getHours()).padStart(2, "0");
                  const mi = String(d.getMinutes()).padStart(2, "0");
                  return `${y}-${mo}-${da}T${h}:${mi}`;
                };
                const presets: { label: string; value: () => string }[] = [
                  { label: "1hr", value: () => toLocal(new Date(Date.now() + 60 * 60000)) },
                  { label: "3hr", value: () => toLocal(new Date(Date.now() + 3 * 60 * 60000)) },
                  { label: "6hr", value: () => toLocal(new Date(Date.now() + 6 * 60 * 60000)) },
                  { label: "Tomorrow 9am", value: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return toLocal(d); } },
                  { label: "Tomorrow 12pm", value: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(12, 0, 0, 0); return toLocal(d); } },
                ];
                const selectedDate = scheduleDateTime ? new Date(scheduleDateTime) : null;
                const friendlyTime = selectedDate
                  ? selectedDate.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                  : null;
                const utcTime = selectedDate
                  ? selectedDate.toISOString().slice(0, 16).replace("T", " ") + " UTC"
                  : null;
                return (
                  <div className="px-4 pb-2 -mt-0.5 space-y-1.5">
                    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
                      {presets.map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => setScheduleDateTime(p.value())}
                          className="shrink-0 px-2 py-1 rounded-md text-[10px] bg-accent text-brand hover:bg-accent/70 dark:bg-brand/10 dark:hover:bg-brand/20 transition-colors"
                        >
                          {p.label}
                        </button>
                      ))}
                      <span className="shrink-0 text-[9px] text-muted-foreground/40 pl-1">{tzAbbr}{tzAbbr !== utcLabel ? ` · ${utcLabel}` : ""}</span>
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-accent/50 border border-border dark:bg-brand/5 dark:border-brand/15">
                      <Clock className="w-3.5 h-3.5 text-brand shrink-0" />
                      {friendlyTime ? (
                        <span className="flex-1 text-xs text-foreground truncate">{friendlyTime}</span>
                      ) : (
                        <span className="flex-1 text-xs text-muted-foreground/50">Pick a time above or choose custom</span>
                      )}
                      <div className="shrink-0 relative">
                        <input
                          type="datetime-local"
                          value={scheduleDateTime}
                          onChange={(e) => setScheduleDateTime(e.target.value)}
                          min={new Date(Date.now() + 5 * 60000).toISOString().slice(0, 16)}
                          className="w-[5.5rem] text-[10px] bg-transparent border-none outline-none text-brand/70 cursor-pointer [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                          title="Pick custom date & time"
                          data-testid="input-schedule-datetime"
                        />
                      </div>
                      <button
                        className="text-muted-foreground/40 hover:text-foreground shrink-0"
                        onClick={() => { setShowSchedule(false); setScheduleDateTime(""); }}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {!editingPost && (
                      <div className="flex items-center gap-1.5 px-0.5">
                        <span className="text-[9px] uppercase tracking-wide text-muted-foreground/40 shrink-0">Publish via</span>
                        <button
                          type="button"
                          onClick={() => chooseBackend("server")}
                          className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${scheduleBackend === "server" ? "bg-accent text-accent-foreground border-brand/20 dark:bg-brand/15 dark:border-brand/40 dark:text-brand" : "border-border/30 text-muted-foreground/60 hover:text-foreground"}`}
                          data-testid="button-schedule-backend-server"
                          title="Reliable — publishes even when the app is closed. Your scheduled post is stored on the server (operator-readable) until it publishes."
                        >
                          Server · reliable
                        </button>
                        <button
                          type="button"
                          onClick={() => chooseBackend("device")}
                          className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${scheduleBackend === "device" ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-800 dark:text-emerald-300" : "border-border/30 text-muted-foreground/60 hover:text-foreground"}`}
                          data-testid="button-schedule-backend-device"
                          title="Private — stays on this device and publishes when due, only while the app is open."
                        >
                          This device · private
                        </button>
                      </div>
                    )}
                    {!editingPost && scheduleBackend === "device" && (
                      <p className="text-[8px] text-emerald-800/60 dark:text-emerald-400/60 pl-1">Publishes from this device when the app is open — nothing is sent to a server.</p>
                    )}
                    {utcTime && (
                      <p className="text-[8px] text-muted-foreground/40 pl-6">{utcTime}</p>
                    )}
                  </div>
                );
              })()}

              {isUploading && (
                <div className="px-4 pb-1.5 -mt-1">
                  <span className="text-[11px] text-brand/60 flex items-center gap-1.5" data-testid="text-uploading">
                    <RelayOutpostInlineLoader className="w-3 h-3" />
                    {uploadStatus}
                  </span>
                </div>
              )}
            </div>

            {showShieldInfo && (
              <div className="relative z-10 mx-4 sm:mx-3 px-3 py-2.5 rounded-lg bg-green-500/[0.06] border border-green-500/15 space-y-1.5" data-testid="container-shield-info">
                <div className="flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  Signal Protection Active
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Images are scrubbed before leaving your device. GPS, device info, timestamps, and camera data are stripped automatically.
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Audio files (MP3, WAV, FLAC) are scrubbed of ID3 tags, recording metadata, and embedded info before upload.
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground/60">
                  Video metadata can't be scrubbed in-browser. GPS and device info may be embedded — strip it before uploading with a free tool like{" "}
                  <a href="https://handbrake.fr" target="_blank" rel="noopener noreferrer" className="text-green-600 dark:text-green-400 underline underline-offset-2 hover:text-green-500">HandBrake</a>.
                </p>
              </div>
            )}

            {pendingDraft && (
              <div className="relative z-20 mx-3 mt-1 rounded-lg bg-amber-500/[0.08] border border-amber-500/20 p-3 space-y-2" data-testid="container-draft-confirm">
                <p className="text-[12px] text-amber-200/80">You have unsaved content. Replace it with this draft?</p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px] text-amber-800 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 hover:bg-amber-500/10"
                    onClick={() => {
                      handleSaveDraft();
                      applyDraft(pendingDraft);
                      setPendingDraft(null);
                    }}
                  >
                    Save current & restore
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px] text-foreground/60 hover:text-foreground"
                    onClick={() => { applyDraft(pendingDraft); setPendingDraft(null); }}
                  >
                    Discard & restore
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px] text-muted-foreground/40 hover:text-muted-foreground"
                    onClick={() => setPendingDraft(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {showDrafts && (
              <div className="relative z-10 mx-3 sm:mx-3 mt-1 rounded-lg bg-accent/40 border border-border dark:bg-brand/[0.04] dark:border-brand/15 overflow-hidden" data-testid="container-drafts-panel">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border dark:border-brand/10">
                  <span className="text-[11px] font-medium text-brand/80 uppercase tracking-wider">Saved Drafts</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground/40 hover:text-muted-foreground" onClick={() => setShowDrafts(false)}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
                <div className="max-h-[200px] overflow-y-auto divide-y divide-border/20">
                  {getDrafts().length === 0 ? (
                    <div className="px-3 py-4 text-center text-[11px] text-muted-foreground/50">No drafts saved</div>
                  ) : (
                    getDrafts().map((draft) => {
                      const preview = getDraftPreview(draft);
                      const age = formatDraftAge(draft.updatedAt);
                      const ms = getRelayModeStyle(draft.relayPreset);
                      const isActive = activeDraftId === draft.id;
                      return (
                        <div
                          key={draft.id}
                          className={`flex items-start gap-2.5 px-3 py-2.5 hover:bg-accent/40 dark:hover:bg-white/[0.02] transition-colors group ${isActive ? "bg-accent dark:bg-brand/[0.06]" : ""}`}
                        >
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleRestoreDraft(draft)}>
                            <p className="text-[12px] text-foreground/80 truncate leading-snug">{preview}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] text-muted-foreground/40">{age}</span>
                              {draft.relayLabel && (
                                <span className={`text-[10px] ${ms.text} flex items-center gap-1`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${ms.dot}`} />
                                  {draft.relayLabel}
                                </span>
                              )}
                              {draft.mediaAttachments.length > 0 && (
                                <span className="text-[10px] text-muted-foreground/40 flex items-center gap-0.5">
                                  <Image className="w-2.5 h-2.5" />
                                  {draft.mediaAttachments.length}
                                </span>
                              )}
                              {draft.audioAttachment && (
                                <span className="text-[10px] text-muted-foreground/40 flex items-center gap-0.5">
                                  <Music className="w-2.5 h-2.5" />
                                </span>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0 h-6 w-6 text-muted-foreground/30 hover:text-red-700 dark:hover:text-red-400 reveal-on-hover touch-target"
                            aria-label="Delete draft"
                            title="Delete draft"
                            onClick={(e) => { e.stopPropagation(); handleDeleteDraft(draft.id); }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            <div className="relative z-10 border-b border-border/30 mx-4 sm:mx-3" />

            {audioAttachment && (
              <div className="relative z-10 mx-4 sm:mx-3 mt-2 rounded-lg bg-accent/40 border border-border dark:bg-brand/[0.06] dark:border-brand/15 p-2.5" data-testid="container-audio-attachment">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    className="w-11 h-11 rounded-md overflow-hidden shrink-0 bg-accent dark:bg-brand/10 flex items-center justify-center hover:bg-accent/70 dark:hover:bg-brand/20 transition-colors"
                    onClick={() => audioCoverInputRef.current?.click()}
                    disabled={coverUploading}
                    data-testid="button-audio-cover"
                  >
                    {coverUploading ? (
                      <RelayOutpostInlineLoader className="w-4 h-4 text-brand/60" />
                    ) : audioAttachment.coverUrl ? (
                      <img src={audioAttachment.coverUrl} alt="Cover" className="w-full h-full object-cover" />
                    ) : (
                      <ImagePlus className="w-4 h-4 text-brand/50" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <input
                      type="text"
                      value={audioAttachment.title}
                      onChange={(e) => setAudioAttachment(prev => prev ? { ...prev, title: e.target.value } : prev)}
                      placeholder="Track title"
                      className="w-full bg-transparent border-0 outline-none text-sm font-medium text-foreground/80 placeholder:text-muted-foreground/40 p-0"
                      style={{ fontSize: 16 }}
                      data-testid="input-audio-title"
                    />
                    <p className="text-[10px] text-muted-foreground/50 truncate mt-0.5">{audioAttachment.fileName}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {audioAttachment.metadataStripped && (
                      <ShieldCheck className="w-3.5 h-3.5 text-green-500/70" />
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-7 h-7 text-muted-foreground/50 hover:text-destructive"
                      onClick={() => setAudioAttachment(null)}
                      data-testid="button-remove-audio-attachment"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {mentionActive && (
              <div className="relative z-20 px-4 sm:px-3 pt-2">
                <MentionSearch
                  query={mentionQuery}
                  visible={mentionActive}
                  onSelect={handleMentionSelect}
                  onClose={closeMention}
                  position="static"
                />
              </div>
            )}

            <div className="relative z-10 flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 pt-3 sm:px-3 sm:pt-3 pb-3 flex flex-col">
              <div className="flex gap-3 items-start flex-1 min-h-0">
                <div
                  className="shrink-0 rounded-full mt-0.5"
                  style={{
                    padding: "1.5px",
                    background: "conic-gradient(from 0deg, rgba(140, 80, 220, 0.25), rgba(60, 30, 120, 0.08), rgba(100, 60, 180, 0.18), rgba(40, 20, 80, 0.05), rgba(140, 80, 220, 0.25))" }}
                >
                  <Avatar className="w-9 h-9 border-[2px] border-background">
                    <AvatarImage src={profile?.picture} alt="You" />
                    <AvatarFallback className="text-xs bg-muted text-muted-foreground">
                      {(profile?.display_name || profile?.name || "?").slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <div className="flex-1 min-w-0 flex flex-col min-h-0 h-full">
                  <MentionHighlightTextarea
                    ref={textareaRef}
                    placeholder={isPollMode ? "Ask your question..." : "What's on your mind?"}
                    className="min-h-[120px] w-full bg-transparent border-0 shadow-none outline-none resize-none focus-visible:ring-0 focus-visible:ring-offset-0 text-base sm:text-[15px] leading-relaxed p-0 placeholder:text-muted-foreground/50"
                    value={content}
                    onChange={handleComposeTextChange}
                    emojiMap={composeEmojiMap}
                    autoFocus
                    autoComplete="off"
                    data-testid="input-post-content"
                  />
                  {pictureEligible && (
                    <div className="mt-3 space-y-2" data-testid="container-picture-post">
                      <button
                        type="button"
                        onClick={() => setPostAsPicture((v) => !v)}
                        aria-pressed={isPictureMode}
                        className={`flex items-center gap-1.5 px-3 h-9 rounded-full border text-[11px] font-medium transition-colors ${
                          isPictureMode
                            ? "bg-accent text-brand border-brand/40 dark:bg-brand/15 dark:border-brand/40"
                            : "border-border/40 text-muted-foreground/70 hover:text-foreground hover:border-border"
                        }`}
                        title="Publish as a picture-first post (NIP-68)"
                        data-testid="button-toggle-picture-post"
                      >
                        <Images className="w-3.5 h-3.5" />
                        Post as picture
                        {isPictureMode && <span className="text-[9px] uppercase tracking-wide opacity-70">on</span>}
                      </button>
                      {isPictureMode && (
                        <div className="rounded-lg border border-border dark:border-brand/20 bg-accent/40 dark:bg-brand/[0.03] p-2.5 space-y-1.5">
                          <input
                            type="text"
                            value={pictureTitle}
                            onChange={(e) => setPictureTitle(e.target.value)}
                            placeholder="Title (optional)"
                            className="w-full bg-transparent border-0 outline-none text-sm font-medium text-foreground/80 placeholder:text-muted-foreground/40 p-0"
                            style={{ fontSize: 16 }}
                            maxLength={120}
                            data-testid="input-picture-title"
                          />
                          <p className="text-[10px] leading-relaxed text-muted-foreground/60">
                            Publishes as a picture post (kind 20) — native in photo apps like Olas and Amethyst. Text-only clients may not show it.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {mediaAttachments.length > 0 && (
                    <div className="flex gap-2 mt-3 overflow-x-auto pb-1" data-testid="container-media-previews">
                      {mediaAttachments.map((media) => (
                        <div key={media.id} className="relative group/media rounded-lg overflow-hidden bg-accent/40 border border-border dark:bg-brand/[0.06] dark:border-brand/15 shrink-0 cursor-pointer" data-testid={`media-preview-${media.id}`} onClick={() => setPreviewMedia(media)}>
                          {media.type === "image" ? (
                            <img src={media.url} alt="Attachment" className="w-24 h-24 sm:w-28 sm:h-28 object-cover" />
                          ) : (
                            <div className="relative w-24 h-24 sm:w-28 sm:h-28">
                              <video src={media.url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">
                                  <Film className="w-4 h-4 text-white" />
                                </div>
                              </div>
                            </div>
                          )}
                          {media.metadataStripped && (
                            <div className="absolute bottom-1 left-1">
                              <ShieldCheck className="w-3.5 h-3.5 text-green-800 dark:text-green-400 drop-shadow-md" />
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeMediaAttachment(media.id); }}
                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center text-white sm:opacity-0 sm:group-hover/media:opacity-100 transition-opacity"
                            data-testid={`button-remove-media-${media.id}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {gifUrl && (
                    <div className="relative mt-3 w-fit rounded-lg overflow-hidden bg-accent/40 border border-border dark:bg-brand/[0.06] dark:border-brand/15">
                      <img src={gifUrl} alt="GIF" className="max-w-[200px] max-h-[160px] object-cover block" />
                      <button
                        type="button"
                        onClick={() => setGifUrl(null)}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80 transition-colors cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  {isPollMode && (
                    <div className="mt-3 space-y-2 rounded-lg border border-border dark:border-brand/20 bg-accent/40 dark:bg-brand/[0.03] p-3" data-testid="container-poll-options">
                      <div className="flex items-center gap-1.5 mb-2">
                        <BarChart3 className="w-3.5 h-3.5 text-brand/60" />
                        <span className="text-[11px] font-medium text-brand/80 uppercase tracking-wider">Poll Options</span>
                      </div>
                      {pollOptions.map((opt, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-[11px] text-muted-foreground/40 w-4 text-center shrink-0">{i + 1}</span>
                          <input
                            type="text"
                            value={opt}
                            onChange={(e) => {
                              const next = [...pollOptions];
                              next[i] = e.target.value;
                              setPollOptions(next);
                            }}
                            placeholder={`Option ${i + 1}`}
                            className="flex-1 bg-transparent border border-border/30 rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-brand/40 placeholder:text-muted-foreground/30 transition-colors"
                            style={{ fontSize: 16 }}
                            maxLength={80}
                            data-testid={`input-poll-option-${i}`}
                          />
                          {pollOptions.length > 2 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="w-7 h-7 text-muted-foreground/40 hover:text-destructive shrink-0"
                              onClick={() => setPollOptions(prev => prev.filter((_, j) => j !== i))}
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      ))}
                      {pollOptions.length < 10 && (
                        <button
                          type="button"
                          onClick={() => setPollOptions(prev => [...prev, ""])}
                          className="flex items-center gap-1.5 text-[11px] text-brand/60 hover:text-brand transition-colors py-1"
                          data-testid="button-add-poll-option"
                        >
                          <Plus className="w-3 h-3" />
                          Add option
                        </button>
                      )}
                      <div className="flex items-center gap-2 pt-1 border-t border-border/15 mt-2">
                        <span className="text-[11px] text-muted-foreground/50">Closes:</span>
                        <select
                          value={pollExpiration}
                          onChange={(e) => setPollExpiration(e.target.value)}
                          className="bg-transparent border border-border/30 rounded-md px-2 py-1 text-xs text-foreground/70 outline-none focus:border-brand/40 cursor-pointer"
                          data-testid="select-poll-expiration"
                        >
                          <option value="1h">1 hour</option>
                          <option value="6h">6 hours</option>
                          <option value="1d">1 day</option>
                          <option value="3d">3 days</option>
                          <option value="7d">7 days</option>
                        </select>
                      </div>
                    </div>
                  )}
                  {previewMedia && (
                    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" data-testid="overlay-media-preview" onClick={() => setPreviewMedia(null)} onKeyDown={(e) => { if (e.key === "Escape") setPreviewMedia(null); }} tabIndex={-1} ref={(el) => el?.focus()}>
                      <div className="absolute inset-0 bg-black/80" />
                      <div className="relative max-w-lg w-full max-h-[80vh] z-10" onClick={(e) => e.stopPropagation()}>
                        {previewMedia.type === "image" ? (
                          <img src={previewMedia.url} alt="Preview" className="w-full max-h-[80vh] object-contain rounded-xl" />
                        ) : (
                          <video src={previewMedia.url} controls autoPlay className="w-full max-h-[80vh] rounded-xl" playsInline />
                        )}
                        <button
                          type="button"
                          onClick={() => setPreviewMedia(null)}
                          className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-black/70 border border-white/20 flex items-center justify-center text-white"
                          data-testid="button-close-media-preview"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeMediaAttachment(previewMedia.id)}
                          className="absolute -bottom-3 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-red-500/90 text-white text-xs font-medium flex items-center gap-1.5"
                          data-testid="button-remove-from-preview"
                        >
                          <X className="w-3 h-3" /> Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className={`relative z-10 shrink-0 border-t border-border/30 ${isMobile ? "" : "rounded-b-xl"}`} style={{ paddingBottom: isMobile ? "env(safe-area-inset-bottom, 0px)" : undefined }}>
              <div className="flex items-center gap-0.5 px-3 py-1.5 overflow-x-auto scrollbar-hide">
                <ComposeEmojiPicker
                  onInsert={handleEmojiInsert}
                  onGifSelect={(url) => setGifUrl(url)}
                  disabled={isUploading}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-brand/70 shrink-0 h-9 w-9"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isUploading}
                  data-testid="button-attach-image"
                  title="Add image"
                  aria-label="Add image"
                >
                  {isUploading ? <RelayOutpostInlineLoader className="w-[18px] h-[18px]" /> : <ImagePlus className="w-[18px] h-[18px]" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-brand/70 shrink-0 h-9 w-9"
                  onClick={() => videoInputRef.current?.click()}
                  disabled={isUploading}
                  data-testid="button-attach-video"
                  title="Add video"
                  aria-label="Add video"
                >
                  <Film className="w-[18px] h-[18px]" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-brand/70 shrink-0 h-9 w-9 hover:text-brand"
                  onClick={() => audioInputRef.current?.click()}
                  disabled={isUploading}
                  data-testid="button-attach-audio"
                  title="Share a song or audio"
                  aria-label="Share a song or audio"
                >
                  <Music className="w-[18px] h-[18px]" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground/60 shrink-0 h-9 w-9"
                  onClick={handleArticleNav}
                  data-testid="button-tab-article"
                >
                  <FileText className="w-[18px] h-[18px]" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`shrink-0 h-9 w-9 transition-colors ${isPollMode ? "text-brand bg-accent dark:text-brand dark:bg-brand/10" : "text-brand/70 hover:text-brand"}`}
                  onClick={() => setIsPollMode(v => !v)}
                  data-testid="button-toggle-poll"
                  title="Create a poll"
                >
                  <BarChart3 className="w-[18px] h-[18px]" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`shrink-0 h-9 w-9 transition-colors ${showShieldInfo ? "text-green-500" : "text-green-500/50 hover:text-green-500/80"}`}
                  onClick={() => setShowShieldInfo((v) => !v)}
                  data-testid="button-privacy-info"
                >
                  <ShieldCheck className="w-[16px] h-[16px]" />
                </Button>

                <div className="flex-1" />

                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 h-9 w-9 text-muted-foreground/60 hover:text-muted-foreground"
                  onClick={handleSaveDraft}
                  disabled={!hasAnyContent}
                  title="Save draft"
                >
                  <Archive className="w-[18px] h-[18px]" />
                </Button>
                {draftCount > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 h-9 w-9 text-brand/70 hover:text-brand relative"
                    onClick={() => { setShowDrafts(!showDrafts); setDraftCount(getDraftCount()); }}
                    title={`Drafts (${draftCount})`}
                  >
                    <RotateCcw className="w-[18px] h-[18px]" />
                    <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary text-[8px] text-primary-foreground dark:bg-brand dark:text-white flex items-center justify-center font-medium">{draftCount}</span>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <Button
        onClick={() => {
          if (outpostCompose) {
            if (outpostCompose.activeTab === "horizon") {
              if (outpostCompose.canPostHorizon) {
                window.dispatchEvent(new CustomEvent("horizon-new-entry"));
              }
              return;
            }
            outpostCompose.triggerCompose(outpostCompose.activeTab === "topics" ? "topic" : "note");
            return;
          }
          setDraftCount(getDraftCount());
          setIsOpen(true);
        }}
        size="icon"
        className={`fixed z-40 rounded-full bg-foreground text-background shadow-lg hidden md:flex transition-all duration-300 ${
          outpostCompose?.activeTab === "horizon" && !outpostCompose?.canPostHorizon ? "opacity-0 pointer-events-none" : ""
        }`}
        style={{ bottom: "1.5rem", right: "1.5rem" }}
        data-testid="button-fab-compose"
      >
        <RelayOutpostIcon className="w-5 h-5" />
      </Button>

      <RelayPublishPicker
        open={showRelayPicker}
        onOpenChange={setShowRelayPicker}
        onPreferenceChange={setRelayPref}
      />
    </>
  );
}
