import { useState, useEffect, useCallback, useRef, useMemo } from "react";
// This console renders OUTSIDE NeedsYouProvider, which is precisely why the
// signal is a window event and not a context call.
import { notifyNeedsYouChanged } from "@/contexts/NeedsYouContext";
import type { Event as NostrEvent } from "nostr-tools";
import { pool } from "@/lib/nostr";
import { withSignerTimeout, SIGNER_SIGN_TIMEOUT } from "@/lib/signer-timeout";
import { buildFeaturedEventTemplate, parseFeaturedDoc, setDocAnnouncement, featuredDTag, refToFeaturedItem, featuredItemKey, kindLabel, MAX_FEATURED_ITEMS, type FeaturedItem } from "@/lib/featured";
import { type Nip11Document } from "@/lib/nip11";
import {
  mayHostNip29,
  fetchGroupMetadataResult,
  fetchGroupAdminsResult,
  fetchGroupMembersResult,
  fetchGroupRoles,
  fetchModerationLog,
  fetchGroupMembershipHistory,
  deriveGroupId,
  sendCreateGroup,
  sendDeleteGroup,
  sendCreateInvite,
  sendPutUser,
  sendRemoveUser,
  sendDeleteEvent,
  sendEditMetadata,
  getModerationActionName,
  KIND_GROUP_REMOVE_USER,
  type GroupMetadata,
  type GroupAdmin,
  type GroupRole,
} from "@/lib/nip29";
import {
  changeRelayName,
  changeRelayDescription,
  changeRelayIcon,
  changeRelayBanner,
  changeRelayModerators,
  banEvent,
} from "@/lib/nip86";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { OpsCard, OpsSubCard, OpsSectionHeader } from "./ops-ui";
import { AddMemberSheet } from "@/components/AddMemberSheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import {
  Activity,
  Shield,
  Lock,
  Unlock,
  Hash,
  Code,
  Check,
  Trash2,
  Plus,
  Upload,
  ScrollText,
  User,
  Users,
  Image,
  Bookmark,
  BarChart3,
  Newspaper,
  UserMinus,
  UserPlus,
  Key,
  Megaphone,
  Pin,
} from "lucide-react";
import { uploadMedia } from "@/lib/media-upload";
import { formatDistanceToNow } from "date-fns";
import {
  npubToHex,
  ProfileInfo,
  ProfileName,
  ChartTooltip,
  timeAgo,
  resolveProfileBatch,
  UserListToolbar,
  useUrlListControls,
  useDateAdded,
  useActivityProbe,
  applyUserListControls,
  recordDateAdded,
  recordDateAddedMany,
  recordDateAddedHistorical,
  removeDateAdded,
  formatRelativeMs,
  formatRelativeSec,
} from "./shared";

const KIND_TOPIC = 11;
const KIND_COMMENT = 1111;
const KIND_APP_DATA = 30078;
const PINNED_TOPICS_D_TAG = "relay-outpost/pinned-topics";
const COMMUNITY_RULES_D_TAG = "relay-outpost/community-rules";
const MODERATORS_D_TAG = "relay-outpost/moderators";
const HORIZON_CONFIG_D_TAG = "relay-outpost/horizon-config";
const APP_DATA_RELAYS = ["wss://purplepag.es", "wss://relay.damus.io", "wss://nos.lol"];

export function CommunityTab({ relayUrl, nip11 }: { relayUrl: string; nip11: Nip11Document | null }) {
  const { pubkey, signer } = useNostrAuth();
  const { toast } = useToast();

  const [brandName, setBrandName] = useState(nip11?.name || "");
  const [brandDesc, setBrandDesc] = useState(nip11?.description || "");
  const [brandIcon, setBrandIcon] = useState(nip11?.icon || "");
  const [brandBanner, setBrandBanner] = useState(nip11?.banner || "");
  const [savedIcon, setSavedIcon] = useState(nip11?.icon || "");
  const [savedBanner, setSavedBanner] = useState(nip11?.banner || "");
  const [savingBrand, setSavingBrand] = useState<string | null>(null);
  const iconDirty = brandIcon !== savedIcon;
  const bannerDirty = brandBanner !== savedBanner;
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [iconUploadStatus, setIconUploadStatus] = useState<string | null>(null);
  const [bannerUploadStatus, setBannerUploadStatus] = useState<string | null>(null);
  const iconFileRef = useRef<HTMLInputElement>(null);
  const bannerFileRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = useCallback(async (file: File, target: "icon" | "banner") => {
    const setUploading = target === "icon" ? setUploadingIcon : setUploadingBanner;
    const setStatus = target === "icon" ? setIconUploadStatus : setBannerUploadStatus;
    const setValue = target === "icon" ? setBrandIcon : setBrandBanner;
    setUploading(true);
    setStatus("Preparing...");
    try {
      const result = await uploadMedia(file, (status) => setStatus(status), signer);
      setValue(result.url);
      setStatus(null);
      toast({ title: `${target === "icon" ? "Icon" : "Banner"} uploaded`, description: "Click Save to apply." });
    } catch (err) {
      setStatus(null);
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Could not upload image.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [signer, toast]);

  const [rulesText, setRulesText] = useState("");
  const [rulesLoading, setRulesLoading] = useState(true);
  const [savingRules, setSavingRules] = useState(false);

  // Featured: operator-curated announcement + pinned items shown atop the Timeline.
  const [announcementText, setAnnouncementText] = useState("");
  const [featuredItems, setFeaturedItems] = useState<FeaturedItem[]>([]);
  const [featuredRefInput, setFeaturedRefInput] = useState("");
  const [savingFeatured, setSavingFeatured] = useState(false);

  const [modInput, setModInput] = useState("");
  const [moderators, setModerators] = useState<string[]>(nip11?.moderators || []);
  const [modProfiles, setModProfiles] = useState<Map<string, ProfileInfo>>(new Map());

  const [pinnedTopicIds, setPinnedTopicIds] = useState<string[]>([]);
  const [topics, setTopics] = useState<NostrEvent[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [pinningId, setPinningId] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<{
    totalTopics: number;
    totalComments: number;
    activeMembers: number;
    recentActivity: { date: string; topics: number; comments: number }[];
  } | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);

  const [horizonAdminOnly, setHorizonAdminOnly] = useState<boolean | null>(null);
  const [horizonConfigLoaded, setHorizonConfigLoaded] = useState(false);
  const [savingHorizonConfig, setSavingHorizonConfig] = useState(false);

  useEffect(() => {
    if (nip11) {
      setBrandName(nip11.name || "");
      setBrandDesc(nip11.description || "");
      setBrandIcon(nip11.icon || "");
      setBrandBanner(nip11.banner || "");
      setSavedIcon(nip11.icon || "");
      setSavedBanner(nip11.banner || "");
      setModerators(nip11.moderators || []);
    }
  }, [nip11]);

  useEffect(() => {
    if (moderators.length > 0) {
      resolveProfileBatch(moderators).then(setModProfiles);
    }
  }, [moderators]);

  const modControls = useUrlListControls("comm-moderators");
  const modAddedAt = useDateAdded(relayUrl, "moderators", moderators);
  const modActivity = useActivityProbe(relayUrl, "moderators", moderators);
  const modProfileCache = useMemo(() => {
    const obj: Record<string, ProfileInfo> = {};
    modProfiles.forEach((v, k) => { obj[k] = v; });
    return obj;
  }, [modProfiles]);
  const modFiltered = useMemo(() => applyUserListControls({
    list: moderators,
    controls: modControls.controls,
    profileCache: modProfileCache,
    addedAt: modAddedAt,
    lastActive: modActivity.lastActive,
  }), [moderators, modControls.controls, modProfileCache, modAddedAt, modActivity.lastActive]);

  useEffect(() => {
    if (!pubkey) return;
    setRulesLoading(true);
    const sub = pool.subscribeMany(
      APP_DATA_RELAYS,
      { kinds: [KIND_APP_DATA], authors: [pubkey], "#d": [COMMUNITY_RULES_D_TAG + "/" + relayUrl], limit: 1 },
      {
        onevent(e: NostrEvent) {
          try {
            const data = JSON.parse(e.content);
            if (data.rules) setRulesText(data.rules);
          } catch {
            setRulesText(e.content);
          }
        },
        oneose() {
          sub.close();
          clearTimeout(timer);
          setRulesLoading(false);
        },
      },
    );
    const timer = setTimeout(() => { sub.close(); setRulesLoading(false); }, 6000);
    return () => { sub.close(); clearTimeout(timer); };
  }, [pubkey, relayUrl]);

  // Load the existing Featured doc so the operator edits in place.
  useEffect(() => {
    if (!pubkey) return;
    const sub = pool.subscribeMany(
      APP_DATA_RELAYS,
      { kinds: [KIND_APP_DATA], authors: [pubkey], "#d": [featuredDTag(relayUrl)], limit: 1 },
      {
        onevent(e: NostrEvent) {
          const parsed = parseFeaturedDoc(e.content, relayUrl);
          setAnnouncementText(parsed.announcement?.text || "");
          setFeaturedItems(parsed.items);
        },
        oneose() { sub.close(); clearTimeout(timer); },
      },
    );
    const timer = setTimeout(() => { sub.close(); }, 6000);
    return () => { sub.close(); clearTimeout(timer); };
  }, [pubkey, relayUrl]);

  useEffect(() => {
    if (!pubkey) return;
    const sub = pool.subscribeMany(
      APP_DATA_RELAYS,
      { kinds: [KIND_APP_DATA], authors: [pubkey], "#d": [MODERATORS_D_TAG + "/" + relayUrl], limit: 1 },
      {
        onevent(e: NostrEvent) {
          try {
            const data = JSON.parse(e.content);
            if (Array.isArray(data.moderators) && data.moderators.length > 0) {
              setModerators(prev => {
                const merged = new Set([...prev, ...data.moderators]);
                return Array.from(merged);
              });
            }
          } catch {}
        },
        oneose() { sub.close(); clearTimeout(timer); },
      },
    );
    const timer = setTimeout(() => { sub.close(); }, 6000);
    return () => { sub.close(); clearTimeout(timer); };
  }, [pubkey, relayUrl]);

  useEffect(() => {
    if (!pubkey) { setHorizonAdminOnly(null); setHorizonConfigLoaded(true); return; }
    setHorizonAdminOnly(null);
    setHorizonConfigLoaded(false);
    const hSub = pool.subscribeMany(
      APP_DATA_RELAYS,
      { kinds: [KIND_APP_DATA], authors: [pubkey], "#d": [HORIZON_CONFIG_D_TAG + "/" + relayUrl], limit: 1 },
      {
        onevent(e: NostrEvent) {
          try {
            const data = JSON.parse(e.content);
            if (typeof data.horizonAdminOnly === "boolean") setHorizonAdminOnly(data.horizonAdminOnly);
          } catch {}
        },
        oneose() { hSub.close(); clearTimeout(hTimer); setHorizonConfigLoaded(true); },
      },
    );
    const hTimer = setTimeout(() => { hSub.close(); setHorizonConfigLoaded(true); }, 6000);
    return () => { hSub.close(); clearTimeout(hTimer); };
  }, [pubkey, relayUrl]);

  const effectiveHorizonAdminOnly = horizonAdminOnly ?? false;

  const handleToggleHorizonAdmin = async () => {
    if (!pubkey) return;
    const newValue = !effectiveHorizonAdminOnly;
    setSavingHorizonConfig(true);
    try {
      const eventTemplate = {
        kind: KIND_APP_DATA,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["d", HORIZON_CONFIG_D_TAG + "/" + relayUrl]],
        content: JSON.stringify({ horizonAdminOnly: newValue, relay: relayUrl }),
      };
      const signed = await withSignerTimeout((window as any).nostr?.signEvent(eventTemplate), SIGNER_SIGN_TIMEOUT, "signEvent");
      if (signed) {
        const { publishEvent } = await import("@/lib/nostr");
        await publishEvent(signed, APP_DATA_RELAYS);
        setHorizonAdminOnly(newValue);
        toast({ title: newValue ? "Articles restricted to admins" : "Articles open to all members" });
      }
    } catch {
      toast({ title: "Failed to update Articles setting", variant: "destructive" });
    }
    setSavingHorizonConfig(false);
  };

  useEffect(() => {
    if (!pubkey) return;
    const sub = pool.subscribeMany(
      APP_DATA_RELAYS,
      { kinds: [KIND_APP_DATA], authors: [pubkey], "#d": [PINNED_TOPICS_D_TAG + "/" + relayUrl], limit: 1 },
      {
        onevent(e: NostrEvent) {
          try {
            const data = JSON.parse(e.content);
            if (Array.isArray(data.pinnedIds)) setPinnedTopicIds(data.pinnedIds);
          } catch {}
        },
        oneose() { sub.close(); clearTimeout(timer); },
      },
    );
    const timer = setTimeout(() => { sub.close(); }, 6000);
    return () => { sub.close(); clearTimeout(timer); };
  }, [pubkey, relayUrl]);

  useEffect(() => {
    setTopicsLoading(true);
    const topicMap = new Map<string, NostrEvent>();
    const sub = pool.subscribeMany(
      [relayUrl],
      { kinds: [KIND_TOPIC], limit: 50 },
      {
        onevent(e: NostrEvent) {
          if (!topicMap.has(e.id)) {
            topicMap.set(e.id, e);
          }
        },
        oneose() {
          sub.close();
          clearTimeout(timer);
          setTopics(Array.from(topicMap.values()).sort((a, b) => b.created_at - a.created_at));
          setTopicsLoading(false);
        },
      },
    );
    const timer = setTimeout(() => {
      sub.close();
      setTopics(Array.from(topicMap.values()).sort((a, b) => b.created_at - a.created_at));
      setTopicsLoading(false);
    }, 8000);
    return () => { sub.close(); clearTimeout(timer); };
  }, [relayUrl]);

  useEffect(() => {
    setMetricsLoading(true);
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = now - 7 * 86400;
    const memberSet = new Set<string>();
    let topicCount = 0;
    let commentCount = 0;
    const dailyMap = new Map<string, { topics: number; comments: number }>();

    for (let i = 0; i < 7; i++) {
      const d = new Date((sevenDaysAgo + i * 86400) * 1000);
      dailyMap.set(d.toISOString().split("T")[0], { topics: 0, comments: 0 });
    }

    const sub = pool.subscribeMany(
      [relayUrl],
      { kinds: [KIND_TOPIC, KIND_COMMENT, 1], since: sevenDaysAgo, limit: 500 },
      {
        onevent(e: NostrEvent) {
          memberSet.add(e.pubkey);
          const day = new Date(e.created_at * 1000).toISOString().split("T")[0];
          const entry = dailyMap.get(day);
          if (e.kind === KIND_TOPIC) {
            topicCount++;
            if (entry) entry.topics++;
          } else if (e.kind === KIND_COMMENT) {
            commentCount++;
            if (entry) entry.comments++;
          }
        },
        oneose() {
          sub.close();
          clearTimeout(timer);
          setMetrics({
            totalTopics: topicCount,
            totalComments: commentCount,
            activeMembers: memberSet.size,
            recentActivity: Array.from(dailyMap.entries()).map(([date, v]) => ({ date, ...v })),
          });
          setMetricsLoading(false);
        },
      },
    );
    const timer = setTimeout(() => {
      sub.close();
      setMetrics({
        totalTopics: topicCount,
        totalComments: commentCount,
        activeMembers: memberSet.size,
        recentActivity: Array.from(dailyMap.entries()).map(([date, v]) => ({ date, ...v })),
      });
      setMetricsLoading(false);
    }, 10000);
    return () => { sub.close(); clearTimeout(timer); };
  }, [relayUrl]);

  const handleSaveBrand = async (field: "name" | "description" | "icon" | "banner") => {
    setSavingBrand(field);
    let res;
    switch (field) {
      case "name": res = await changeRelayName(relayUrl, brandName); break;
      case "description": res = await changeRelayDescription(relayUrl, brandDesc); break;
      case "icon": res = await changeRelayIcon(relayUrl, brandIcon); break;
      case "banner": res = await changeRelayBanner(relayUrl, brandBanner); break;
    }
    if (res.error) {
      toast({ title: `Failed to update ${field}`, description: res.error, variant: "destructive" });
    } else {
      if (field === "icon") setSavedIcon(brandIcon);
      if (field === "banner") setSavedBanner(brandBanner);
      toast({ title: `${field.charAt(0).toUpperCase() + field.slice(1)} updated` });
    }
    setSavingBrand(null);
  };

  const handleSaveRules = async () => {
    if (!pubkey) return;
    setSavingRules(true);
    try {
      const eventTemplate = {
        kind: KIND_APP_DATA,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["d", COMMUNITY_RULES_D_TAG + "/" + relayUrl]],
        content: JSON.stringify({ rules: rulesText, relay: relayUrl }),
      };
      const signed = await withSignerTimeout((window as any).nostr?.signEvent(eventTemplate), SIGNER_SIGN_TIMEOUT, "signEvent");
      if (signed) {
        const { publishEvent } = await import("@/lib/nostr");
        await publishEvent(signed, APP_DATA_RELAYS);
        toast({ title: "Community rules saved" });
      }
    } catch {
      toast({ title: "Failed to save rules", variant: "destructive" });
    }
    setSavingRules(false);
  };

  const handleAddFeaturedRef = () => {
    const item = refToFeaturedItem(featuredRefInput);
    if (!item) {
      toast({ title: "Couldn't read that reference", description: "Paste a note, nevent, or naddr link.", variant: "destructive" });
      return;
    }
    if (featuredItems.length >= MAX_FEATURED_ITEMS) {
      toast({ title: `Up to ${MAX_FEATURED_ITEMS} pinned items`, variant: "destructive" });
      return;
    }
    const key = featuredItemKey(item);
    if (featuredItems.some((i) => featuredItemKey(i) === key)) {
      toast({ title: "Already pinned" });
      setFeaturedRefInput("");
      return;
    }
    setFeaturedItems((prev) => [...prev, item]);
    setFeaturedRefInput("");
  };

  const handleRemoveFeatured = (key: string) => {
    setFeaturedItems((prev) => prev.filter((i) => featuredItemKey(i) !== key));
  };

  const handleSaveFeatured = async () => {
    if (!pubkey) return;
    setSavingFeatured(true);
    try {
      // Shared write path with the Announce outbox (lib/featured): set/clear the
      // announcement while preserving pinned items, then build the kind-30078 event.
      const template = buildFeaturedEventTemplate(
        setDocAnnouncement({ items: featuredItems }, announcementText.trim() ? { text: announcementText } : null, relayUrl),
        relayUrl,
      );
      const signed = await withSignerTimeout((window as any).nostr?.signEvent(template), SIGNER_SIGN_TIMEOUT, "signEvent");
      if (signed) {
        const { publishEvent } = await import("@/lib/nostr");
        await publishEvent(signed, APP_DATA_RELAYS);
        toast({ title: "Featured updated", description: "Members will see it atop the Timeline." });
      }
    } catch {
      toast({ title: "Failed to save Featured", variant: "destructive" });
    }
    setSavingFeatured(false);
  };

  const handleTogglePin = async (topicId: string) => {
    if (!pubkey) return;
    setPinningId(topicId);
    const isPinned = pinnedTopicIds.includes(topicId);
    const newIds = isPinned
      ? pinnedTopicIds.filter(id => id !== topicId)
      : [...pinnedTopicIds, topicId];
    setPinnedTopicIds(newIds);

    try {
      const eventTemplate = {
        kind: KIND_APP_DATA,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["d", PINNED_TOPICS_D_TAG + "/" + relayUrl]],
        content: JSON.stringify({ pinnedIds: newIds, relay: relayUrl }),
      };
      const signed = await withSignerTimeout((window as any).nostr?.signEvent(eventTemplate), SIGNER_SIGN_TIMEOUT, "signEvent");
      if (signed) {
        const { publishEvent } = await import("@/lib/nostr");
        await publishEvent(signed, APP_DATA_RELAYS);
        toast({ title: isPinned ? "Topic unpinned" : "Topic pinned" });
      }
    } catch {
      toast({ title: "Failed to update pin", variant: "destructive" });
      setPinnedTopicIds(isPinned ? [...newIds, topicId] : newIds.filter(id => id !== topicId));
    }
    setPinningId(null);
  };

  const saveModerators = async (newList: string[]) => {
    if (!pubkey) return;
    changeRelayModerators(relayUrl, newList).then(res => {
      if (res.result) toast({ title: "Relay moderators updated" });
    }).catch(() => {});
    try {
      const eventTemplate = {
        kind: KIND_APP_DATA,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["d", MODERATORS_D_TAG + "/" + relayUrl]],
        content: JSON.stringify({ moderators: newList, relay: relayUrl }),
      };
      const signed = await withSignerTimeout((window as any).nostr?.signEvent(eventTemplate), SIGNER_SIGN_TIMEOUT, "signEvent");
      if (signed) {
        const { publishEvent } = await import("@/lib/nostr");
        await publishEvent(signed, APP_DATA_RELAYS);
      }
    } catch {}
  };

  const handleAddMod = () => {
    const hex = npubToHex(modInput);
    if (!hex) {
      toast({ title: "Invalid pubkey or npub", variant: "destructive" });
      return;
    }
    if (moderators.includes(hex)) {
      toast({ title: "Already a moderator" });
      return;
    }
    const newList = [...moderators, hex];
    setModerators(newList);
    setModInput("");
    saveModerators(newList);
    recordDateAdded(relayUrl, "moderators", hex);
    toast({ title: "Moderator added" });
  };

  const handleRemoveMod = (pk: string) => {
    const newList = moderators.filter(m => m !== pk);
    setModerators(newList);
    saveModerators(newList);
    removeDateAdded(relayUrl, "moderators", pk);
    toast({ title: "Moderator removed" });
  };

  const handleRemoveTopic = async (eventId: string) => {
    const res = await banEvent(relayUrl, eventId, "Removed by operator");
    if (res.error) {
      toast({ title: "Failed to remove", description: res.error, variant: "destructive" });
    } else {
      setTopics(prev => prev.filter(t => t.id !== eventId));
      toast({ title: "Topic removed from relay" });
    }
  };

  return (
    <div className="space-y-6">
      <OpsCard className="space-y-4">
        <OpsSectionHeader icon={Image} label="Community Branding" className="mb-0" />

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Name</label>
            <div className="flex gap-2">
              <Input
                value={brandName}
                onChange={e => setBrandName(e.target.value)}
                placeholder="Relay name"
                className="h-8 text-xs flex-1"
              />
              <Button size="sm" onClick={() => handleSaveBrand("name")} disabled={savingBrand === "name"} className="h-8 text-xs px-3">
                {savingBrand === "name" ? <RelayOutpostInlineLoader className="w-3 h-3" /> : "Save"}
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Description</label>
            <div className="flex gap-2">
              <Textarea
                value={brandDesc}
                onChange={e => setBrandDesc(e.target.value)}
                placeholder="Community description"
                className="text-xs min-h-[60px] flex-1"
              />
              <Button size="sm" onClick={() => handleSaveBrand("description")} disabled={savingBrand === "description"} className="h-8 text-xs px-3 self-end">
                {savingBrand === "description" ? <RelayOutpostInlineLoader className="w-3 h-3" /> : "Save"}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider font-brand">Icon</label>
            <input
              ref={iconFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleImageUpload(file, "icon");
                e.target.value = "";
              }}
            />
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => iconFileRef.current?.click()}
                  disabled={uploadingIcon}
                  className="relative w-16 h-16 rounded-full border border-border bg-muted dark:bg-white/[0.03] overflow-hidden hover:border-primary/50 transition-colors group disabled:opacity-50"
                  title={brandIcon ? "Click to replace icon" : "Click to upload icon"}
                  aria-label={brandIcon ? "Replace relay icon" : "Upload relay icon"}
                  data-testid="button-upload-icon-tile"
                >
                  {brandIcon ? (
                    <img src={brandIcon} alt="Icon preview" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground/40">
                      <Image className="w-5 h-5" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    {uploadingIcon ? (
                      <RelayOutpostInlineLoader className="w-4 h-4 text-white" />
                    ) : (
                      <Upload className="w-4 h-4 text-white" />
                    )}
                  </div>
                  {/* Always-visible tap signifier (hover overlay above is desktop polish only). */}
                  <span aria-hidden="true" className="absolute bottom-0 right-0 flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground shadow ring-2 ring-background pointer-events-none transition-opacity sm:group-hover:opacity-0">
                    <Upload className="w-2.5 h-2.5" />
                  </span>
                </button>
                {iconDirty && !uploadingIcon && (
                  <span
                    className="absolute -top-1 -right-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-[10px] font-mono uppercase tracking-wider text-white shadow-sm"
                    title="Unsaved changes"
                    data-testid="badge-icon-unsaved"
                  >
                    Unsaved
                  </span>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-2 flex-1 min-w-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => iconFileRef.current?.click()}
                  disabled={uploadingIcon}
                  className="h-8 text-xs justify-center"
                  data-testid="button-upload-icon"
                >
                  {uploadingIcon ? <RelayOutpostInlineLoader className="w-3 h-3 mr-1" /> : <Upload className="w-3 h-3 mr-1" />}
                  {brandIcon ? "Replace" : "Upload"}
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleSaveBrand("icon")}
                  disabled={savingBrand === "icon" || !iconDirty || uploadingIcon}
                  className="h-8 text-xs justify-center bg-primary hover:bg-primary/90 text-primary-foreground"
                  data-testid="button-save-icon"
                >
                  {savingBrand === "icon" ? <RelayOutpostInlineLoader className="w-3 h-3 mr-1" /> : <Check className="w-3 h-3 mr-1" />}
                  Save
                </Button>
                {brandIcon && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setBrandIcon("")}
                    disabled={uploadingIcon || savingBrand === "icon"}
                    className="h-8 text-xs justify-center text-red-700/80 dark:text-red-400/80 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-500/10"
                    data-testid="button-remove-icon"
                    title="Clear icon (then click Save to apply)"
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Remove
                  </Button>
                )}
              </div>
            </div>
            {uploadingIcon && iconUploadStatus && (
              <p className="text-[10px] text-brand/70 animate-pulse">{iconUploadStatus}</p>
            )}
            <p className="text-[10px] text-muted-foreground/40">Square image works best. PNG, JPG, or WebP.</p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider font-brand">Banner</label>
            <input
              ref={bannerFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleImageUpload(file, "banner");
                e.target.value = "";
              }}
            />
            <div className="relative">
              <button
                type="button"
                onClick={() => bannerFileRef.current?.click()}
                disabled={uploadingBanner}
                className="relative w-full h-24 sm:h-28 rounded-md border border-border bg-muted dark:bg-white/[0.03] overflow-hidden hover:border-primary/50 transition-colors group disabled:opacity-50"
                title={brandBanner ? "Click to replace banner" : "Click to upload banner"}
                aria-label={brandBanner ? "Replace relay banner" : "Upload relay banner"}
                data-testid="button-upload-banner-tile"
              >
                {brandBanner ? (
                  <img src={brandBanner} alt="Banner preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground/40">
                    <Image className="w-5 h-5" />
                    <span className="text-[10px] uppercase tracking-wider">No banner</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 text-white text-xs">
                  {uploadingBanner ? (
                    <RelayOutpostInlineLoader className="w-4 h-4 text-white" />
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      <span>{brandBanner ? "Replace banner" : "Upload banner"}</span>
                    </>
                  )}
                </div>
                {/* Always-visible tap signifier (hover overlay above is desktop polish only). */}
                <span aria-hidden="true" className="absolute bottom-2 right-2 flex items-center gap-1 px-2 h-6 rounded-full bg-primary text-primary-foreground text-[10px] font-medium shadow pointer-events-none transition-opacity sm:group-hover:opacity-0">
                  <Upload className="w-3 h-3" /> Edit
                </span>
              </button>
              {bannerDirty && !uploadingBanner && (
                <span
                  className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-amber-500 text-[10px] font-mono uppercase tracking-wider text-white shadow-sm"
                  title="Unsaved changes"
                  data-testid="badge-banner-unsaved"
                >
                  Unsaved
                </span>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => bannerFileRef.current?.click()}
                disabled={uploadingBanner}
                className="h-8 text-xs justify-center sm:flex-initial"
                data-testid="button-upload-banner"
              >
                {uploadingBanner ? <RelayOutpostInlineLoader className="w-3 h-3 mr-1" /> : <Upload className="w-3 h-3 mr-1" />}
                {brandBanner ? "Replace" : "Upload"}
              </Button>
              <Button
                size="sm"
                onClick={() => handleSaveBrand("banner")}
                disabled={savingBrand === "banner" || !bannerDirty || uploadingBanner}
                className="h-8 text-xs justify-center sm:flex-initial bg-primary hover:bg-primary/90 text-primary-foreground"
                data-testid="button-save-banner"
              >
                {savingBrand === "banner" ? <RelayOutpostInlineLoader className="w-3 h-3 mr-1" /> : <Check className="w-3 h-3 mr-1" />}
                Save
              </Button>
              {brandBanner && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setBrandBanner("")}
                  disabled={uploadingBanner || savingBrand === "banner"}
                  className="h-8 text-xs justify-center sm:flex-initial text-red-700/80 dark:text-red-400/80 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-500/10"
                  data-testid="button-remove-banner"
                  title="Clear banner (then click Save to apply)"
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  Remove
                </Button>
              )}
            </div>
            {uploadingBanner && bannerUploadStatus && (
              <p className="text-[10px] text-brand/70 animate-pulse">{bannerUploadStatus}</p>
            )}
            <p className="text-[10px] text-muted-foreground/40">Wide image (3:1 or wider) recommended.</p>
          </div>
        </div>
      </OpsCard>

      <OpsCard className="space-y-4">
        <OpsSectionHeader icon={ScrollText} label="Community Rules" className="mb-0" />
        {rulesLoading ? (
          <div className="flex items-center gap-2 py-4">
            <RelayOutpostInlineLoader className="w-4 h-4" />
            <span className="text-xs text-muted-foreground/50">Loading rules...</span>
          </div>
        ) : (
          <div className="space-y-2">
            <Textarea
              value={rulesText}
              onChange={e => setRulesText(e.target.value)}
              placeholder="Enter community guidelines, one per line..."
              className="text-xs min-h-[100px]"
            />
            <p className="text-[10px] text-muted-foreground/40">
              These rules appear in the Outpost sidebar for members to see.
            </p>
            <Button size="sm" onClick={handleSaveRules} disabled={savingRules} className="text-xs">
              {savingRules ? <RelayOutpostInlineLoader className="w-3 h-3 mr-1" /> : <Check className="w-3 h-3 mr-1" />}
              Save Rules
            </Button>
          </div>
        )}
      </OpsCard>

      <OpsCard className="space-y-4">
        <OpsSectionHeader icon={Megaphone} label="Featured & Announcements" className="mb-0" />
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Textarea
              value={announcementText}
              onChange={e => setAnnouncementText(e.target.value)}
              placeholder="Pin an announcement to the top of your Timeline (events, spaces, book launches…)"
              className="text-xs min-h-[70px]"
            />
            <p className="text-[10px] text-muted-foreground/40">Shown as a banner at the top of the community Timeline for every member.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/50">Pinned items</label>
            <div className="flex items-center gap-2">
              <Input
                value={featuredRefInput}
                onChange={e => setFeaturedRefInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddFeaturedRef(); } }}
                placeholder="Paste a note, nevent, or naddr link…"
                className="text-xs h-8"
              />
              <Button size="sm" variant="outline" onClick={handleAddFeaturedRef} className="text-xs h-8 shrink-0">
                <Plus className="w-3 h-3 mr-1" /> Pin
              </Button>
            </div>
            {featuredItems.length > 0 && (
              <div className="space-y-1.5">
                {featuredItems.map(it => {
                  const key = featuredItemKey(it);
                  return (
                    <div key={key} className="flex items-center gap-2 rounded-md border border-border/30 bg-background/40 px-2.5 py-1.5">
                      <Pin className="w-3 h-3 text-amber-500/70 rotate-45 shrink-0" />
                      <span className="text-[10px] font-medium uppercase tracking-wide text-amber-500/70 shrink-0">{kindLabel(it.kind)}</span>
                      <span className="text-[10px] text-muted-foreground/60 truncate flex-1 font-mono">{it.id ? it.id.slice(0, 16) + "…" : it.coord}</span>
                      <button onClick={() => handleRemoveFeatured(key)} className="text-muted-foreground/40 hover:text-red-500 transition-colors shrink-0" aria-label="Remove pin">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground/40">Up to {MAX_FEATURED_ITEMS}. Copy a link from any post, article, or event and paste it here.</p>
          </div>
          <Button size="sm" onClick={handleSaveFeatured} disabled={savingFeatured} className="text-xs">
            {savingFeatured ? <RelayOutpostInlineLoader className="w-3 h-3 mr-1" /> : <Check className="w-3 h-3 mr-1" />}
            Save Featured
          </Button>
        </div>
      </OpsCard>

      <OpsCard className="space-y-4">
        <OpsSectionHeader icon={Shield} label="Moderators" className="mb-0" />

        <div className="flex gap-2">
          <Input
            value={modInput}
            onChange={e => setModInput(e.target.value)}
            placeholder="npub or hex pubkey"
            className="h-8 text-xs flex-1"
          />
          <Button size="sm" onClick={handleAddMod} className="h-8 text-xs px-3">
            <Plus className="w-3 h-3 mr-1" /> Add
          </Button>
        </div>

        <div className="space-y-2">
          <UserListToolbar
            controls={modControls.controls}
            setQuery={modControls.setQuery}
            setSort={modControls.setSort}
            setFilter={modControls.setFilter}
            total={modFiltered.total}
            matched={modFiltered.filtered.length}
            activityStatus={modActivity.status}
            onLoadActivity={modActivity.run}
          />
          {moderators.length === 0 ? (
            <p className="text-xs text-muted-foreground/40">No moderators assigned.</p>
          ) : modFiltered.filtered.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/60 text-center py-2">No matches for the current search/filter.</p>
          ) : (
            <div className="space-y-1">
              {modFiltered.filtered.map(pk => (
                <div key={pk} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-muted dark:bg-white/[0.03]">
                  <div className="flex flex-col min-w-0 flex-1">
                    <ProfileName pubkey={pk} profiles={modProfiles} showCopy />
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 leading-tight">
                      <span title={modAddedAt[pk] ? undefined : "We only started tracking add dates from now on."}>
                        {modAddedAt[pk] ? `Added ${formatRelativeMs(modAddedAt[pk])}` : "Added —"}
                      </span>
                      <span className="text-muted-foreground/30">·</span>
                      <span>{modActivity.status === "loading" ? "Loading…" : modActivity.status === "gated" ? "Activity not loaded" : formatRelativeSec(modActivity.lastActive[pk])}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveMod(pk)}
                    className="h-6 w-6 p-0 text-red-700/70 dark:text-red-400/70 hover:text-red-700 dark:hover:text-red-400"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground/40">
          Moderator pubkeys should also be added to your relay's NIP-11 configuration for persistence.
        </p>
      </OpsCard>

      <OpsCard className="space-y-4">
        <OpsSectionHeader icon={Newspaper} label="Articles Settings" className="mb-0" />
        {!horizonConfigLoaded ? (
          <div className="flex items-center gap-2 py-2">
            <RelayOutpostInlineLoader className="w-4 h-4" />
            <span className="text-xs text-muted-foreground/50">Loading...</span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">Restrict Articles posting to admins</p>
                <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                  {effectiveHorizonAdminOnly
                    ? "Only operator and moderators can create articles. Members can read and comment."
                    : "Any signed-in member can publish articles."}
                </p>
                {horizonAdminOnly === null && (
                  <p className="text-[10px] text-muted-foreground/40 mt-0.5 italic">
                    Default: open to all members. Toggle to restrict.
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant={effectiveHorizonAdminOnly ? "default" : "outline"}
                onClick={handleToggleHorizonAdmin}
                disabled={savingHorizonConfig}
                className={`h-7 text-[10px] px-3 shrink-0 ${effectiveHorizonAdminOnly ? "bg-primary hover:bg-primary/90 text-primary-foreground" : ""}`}
              >
                {savingHorizonConfig ? (
                  <RelayOutpostInlineLoader className="w-3 h-3 mr-1" />
                ) : effectiveHorizonAdminOnly ? (
                  <Lock className="w-3 h-3 mr-1" />
                ) : (
                  <Unlock className="w-3 h-3 mr-1" />
                )}
                {effectiveHorizonAdminOnly ? "Admin Only" : "Open to All"}
              </Button>
            </div>
          </div>
        )}
      </OpsCard>

      <OpsCard className="space-y-4">
        <OpsSectionHeader icon={Bookmark} label="Topic Pinning" className="mb-0" />

        {topicsLoading ? (
          <div className="flex items-center gap-2 py-4">
            <RelayOutpostInlineLoader className="w-4 h-4" />
            <span className="text-xs text-muted-foreground/50">Loading topics...</span>
          </div>
        ) : topics.length === 0 ? (
          <p className="text-xs text-muted-foreground/40">No topics found on this relay.</p>
        ) : (
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {topics.map(topic => {
              const isPinned = pinnedTopicIds.includes(topic.id);
              const title = topic.tags.find(t => t[0] === "title")?.[1] || topic.tags.find(t => t[0] === "subject")?.[1] || topic.content.slice(0, 60) || "Untitled";
              return (
                <div key={topic.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-muted dark:bg-white/[0.03]">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {isPinned && <Bookmark className="w-3 h-3 text-amber-800 dark:text-amber-400 shrink-0 fill-amber-400" />}
                      <span className="text-xs truncate">{title}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground/40">{timeAgo(topic.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleTogglePin(topic.id)}
                      disabled={pinningId === topic.id}
                      className={`h-6 text-[10px] px-2 ${isPinned ? "text-amber-800 dark:text-amber-400" : "text-muted-foreground/50"}`}
                    >
                      {pinningId === topic.id ? (
                        <RelayOutpostInlineLoader className="w-3 h-3" />
                      ) : isPinned ? "Unpin" : "Pin"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveTopic(topic.id)}
                      className="h-6 w-6 p-0 text-red-700/60 dark:text-red-400/60 hover:text-red-700 dark:hover:text-red-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </OpsCard>

      <OpsCard className="space-y-4">
        <OpsSectionHeader icon={BarChart3} label="Community Activity (7 days)" className="mb-0" />

        {metricsLoading ? (
          <div className="flex items-center gap-2 py-4">
            <RelayOutpostInlineLoader className="w-4 h-4" />
            <span className="text-xs text-muted-foreground/50">Gathering metrics...</span>
          </div>
        ) : metrics ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <OpsSubCard className="text-center">
                <p className="text-lg font-bold text-brand">{metrics.activeMembers}</p>
                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Active Members</p>
              </OpsSubCard>
              <OpsSubCard className="text-center">
                <p className="text-lg font-bold text-brand">{metrics.totalTopics}</p>
                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Topics</p>
              </OpsSubCard>
              <OpsSubCard className="text-center">
                <p className="text-lg font-bold text-brand">{metrics.totalComments}</p>
                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Comments</p>
              </OpsSubCard>
            </div>

            {metrics.recentActivity.length > 0 && (
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={metrics.recentActivity}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(139,92,246,0.1)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "rgba(139,92,246,0.5)" }} tickFormatter={v => v.slice(5)} />
                    <YAxis tick={{ fontSize: 9, fill: "rgba(139,92,246,0.4)" }} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="topics" name="Topics" fill="#a855f7" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="comments" name="Comments" fill="#6b21a8" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/40">No activity data available.</p>
        )}
      </OpsCard>

      <CommsManagementSection relayUrl={relayUrl} nip11={nip11} />
    </div>
  );
}

function CommsManagementSection({ relayUrl, nip11 }: { relayUrl: string; nip11: Nip11Document | null }) {
  const { toast } = useToast();
  // The operator's OWN relay — an unreadable NIP-11 must not tell them their
  // relay stopped hosting groups.
  const hasNip29 = mayHostNip29(nip11?.supported_nips);
  const [groups, setGroups] = useState<GroupMetadata[]>([]);
  // null = not asked yet; false = the socket never opened, so an empty list
  // below says nothing about what this relay actually holds.
  const [groupsReached, setGroupsReached] = useState<boolean | null>(null);
  const [detailReached, setDetailReached] = useState<boolean | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupAdmins, setGroupAdmins] = useState<GroupAdmin[]>([]);
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [groupRoles, setGroupRoles] = useState<GroupRole[]>([]);
  const [modLog, setModLog] = useState<NostrEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newGroupId, setNewGroupId] = useState("");
  // Whether the operator has taken the ID field over. Until they do, it tracks
  // the name — so the field is never empty, and what they SEE is what gets sent
  // (no id quietly conjured at submit time).
  const [groupIdEdited, setGroupIdEdited] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupAbout, setNewGroupAbout] = useState("");
  const [newGroupPrivate, setNewGroupPrivate] = useState(false);
  const [newGroupClosed, setNewGroupClosed] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [showAddMemberSheet, setShowAddMemberSheet] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);
  const [deleteEventId, setDeleteEventId] = useState("");
  const [deletingEvent, setDeletingEvent] = useState(false);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [mutedUsers, setMutedUsers] = useState<string[]>([]);
  const [muteUserPubkey, setMuteUserPubkey] = useState("");
  const [mutingUser, setMutingUser] = useState(false);
  const [editRolePubkey, setEditRolePubkey] = useState("");
  const [editRoleValue, setEditRoleValue] = useState("");
  const [assigningRole, setAssigningRole] = useState(false);
  const [memberProfiles, setMemberProfiles] = useState<Record<string, ProfileInfo>>({});
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);

  const groupKey = selectedGroupId || "_";
  const adminPubkeys = useMemo(() => groupAdmins.map(a => a.pubkey), [groupAdmins]);
  const adminRolesByPk = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const a of groupAdmins) m[a.pubkey] = a.roles;
    return m;
  }, [groupAdmins]);

  const adminControls = useUrlListControls(`comm-admins-${groupKey}`);
  const memberControls = useUrlListControls(`comm-members-${groupKey}`);
  const mutedControls = useUrlListControls(`comm-muted-${groupKey}`);

  const adminAddedAt = useDateAdded(relayUrl, `admins:${groupKey}`, adminPubkeys);
  const memberAddedAt = useDateAdded(relayUrl, `members:${groupKey}`, groupMembers);
  const mutedAddedAt = useDateAdded(relayUrl, `muted:${groupKey}`, mutedUsers);

  const adminActivity = useActivityProbe(relayUrl, `admins:${groupKey}`, adminPubkeys);
  const memberActivity = useActivityProbe(relayUrl, `members:${groupKey}`, groupMembers);
  const mutedActivity = useActivityProbe(relayUrl, `muted:${groupKey}`, mutedUsers);

  useEffect(() => {
    const all = [...new Set([...adminPubkeys, ...groupMembers, ...mutedUsers])];
    if (all.length === 0) return;
    resolveProfileBatch(all).then(map => {
      const obj: Record<string, ProfileInfo> = {};
      map.forEach((v, k) => { obj[k] = v; });
      setMemberProfiles(obj);
    });
  }, [adminPubkeys, groupMembers, mutedUsers]);

  const adminFiltered = useMemo(() => applyUserListControls({
    list: adminPubkeys, controls: adminControls.controls, profileCache: memberProfiles,
    addedAt: adminAddedAt, lastActive: adminActivity.lastActive,
  }), [adminPubkeys, adminControls.controls, memberProfiles, adminAddedAt, adminActivity.lastActive]);
  const memberFiltered = useMemo(() => applyUserListControls({
    list: groupMembers, controls: memberControls.controls, profileCache: memberProfiles,
    addedAt: memberAddedAt, lastActive: memberActivity.lastActive,
  }), [groupMembers, memberControls.controls, memberProfiles, memberAddedAt, memberActivity.lastActive]);
  const mutedFiltered = useMemo(() => applyUserListControls({
    list: mutedUsers, controls: mutedControls.controls, profileCache: memberProfiles,
    addedAt: mutedAddedAt, lastActive: mutedActivity.lastActive,
  }), [mutedUsers, mutedControls.controls, memberProfiles, mutedAddedAt, mutedActivity.lastActive]);

  useEffect(() => {
    if (!hasNip29) return;
    setLoading(true);
    // The operator's OWN relay: "no groups" and "we never opened a socket" are
    // very different things to tell them, and the Create Group button sits
    // right under this list.
    fetchGroupMetadataResult(relayUrl).then(({ groups: fetched, reached }) => {
      setGroupsReached(reached);
      setGroups(fetched.sort((a, b) => {
        if (a.id === "_") return -1;
        if (b.id === "_") return 1;
        return (a.name || a.id).localeCompare(b.name || b.id);
      }));
      setLoading(false);
    });
  }, [relayUrl, hasNip29]);

  useEffect(() => {
    if (!selectedGroupId || !hasNip29) return;
    setLoadingDetail(true);
    const groupKeyForBackfill = selectedGroupId;
    let cancelled = false;
    setDetailReached(null);
    Promise.all([
      fetchGroupAdminsResult(relayUrl, selectedGroupId),
      fetchGroupMembersResult(relayUrl, selectedGroupId),
      fetchGroupRoles(relayUrl, selectedGroupId),
      fetchModerationLog(relayUrl, selectedGroupId, 30),
    ]).then(([admResult, memResult, roles, log]) => {
      if (cancelled) return;
      const adm = admResult.data;
      const mem = memResult.data;
      setDetailReached(admResult.reached && memResult.reached);
      setGroupAdmins(adm);
      setGroupMembers(mem);
      setGroupRoles(roles);
      setModLog(log);
      const removed = log
        .filter((e) => e.kind === KIND_GROUP_REMOVE_USER)
        .map((e) => e.tags.find((t) => t[0] === "p")?.[1])
        .filter((p): p is string => !!p && !mem.includes(p));
      setMutedUsers([...new Set(removed)]);
      setLoadingDetail(false);
    });
    fetchGroupMembershipHistory(relayUrl, selectedGroupId).then(({ added, removed }) => {
      if (cancelled) return;
      recordDateAddedHistorical(relayUrl, `members:${groupKeyForBackfill}`, added);
      recordDateAddedHistorical(relayUrl, `admins:${groupKeyForBackfill}`, added);
      recordDateAddedHistorical(relayUrl, `muted:${groupKeyForBackfill}`, removed);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [relayUrl, selectedGroupId, hasNip29]);

  const handleCreateGroup = async () => {
    setCreatingGroup(true);
    try {
      const { ok, error } = await sendCreateGroup(relayUrl, {
        groupId: newGroupId.trim() || undefined,
        name: newGroupName.trim() || undefined,
        about: newGroupAbout.trim() || undefined,
        isPrivate: newGroupPrivate,
        isClosed: newGroupClosed,
      });
      if (ok) {
        toast({ title: "Group creation request sent" });
        setNewGroupId("");
        setGroupIdEdited(false);
        setNewGroupName("");
        setNewGroupAbout("");
        setNewGroupPrivate(false);
        setNewGroupClosed(false);
        setShowCreateForm(false);
        setTimeout(() => {
          fetchGroupMetadataResult(relayUrl).then(({ groups: fetched, reached }) => {
            if (!reached) return;
            setGroups(fetched.sort((a, b) => {
              if (a.id === "_") return -1;
              if (b.id === "_") return 1;
              return (a.name || a.id).localeCompare(b.name || b.id);
            }));
          });
        }, 2000);
      } else {
        // The relay's own sentence, not a shrug. "To create groups open
        // https://… in your web browser" and "a group event must carry an h tag"
        // are different problems, and the operator can act on either one.
        toast({ title: "Failed to create group", description: error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error creating group", variant: "destructive" });
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleDeleteEvent = async () => {
    if (!selectedGroupId || !deleteEventId.trim()) return;
    setDeletingEvent(true);
    try {
      const { ok, error } = await sendDeleteEvent(relayUrl, selectedGroupId, deleteEventId.trim());
      if (ok) {
        toast({ title: "Delete event sent" });
        setDeleteEventId("");
        fetchModerationLog(relayUrl, selectedGroupId, 30).then(setModLog);
      } else {
        toast({ title: "Failed to delete event", description: error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setDeletingEvent(false);
    }
  };

  const handleEditMetadata = async () => {
    if (!selectedGroupId || !selectedGroup) return;
    setEditingMetadata(true);
    try {
      const { ok, error } = await sendEditMetadata(relayUrl, selectedGroupId, {
        name: selectedGroup.name,
        about: selectedGroup.about,
      });
      if (ok) {
        toast({ title: "Metadata update sent" });
        setTimeout(() => {
          fetchGroupMetadataResult(relayUrl).then(({ groups: fetched, reached }) => {
            if (!reached) return;
            setGroups(fetched.sort((a, b) => {
              if (a.id === "_") return -1;
              if (b.id === "_") return 1;
              return (a.name || a.id).localeCompare(b.name || b.id);
            }));
          });
        }, 2000);
      } else {
        toast({ title: "Failed to update metadata", description: error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setEditingMetadata(false);
    }
  };

  const handleCreateInvite = async () => {
    if (!selectedGroupId || !inviteCode.trim()) return;
    setCreatingInvite(true);
    try {
      const { ok, error } = await sendCreateInvite(relayUrl, selectedGroupId, inviteCode.trim());
      if (ok) {
        toast({ title: "Invite code created", description: `Code: ${inviteCode.trim()}` });
        setInviteCode("");
      } else {
        toast({ title: "Failed to create invite", description: error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleMemberAdded = useCallback(() => {
    if (!selectedGroupId) return;
    // Only overwrite on a real answer — a refresh that couldn't reach the
    // relay must not blank a list we already have.
    fetchGroupMembersResult(relayUrl, selectedGroupId).then((r) => { if (r.reached) setGroupMembers(r.data); });
    fetchGroupAdminsResult(relayUrl, selectedGroupId).then((r) => { if (r.reached) setGroupAdmins(r.data); });
  }, [relayUrl, selectedGroupId]);

  const handleRemoveUser = async (pubkey: string) => {
    if (!selectedGroupId) return;
    try {
      const { ok, error } = await sendRemoveUser(relayUrl, selectedGroupId, pubkey);
      if (ok) {
        notifyNeedsYouChanged();
        toast({ title: "User removed" });
        setGroupMembers((prev) => prev.filter((p) => p !== pubkey));
        setGroupAdmins((prev) => prev.filter((a) => a.pubkey !== pubkey));
        removeDateAdded(relayUrl, `members:${groupKey}`, pubkey);
        removeDateAdded(relayUrl, `admins:${groupKey}`, pubkey);
      } else {
        toast({ title: "Failed to remove user", description: error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
    setRemoveConfirm(null);
  };

  const handleMuteUser = async () => {
    if (!selectedGroupId || !muteUserPubkey.trim()) return;
    setMutingUser(true);
    try {
      const { ok, error } = await sendRemoveUser(relayUrl, selectedGroupId, muteUserPubkey.trim(), "Muted by admin");
      if (ok) {
        notifyNeedsYouChanged();
        toast({ title: "User muted (removed from group)" });
        setMutedUsers((prev) => [...new Set([...prev, muteUserPubkey.trim()])]);
        setGroupMembers((prev) => prev.filter((p) => p !== muteUserPubkey.trim()));
        recordDateAdded(relayUrl, `muted:${groupKey}`, muteUserPubkey.trim());
        removeDateAdded(relayUrl, `members:${groupKey}`, muteUserPubkey.trim());
        setMuteUserPubkey("");
      } else {
        toast({ title: "Failed to mute user", description: error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setMutingUser(false);
    }
  };

  const handleUnmuteUser = async (userPubkey: string) => {
    if (!selectedGroupId) return;
    try {
      const { ok, error } = await sendPutUser(relayUrl, selectedGroupId, userPubkey, []);
      if (ok) {
        notifyNeedsYouChanged();
        toast({ title: "User unmuted (re-added to group)" });
        setMutedUsers((prev) => prev.filter((p) => p !== userPubkey));
        setGroupMembers((prev) => [...prev, userPubkey]);
        removeDateAdded(relayUrl, `muted:${groupKey}`, userPubkey);
        recordDateAdded(relayUrl, `members:${groupKey}`, userPubkey);
      } else {
        toast({ title: "Failed to unmute user", description: error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  /**
   * Remove a group from THIS RELAY.
   *
   * WHY IT LIVES IN THE OPERATOR CONSOLE and not the space admin drawer, which
   * is where "End this space" already is: they are two different acts that
   * happen to share kind 9008.
   *
   *   the drawer  — "I run this space and I am ending it"      (space scope)
   *   here        — "this is my relay and that room is leaving" (relay scope)
   *
   * The drawer cannot host the second one, because it only renders for someone
   * in the room's kind-39001 admin list — and the whole case for this button is
   * a group the operator does NOT admin. So the scope rule
   * (POSITIONING_AND_IA.md: a control belongs in the drawer only if its subject
   * is one space) puts it here rather than being bent to allow it.
   *
   * HONEST ABOUT THE ODDS: newlay gates group moderation on the 39001 list, and
   * a non-admin key was measured being refused for both 9008 and 9000
   * ("restricted: you are not authorized to moderate group …"). Whether a relay
   * privileges its OWN operator key is untested — there was no way to try it
   * until this button existed. If it refuses, the refusal is now legible rather
   * than silent, which is most of the value either way.
   *
   * This also closes an asymmetry that predates the question: the console could
   * Create a group and had no way to remove one.
   */
  const handleDeleteGroup = async () => {
    if (!selectedGroupId) return;
    setDeletingGroup(true);
    try {
      const { ok, error } = await sendDeleteGroup(relayUrl, selectedGroupId);
      if (ok) {
        toast({ title: "Deletion sent", description: "If the relay accepted it, the room is gone." });
        setConfirmDeleteGroup(false);
        setSelectedGroupId(null);
        // Re-read rather than assume: the relay is the arbiter here, and a
        // group that survived must not vanish from this list.
        fetchGroupMetadataResult(relayUrl).then(({ groups: fetched, reached }) => {
          if (reached) setGroups(fetched.sort((a, b) => (a.id === "_" ? -1 : b.id === "_" ? 1 : (a.name || a.id).localeCompare(b.name || b.id))));
        });
      } else {
        toast({ title: "The relay refused to delete it", description: error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setDeletingGroup(false);
    }
  };

  const handleAssignRole = async () => {
    if (!selectedGroupId || !editRolePubkey.trim() || !editRoleValue.trim()) return;
    setAssigningRole(true);
    try {
      const roles = editRoleValue.trim().split(",").map((r) => r.trim()).filter(Boolean);
      const { ok, error } = await sendPutUser(relayUrl, selectedGroupId, editRolePubkey.trim(), roles);
      if (ok) {
        notifyNeedsYouChanged();
        toast({ title: "Role assigned" });
        setEditRolePubkey("");
        setEditRoleValue("");
        fetchGroupAdminsResult(relayUrl, selectedGroupId).then((r) => { if (r.reached) setGroupAdmins(r.data); });
        fetchGroupMembersResult(relayUrl, selectedGroupId).then((r) => { if (r.reached) setGroupMembers(r.data); });
      } else {
        toast({ title: "Failed to assign role", description: error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setAssigningRole(false);
    }
  };

  if (!hasNip29) {
    return (
      <OpsCard className="space-y-3">
        <OpsSectionHeader label="NIP-29 Group Chat" className="mb-0" labelClassName="text-muted-foreground/50 dark:text-muted-foreground/50" />
        <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
          This relay does not <span className="italic">advertise</span> NIP-29 in its NIP-11 document, so group-chat features are hidden. Detection is based on the relay returning <code className="font-mono text-[10px] px-1 py-0.5 rounded bg-muted/40 text-muted-foreground/80">29</code> in <code className="font-mono text-[10px] px-1 py-0.5 rounded bg-muted/40 text-muted-foreground/80">supported_nips</code>.
        </p>
        <div className="rounded-md border border-border/40 bg-muted/15 px-3 py-2.5 space-y-2">
          <p className="text-[10px] font-brand tracking-wider uppercase text-muted-foreground/50">
            Relays known to implement NIP-29
          </p>
          <ul className="text-[11px] text-muted-foreground/65 leading-relaxed space-y-1">
            <li><span className="font-mono text-brand">Khatru29</span> — Khatru-based relay with NIP-29 built in</li>
            <li><span className="font-mono text-brand">strfry29</span> — strfry fork with NIP-29 patches</li>
            <li><span className="font-mono text-brand">Relay29</span> — fiatjaf's reference Go implementation</li>
            <li><span className="font-mono text-brand">Pyramid</span> — Khatru-based, web-of-trust + groups</li>
            <li><span className="font-mono text-brand">Haven</span> — Khatru-based personal relay with groups</li>
            <li><span className="font-mono text-brand">Khatru</span> (framework) — add the <code className="font-mono text-[10px]">khatru/nip29</code> module</li>
          </ul>
        </div>
        <p className="text-[10px] text-muted-foreground/45 leading-relaxed">
          Mainline <span className="font-mono">strfry</span> does not include NIP-29 — you'd need <span className="font-mono">strfry29</span> or a plugin. If your relay <span className="italic">does</span> support NIP-29 but you still see this notice, add <code className="font-mono text-[10px] px-1 py-0.5 rounded bg-muted/40 text-muted-foreground/80">29</code> to the <code className="font-mono text-[10px] px-1 py-0.5 rounded bg-muted/40 text-muted-foreground/80">supported_nips</code> array in your NIP-11 response and reload.
        </p>
      </OpsCard>
    );
  }

  const selectedGroup = groups.find((g) => g.id === selectedGroupId);

  return (
    <OpsCard className="space-y-4">
      <OpsSectionHeader
        label="NIP-29 Group Chat"
        className="mb-0"
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="h-7 text-[10px] gap-1 border-primary hover:border-primary hover:bg-accent"
          >
            <Plus className="w-3 h-3" />
            Create Group
          </Button>
        }
      />

      {showCreateForm && (
        <div className="border border-border rounded-md p-3 bg-accent space-y-2">
          <h4 className="text-[10px] font-brand tracking-wider uppercase text-brand">New Group</h4>
          {/* Name first: it's what the operator actually has in mind, and the ID
              below fills itself in from it. The old order asked for an ID — the
              one field with a relay-side rule — before anything explained it. */}
          <Input
            value={newGroupName}
            onChange={(e) => {
              setNewGroupName(e.target.value);
              if (!groupIdEdited) setNewGroupId(e.target.value.trim() ? deriveGroupId(e.target.value) : "");
            }}
            placeholder="Group name"
            className="h-7 text-base sm:text-[10px] bg-muted/20 border-border/30"
            data-testid="input-new-group-name"
          />
          <Input
            value={newGroupId}
            onChange={(e) => { setGroupIdEdited(true); setNewGroupId(e.target.value); }}
            placeholder="Group ID (e.g. general, dev-chat)"
            className="h-7 text-base sm:text-[10px] font-mono bg-muted/20 border-border/30"
            data-testid="input-new-group-id"
          />
          <Input
            value={newGroupAbout}
            onChange={(e) => setNewGroupAbout(e.target.value)}
            placeholder="Description (optional)"
            className="h-7 text-base sm:text-[10px] bg-muted/20 border-border/30"
          />
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-[10px] text-foreground/70 cursor-pointer">
              <input type="checkbox" checked={newGroupPrivate} onChange={(e) => setNewGroupPrivate(e.target.checked)} className="rounded" />
              Private
            </label>
            <label className="flex items-center gap-1.5 text-[10px] text-foreground/70 cursor-pointer">
              <input type="checkbox" checked={newGroupClosed} onChange={(e) => setNewGroupClosed(e.target.checked)} className="rounded" />
              Closed
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleCreateGroup}
              // The ID is required BY THE RELAY, so the button must require it
              // too. Enabling without one offered an action that could only fail.
              disabled={creatingGroup || !newGroupName.trim() || !newGroupId.trim()}
              className="h-7 text-[10px] gap-1 bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {creatingGroup ? <RelayOutpostInlineLoader className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
              Create
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowCreateForm(false)} className="h-7 text-[10px]">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-4 justify-center">
          <RelayOutpostInlineLoader className="w-4 h-4" />
          <span className="text-xs text-muted-foreground/50">Loading groups…</span>
        </div>
      ) : groups.length === 0 ? (
        <p className="text-xs text-muted-foreground/40 text-center py-4">
          {groupsReached === false
            ? "Couldn't reach this relay, so we can't list its groups."
            : "No groups found on this relay."}
        </p>
      ) : (
        <div className="space-y-1">
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => setSelectedGroupId(selectedGroupId === g.id ? null : g.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors flex items-center gap-2 ${ selectedGroupId === g.id ? "bg-accent text-accent-foreground border border-brand/20 dark:text-brand" : "hover:bg-muted/30 text-foreground/70" }`}
            >
              <Hash className="w-3 h-3 shrink-0 text-brand dark:text-brand/50" />
              <span className="flex-1 truncate">{g.name || g.id}</span>
              {g.isPrivate && <Lock className="w-3 h-3 text-amber-600/50 dark:text-amber-400/50" />}
              {g.isClosed && <Shield className="w-3 h-3 text-red-600/50 dark:text-red-400/50" />}
            </button>
          ))}
        </div>
      )}

      {selectedGroup && (
        <div className="border-t border-border/20 pt-4 space-y-4">
          <div className="flex items-center gap-2">
            <Hash className="w-3.5 h-3.5 text-brand dark:text-brand/70" />
            <span className="text-sm font-medium text-foreground/90">{selectedGroup.name || selectedGroup.id}</span>
            {selectedGroup.isPrivate && <Badge variant="outline" className="text-[10px] border-amber-400/30 text-amber-700 dark:text-amber-400/70">Private</Badge>}
            {selectedGroup.isClosed && <Badge variant="outline" className="text-[10px] border-red-400/30 text-red-700 dark:text-red-400/70">Closed</Badge>}
            {selectedGroup.isRestricted && <Badge variant="outline" className="text-[10px] border-blue-400/30 text-blue-700 dark:text-blue-400/70">Restricted</Badge>}
          </div>
          {selectedGroup.about && <p className="text-[10px] text-muted-foreground/50">{selectedGroup.about}</p>}

          {loadingDetail ? (
            <div className="flex items-center gap-2 py-3 justify-center">
              <RelayOutpostInlineLoader className="w-4 h-4" />
              <span className="text-[10px] text-muted-foreground/50">Loading details…</span>
            </div>
          ) : (
            <>
              <div className="border-b border-border/20 pb-3">
                <h4 className="text-[10px] font-brand tracking-wider uppercase text-muted-foreground/50 mb-1.5">Edit Metadata</h4>
                <div className="flex flex-col gap-2">
                  <Input
                    value={selectedGroup?.name || ""}
                    onChange={(e) => {
                      setGroups((prev) => prev.map((g) => g.id === selectedGroupId ? { ...g, name: e.target.value } : g));
                    }}
                    placeholder="Group name"
                    className="h-7 text-base sm:text-[10px] bg-muted/20 border-border/30"
                  />
                  <Input
                    value={selectedGroup?.about || ""}
                    onChange={(e) => {
                      setGroups((prev) => prev.map((g) => g.id === selectedGroupId ? { ...g, about: e.target.value } : g));
                    }}
                    placeholder="Description"
                    className="h-7 text-base sm:text-[10px] bg-muted/20 border-border/30"
                  />
                  <Button
                    size="sm"
                    onClick={handleEditMetadata}
                    disabled={editingMetadata}
                    className="h-7 text-[10px] gap-1 bg-primary hover:bg-primary/90 text-primary-foreground w-fit"
                  >
                    {editingMetadata ? <RelayOutpostInlineLoader className="w-3 h-3" /> : null}
                    Save Metadata
                  </Button>
                </div>
              </div>

              <div className="border-b border-border/20 pb-3">
                <h4 className="text-[10px] font-brand tracking-wider uppercase text-muted-foreground/50 mb-1.5">Roles</h4>
                {groupRoles.length > 0 ? (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {groupRoles.map((r) => (
                      <Badge key={r.name} variant="outline" className="text-[10px] border-brand/20 text-brand dark:text-brand/70">
                        {r.name}{r.description ? ` — ${r.description}` : ""}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground/30 mb-2">No roles defined by relay</p>
                )}
                <h5 className="text-[10px] text-muted-foreground/40 mb-1">Assign Role to User</h5>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    value={editRolePubkey}
                    onChange={(e) => setEditRolePubkey(e.target.value)}
                    placeholder="Pubkey (hex)"
                    className="flex-1 h-7 text-base sm:text-[10px] font-mono bg-muted/20 border-border/30"
                  />
                  <Input
                    value={editRoleValue}
                    onChange={(e) => setEditRoleValue(e.target.value)}
                    placeholder="Role name(s), comma-separated"
                    className="w-full sm:w-40 h-7 text-base sm:text-[10px] bg-muted/20 border-border/30"
                  />
                  <Button
                    size="sm"
                    onClick={handleAssignRole}
                    disabled={!editRolePubkey.trim() || !editRoleValue.trim() || assigningRole}
                    className="h-7 text-[10px] gap-1 bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {assigningRole ? <RelayOutpostInlineLoader className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
                    Assign
                  </Button>
                </div>
              </div>

              <div>
                <h4 className="text-[10px] font-brand tracking-wider uppercase text-muted-foreground/50 mb-1.5">
                  Admins ({groupAdmins.length})
                </h4>
                <UserListToolbar
                  controls={adminControls.controls}
                  setQuery={adminControls.setQuery}
                  setSort={adminControls.setSort}
                  setFilter={adminControls.setFilter}
                  total={adminFiltered.total}
                  matched={adminFiltered.filtered.length}
                  activityStatus={adminActivity.status}
                  onLoadActivity={adminActivity.run}
                />
                {groupAdmins.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/30">
                    {detailReached === false ? "Couldn't reach the relay to read this." : "No admins defined"}
                  </p>
                ) : adminFiltered.filtered.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/60 text-center py-2">No matches.</p>
                ) : (
                  <div className="space-y-1">
                    {adminFiltered.filtered.map((pk) => (
                      <div key={pk} className="flex items-center gap-2 px-2 py-1 rounded text-[10px] bg-muted/20">
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="font-mono text-foreground/70 truncate">{memberProfiles[pk]?.name || pk.slice(0, 12) + "…"}</span>
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                            <span title={adminAddedAt[pk] ? undefined : "We only started tracking add dates from now on."}>
                              {adminAddedAt[pk] ? `Added ${formatRelativeMs(adminAddedAt[pk])}` : "Added —"}
                            </span>
                            <span className="text-muted-foreground/30">·</span>
                            <span>{adminActivity.status === "loading" ? "Loading…" : adminActivity.status === "gated" ? "Activity not loaded" : formatRelativeSec(adminActivity.lastActive[pk])}</span>
                          </div>
                        </div>
                        {(adminRolesByPk[pk] || []).map((r) => (
                          <Badge key={r} variant="outline" className="text-[10px] border-primary/20">{r}</Badge>
                        ))}
                        <button onClick={() => setRemoveConfirm(pk)} className="p-0.5 rounded hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-500">
                          <UserMinus className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-[10px] font-brand tracking-wider uppercase text-muted-foreground/50 mb-1.5">
                  Members ({groupMembers.length})
                </h4>
                <UserListToolbar
                  controls={memberControls.controls}
                  setQuery={memberControls.setQuery}
                  setSort={memberControls.setSort}
                  setFilter={memberControls.setFilter}
                  total={memberFiltered.total}
                  matched={memberFiltered.filtered.length}
                  activityStatus={memberActivity.status}
                  onLoadActivity={memberActivity.run}
                />
                {groupMembers.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/30">
                    {detailReached === false ? "Couldn't reach the relay to read this." : "No members listed"}
                  </p>
                ) : memberFiltered.filtered.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/60 text-center py-2">No matches.</p>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-0.5">
                    {memberFiltered.filtered.map((p) => (
                      <div key={p} className="group flex items-center gap-2 px-2 py-1 rounded text-[10px] hover:bg-muted/20">
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="font-mono text-foreground/70 truncate">{memberProfiles[p]?.name || p.slice(0, 16) + "…"}</span>
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                            <span title={memberAddedAt[p] ? undefined : "We only started tracking add dates from now on."}>
                              {memberAddedAt[p] ? `Added ${formatRelativeMs(memberAddedAt[p])}` : "Added —"}
                            </span>
                            <span className="text-muted-foreground/30">·</span>
                            <span>{memberActivity.status === "loading" ? "Loading…" : memberActivity.status === "gated" ? "Activity not loaded" : formatRelativeSec(memberActivity.lastActive[p])}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => setRemoveConfirm(p)}
                          className="touch-target p-0.5 rounded hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-500 reveal-on-hover"
                          aria-label={`Remove ${memberProfiles[p]?.name || p.slice(0, 16)}`}
                          title="Remove"
                          data-testid={`ops-remove-member-${p.slice(0, 8)}`}
                        >
                          <UserMinus className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-border/20 pt-3">
                <h4 className="text-[10px] font-brand tracking-wider uppercase text-muted-foreground/50 mb-1.5">
                  Muted / Removed Users ({mutedUsers.length})
                </h4>
                <UserListToolbar
                  controls={mutedControls.controls}
                  setQuery={mutedControls.setQuery}
                  setSort={mutedControls.setSort}
                  setFilter={mutedControls.setFilter}
                  total={mutedFiltered.total}
                  matched={mutedFiltered.filtered.length}
                  activityStatus={mutedActivity.status}
                  onLoadActivity={mutedActivity.run}
                />
                {mutedUsers.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/30 mb-2">No muted users</p>
                ) : mutedFiltered.filtered.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/60 text-center py-2 mb-2">No matches.</p>
                ) : (
                  <div className="max-h-32 overflow-y-auto space-y-0.5 mb-2">
                    {mutedFiltered.filtered.map((p) => (
                      <div key={p} className="group flex items-center gap-2 px-2 py-1 rounded text-[10px] hover:bg-muted/20">
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="font-mono text-red-600/70 dark:text-red-400/70 truncate">{memberProfiles[p]?.name || p.slice(0, 16) + "…"}</span>
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                            <span title={mutedAddedAt[p] ? undefined : "We only started tracking mute dates from now on."}>
                              {mutedAddedAt[p] ? `Muted ${formatRelativeMs(mutedAddedAt[p])}` : "Muted —"}
                            </span>
                            <span className="text-muted-foreground/30">·</span>
                            <span>{mutedActivity.status === "loading" ? "Loading…" : mutedActivity.status === "gated" ? "Activity not loaded" : formatRelativeSec(mutedActivity.lastActive[p])}</span>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleUnmuteUser(p)}
                          className="touch-target h-5 text-[10px] text-emerald-600/70 dark:text-emerald-400/70 reveal-on-hover px-1"
                          title="Unmute"
                          data-testid={`ops-unmute-${p.slice(0, 8)}`}
                        >
                          Unmute
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    value={muteUserPubkey}
                    onChange={(e) => setMuteUserPubkey(e.target.value)}
                    placeholder="Pubkey to mute (hex)"
                    className="flex-1 h-7 text-base sm:text-[10px] font-mono bg-muted/20 border-border/30"
                  />
                  <Button
                    size="sm"
                    onClick={handleMuteUser}
                    disabled={!muteUserPubkey.trim() || mutingUser}
                    className="h-7 text-[10px] gap-1 bg-red-600 hover:bg-red-700 text-white"
                  >
                    {mutingUser ? <RelayOutpostInlineLoader className="w-3 h-3" /> : <UserMinus className="w-3 h-3" />}
                    Mute
                  </Button>
                </div>
              </div>

              <div className="border-t border-border/20 pt-3">
                <h4 className="text-[10px] font-brand tracking-wider uppercase text-muted-foreground/50 mb-1.5">Add User</h4>
                <Button
                  size="sm"
                  onClick={() => setShowAddMemberSheet(true)}
                  className="h-7 text-[10px] gap-1 bg-primary hover:bg-primary/90 text-primary-foreground"
                  data-testid="button-add-member-community"
                >
                  <UserPlus className="w-3 h-3" />
                  Add member
                </Button>
                <p className="mt-1 text-[10px] text-muted-foreground/40">
                  Direct add by npub, nprofile, or hex pubkey. Optional role grants moderation power.
                </p>
              </div>

              <div className="border-t border-border/20 pt-3">
                <h4 className="text-[10px] font-brand tracking-wider uppercase text-muted-foreground/50 mb-1.5">Create Invite Code</h4>
                <div className="flex gap-2">
                  <Input
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    placeholder="Enter invite code"
                    className="flex-1 h-7 text-base sm:text-[10px] bg-muted/20 border-border/30"
                  />
                  <Button
                    size="sm"
                    onClick={handleCreateInvite}
                    disabled={!inviteCode.trim() || creatingInvite}
                    className="h-7 text-[10px] gap-1 bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {creatingInvite ? <RelayOutpostInlineLoader className="w-3 h-3" /> : <Key className="w-3 h-3" />}
                    Create
                  </Button>
                </div>
              </div>

              <div className="border-t border-border/20 pt-3">
                <h4 className="text-[10px] font-brand tracking-wider uppercase text-muted-foreground/50 mb-1.5">Delete Event</h4>
                <div className="flex gap-2">
                  <Input
                    value={deleteEventId}
                    onChange={(e) => setDeleteEventId(e.target.value)}
                    placeholder="Event ID (hex)"
                    className="flex-1 h-7 text-base sm:text-[10px] font-mono bg-muted/20 border-border/30"
                  />
                  <Button
                    size="sm"
                    onClick={handleDeleteEvent}
                    disabled={!deleteEventId.trim() || deletingEvent}
                    className="h-7 text-[10px] gap-1 bg-red-600 hover:bg-red-700 text-white"
                  >
                    {deletingEvent ? <RelayOutpostInlineLoader className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
                    Delete
                  </Button>
                </div>
              </div>

              {/* Removing the whole room from this relay. Last in the panel and
                  behind a confirm, for the same reason the space drawer puts
                  "End this space" last: nobody should reach it on the way to
                  something else. */}
              <div className="border-t border-border/20 pt-3">
                <h4 className="text-[10px] font-brand tracking-wider uppercase text-muted-foreground/50 mb-1.5">Remove Group</h4>
                <Button
                  size="sm"
                  onClick={() => setConfirmDeleteGroup(true)}
                  disabled={deletingGroup}
                  className="h-7 text-[10px] gap-1 bg-red-600 hover:bg-red-700 text-white"
                  data-testid="button-delete-group-ops"
                >
                  {deletingGroup ? <RelayOutpostInlineLoader className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
                  Remove "{selectedGroup?.name || selectedGroupId}"
                </Button>
                {/* Said plainly because it is true and this console cannot know
                    otherwise: a relay gates 9008 on the group's own admin list,
                    so being the relay's operator may not be enough. */}
                <p className="mt-1 text-[10px] text-muted-foreground/40">
                  Asks the relay to delete this room for everyone. Relays usually only accept this
                  from an admin of the room itself — if it declines, it will say why.
                </p>
              </div>

              {modLog.length > 0 && (
                <div className="border-t border-border/20 pt-3">
                  <h4 className="text-[10px] font-brand tracking-wider uppercase text-muted-foreground/50 mb-1.5">
                    Moderation Log ({modLog.length})
                  </h4>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {modLog.map((e) => {
                      const targetPubkey = e.tags.find((t) => t[0] === "p")?.[1];
                      const targetEvent = e.tags.find((t) => t[0] === "e")?.[1];
                      return (
                        <div key={e.id} className="flex items-center gap-2 px-2 py-1 rounded text-[10px] bg-muted/10 hover:bg-muted/20">
                          <span className="text-brand dark:text-brand/70 font-medium shrink-0">
                            {getModerationActionName(e.kind)}
                          </span>
                          {targetPubkey && (
                            <span className="font-mono text-muted-foreground/50 truncate">{targetPubkey.slice(0, 12)}…</span>
                          )}
                          {targetEvent && (
                            <span className="font-mono text-muted-foreground/50 truncate">{targetEvent.slice(0, 12)}…</span>
                          )}
                          {e.content && (
                            <span className="text-muted-foreground/40 truncate italic">"{e.content}"</span>
                          )}
                          <span className="ml-auto text-muted-foreground/30 shrink-0">
                            {formatDistanceToNow(e.created_at * 1000, { addSuffix: true })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <AlertDialog open={!!removeConfirm} onOpenChange={() => setRemoveConfirm(null)}>
        <AlertDialogContent className="glass-dialog-card border-red-500/20 max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm font-brand tracking-wide">Remove User?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground/70">
              This will remove the user from this group.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeConfirm && handleRemoveUser(removeConfirm)}
              className="h-8 text-xs bg-red-600 hover:bg-red-700 text-white"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeleteGroup} onOpenChange={(o) => { if (!o && !deletingGroup) setConfirmDeleteGroup(false); }}>
        <AlertDialogContent className="glass-dialog-card border-red-500/20 max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm font-brand tracking-wide">Remove this group?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground/70">
              {/* A REQUEST, not an act — the same wording the space drawer uses,
                  because the relay is the arbiter in both places and pretending
                  otherwise is how a control starts lying. */}
              Asks the relay to delete <span className="font-mono">{selectedGroup?.name || selectedGroupId}</span> for
              everyone. Members lose access. Relays usually only accept this from an admin of the
              room itself, so it may be declined — if it is, you'll see the reason.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-xs" disabled={deletingGroup}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeleteGroup(); }}
              disabled={deletingGroup}
              className="h-8 text-xs bg-red-600 hover:bg-red-700 text-white"
              data-testid="confirm-delete-group-ops"
            >
              {deletingGroup ? <RelayOutpostInlineLoader className="w-3 h-3" /> : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {selectedGroupId && (
        <AddMemberSheet
          open={showAddMemberSheet}
          onOpenChange={setShowAddMemberSheet}
          relayUrl={relayUrl}
          groupId={selectedGroupId}
          groupKey={groupKey}
          onAdded={handleMemberAdded}
        />
      )}
    </OpsCard>
  );
}
