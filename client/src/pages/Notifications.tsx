import { useMemo, useState, useCallback, useEffect, useRef, memo } from "react";
import { nip19 } from "nostr-tools";
import { Link, useLocation } from "wouter";
import { use$ } from "applesauce-react/hooks";
import { eventStore } from "@/lib/nostr";
import { KIND_METADATA, KIND_COMMENT, getDisplayName, getAvatarUrl, formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { extractExternalAnchor } from "@/lib/external-id";
import { useNotifications } from "@/contexts/NotificationContext";
import { isMutedPubkey } from "@/lib/spam-filter";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageTabs } from "@/components/PageTabs";
import { MessageSquare, Heart, Repeat, Zap, UserPlus, AtSign, CheckCheck, ChevronDown, ChevronRight, LifeBuoy } from "lucide-react";
import { AdmissionQueue } from "@/components/AdmissionQueue";
import { SweepNoticeCard } from "@/components/SweepNoticeCard";
import { useNeedsYou } from "@/contexts/NeedsYouContext";
import { ReportsQueue } from "@/components/ReportsQueue";
import { ConcordPendingInvites } from "@/components/concord/ConcordPendingInvites";
import { useIaCollapsed } from "@/lib/ia-prefs";
import { NAV_TITLES } from "@/lib/nav-destinations";
import { NotificationIcon } from "@/components/icons/NotificationIcon";
import { BtcZapIcon } from "@/components/NostrPost";
import { formatDistanceToNow, isToday, isYesterday, isThisWeek, isThisMonth, format } from "date-fns";
import { useDocumentTitle } from "@/hooks/use-document-title";

const TYPE_CONFIG = {
  reply: { icon: MessageSquare, label: "replied to you", color: "text-blue-600 dark:text-blue-400", bgAccent: "bg-blue-500/15 dark:bg-blue-500/10", borderAccent: "border-blue-500/30 dark:border-blue-500/20", dotColor: "bg-blue-500 dark:bg-blue-400" },
  mention: { icon: AtSign, label: "mentioned you", color: "text-brand", bgAccent: "bg-brand/15 dark:bg-brand/10", borderAccent: "border-brand/30 dark:border-brand/20", dotColor: "bg-brand" },
  reaction: { icon: Heart, label: "reacted to your post", color: "text-red-600 dark:text-red-400", bgAccent: "bg-red-500/15 dark:bg-red-500/10", borderAccent: "border-red-500/30 dark:border-red-500/20", dotColor: "bg-red-500 dark:bg-red-400" },
  repost: { icon: Repeat, label: "reposted your note", color: "text-green-600 dark:text-green-400", bgAccent: "bg-green-500/15 dark:bg-green-500/10", borderAccent: "border-green-500/30 dark:border-green-500/20", dotColor: "bg-green-500 dark:bg-green-400" },
  zap: { icon: BtcZapIcon, label: "zapped you", color: "text-amber-600 dark:text-amber-400", bgAccent: "bg-amber-500/15 dark:bg-amber-500/10", borderAccent: "border-amber-500/30 dark:border-amber-500/20", dotColor: "bg-amber-500 dark:bg-amber-400" },
  follow: { icon: UserPlus, label: "followed you", color: "text-cyan-600 dark:text-cyan-400", bgAccent: "bg-cyan-500/15 dark:bg-cyan-500/10", borderAccent: "border-cyan-500/30 dark:border-cyan-500/20", dotColor: "bg-cyan-500 dark:bg-cyan-400" },
  ticket: { icon: LifeBuoy, label: "replied to your ticket", color: "text-teal-600 dark:text-teal-400", bgAccent: "bg-teal-500/15 dark:bg-teal-500/10", borderAccent: "border-teal-500/30 dark:border-teal-500/20", dotColor: "bg-teal-500 dark:bg-teal-400" },
};

type NotifType = keyof typeof TYPE_CONFIG;

const AGGREGATABLE_TYPES = new Set<string>(["reaction", "repost", "zap"]);

function getTargetEventId(notification: any): string | null {
  const eTag = notification.event?.tags?.find((t: string[]) => t[0] === "e");
  return eTag?.[1] || null;
}

interface AggregatedGroup {
  key: string;
  targetEventId: string;
  items: any[];
  latestTimestamp: number;
  hasUnread: boolean;
}

function aggregateNotifications(items: any[]): (any | AggregatedGroup)[] {
  const result: (any | AggregatedGroup)[] = [];
  const targetGroups = new Map<string, AggregatedGroup>();

  for (const notif of items) {
    if (!AGGREGATABLE_TYPES.has(notif.type)) {
      result.push(notif);
      continue;
    }
    const targetId = getTargetEventId(notif);
    if (!targetId) {
      result.push(notif);
      continue;
    }

    const groupKey = `${notif.type}-${targetId}`;
    if (!targetGroups.has(groupKey)) {
      const group: AggregatedGroup = {
        key: groupKey,
        targetEventId: targetId,
        items: [],
        latestTimestamp: 0,
        hasUnread: false,
      };
      targetGroups.set(groupKey, group);
      result.push(group);
    }
    const group = targetGroups.get(groupKey)!;
    group.items.push(notif);
    if (notif.timestamp > group.latestTimestamp) group.latestTimestamp = notif.timestamp;
    if (!notif.read) group.hasUnread = true;
  }

  return result;
}

function isAggregatedGroup(item: any): item is AggregatedGroup {
  return item && "targetEventId" in item && "items" in item && Array.isArray(item.items);
}

const ProfileName = memo(function ProfileName({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const name = useMemo(() => {
    if (profile) {
      const n = getDisplayName(profile, "");
      if (n) return n;
    }
    return shortenNpub(formatNpub(pubkey));
  }, [profile, pubkey]);
  return <span className="font-medium">{name}</span>;
});

const AggregatedNotificationItem = memo(function AggregatedNotificationItem({ group, type, onRead }: { group: AggregatedGroup; type: NotifType; onRead: (id: string) => void }) {
  const [, setLocation] = useLocation();
  const config = TYPE_CONFIG[type];
  const Icon = config.icon;
  const items = group.items;
  const uniquePubkeys = useMemo(() => {
    const seen = new Set<string>();
    const pks: string[] = [];
    for (const item of items) {
      if (!seen.has(item.fromPubkey)) {
        seen.add(item.fromPubkey);
        pks.push(item.fromPubkey);
      }
    }
    return pks;
  }, [items]);

  const displayPubkeys = uniquePubkeys.slice(0, 3);
  const remainingCount = uniquePubkeys.length - displayPubkeys.length;

  const timeAgo = useMemo(() => {
    try {
      return formatDistanceToNow(new Date(group.latestTimestamp * 1000), { addSuffix: true });
    } catch {
      return "";
    }
  }, [group.latestTimestamp]);

  const threadLink = useMemo(() => {
    const firstItem = items[0];
    const eTag = firstItem?.event?.tags?.find((t: string[]) => t[0] === "e");
    const relayHint = eTag?.[2];
    const base = `/thread/${group.targetEventId}`;
    const params = new URLSearchParams();
    if (relayHint && relayHint.startsWith("wss://")) {
      params.set("relay", relayHint);
    }
    if (type === "reaction" || type === "repost" || type === "zap") {
      params.set("ntype", type);
      if (uniquePubkeys.length === 1) params.set("by", uniquePubkeys[0]);
      else if (firstItem?.fromPubkey) params.set("by", firstItem.fromPubkey);
    }
    if (type === "reaction" && firstItem?.event?.content) {
      params.set("emoji", firstItem.event.content);
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }, [group.targetEventId, items, type, uniquePubkeys]);

  const actionLabel = useMemo(() => {
    if (type === "reaction") return "reacted to your post";
    if (type === "repost") return "reposted your note";
    if (type === "zap") return "zapped you";
    return config.label;
  }, [type, config.label]);

  const repostedContent = useMemo(() => {
    if (type !== "repost") return null;
    for (const item of items) {
      if (item.event?.content) {
        try {
          const parsed = JSON.parse(item.event.content);
          if (parsed?.content) {
            const text = parsed.content.trim();
            return text.length > 120 ? text.slice(0, 120) + "…" : text;
          }
        } catch {}
      }
    }
    return null;
  }, [type, items]);

  const handleClick = useCallback(() => {
    for (const item of items) {
      if (!item.read) onRead(item.id);
    }
    setLocation(threadLink);
  }, [items, onRead, threadLink, setLocation]);

  return (
    <div
      className={`flex items-start gap-3 p-3 sm:p-3.5 transition-colors cursor-pointer rounded-lg hover:bg-muted/10 ${
        !group.hasUnread ? "opacity-80" : ""
      }`}
      onClick={handleClick}
      data-testid={`notification-aggregated-${group.key}`}
    >
      <div className="relative shrink-0">
        <div className="flex -space-x-2">
          {displayPubkeys.map((pk) => (
            <AggregatedAvatar key={pk} pubkey={pk} />
          ))}
          {remainingCount > 0 && (
            <div className="w-8 h-8 rounded-full bg-muted border-2 border-background flex items-center justify-center z-10">
              <span className="text-[9px] font-bold text-muted-foreground">+{remainingCount}</span>
            </div>
          )}
        </div>
        <div className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full ${config.bgAccent} border ${config.borderAccent} flex items-center justify-center z-20`}>
          <Icon className={`w-2 h-2 ${config.color}`} />
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap text-[13px]">
          {displayPubkeys.map((pk, i) => (
            <span key={pk}>
              <ProfileName pubkey={pk} />
              {i < displayPubkeys.length - 1 && <span className="text-foreground/40">, </span>}
            </span>
          ))}
          {remainingCount > 0 && (
            <span className="text-foreground/60">and {remainingCount} other{remainingCount > 1 ? "s" : ""}</span>
          )}
          <span className="text-[11px] text-foreground/60 dark:text-muted-foreground/70">{actionLabel}</span>
          {group.hasUnread && (
            <span className={`w-1.5 h-1.5 rounded-full ${config.dotColor} shrink-0`} />
          )}
        </div>
        {repostedContent && (
          <p className="text-[11px] text-foreground/50 dark:text-muted-foreground/60 mt-0.5 line-clamp-2 leading-relaxed">
            {repostedContent}
          </p>
        )}
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-[10px] text-foreground/45 dark:text-muted-foreground/50">{timeAgo}</span>
        </div>
      </div>
    </div>
  );
});

const AggregatedAvatar = memo(function AggregatedAvatar({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const name = useMemo(() => {
    if (profile) {
      const n = getDisplayName(profile, "");
      if (n) return n;
    }
    return shortenNpub(formatNpub(pubkey));
  }, [profile, pubkey]);
  const avatarUrl = profile ? getAvatarUrl(profile) : undefined;
  const profileUrl = useMemo(() => {
    try { return `/profile/${nip19.npubEncode(pubkey)}`; } catch { return "#"; }
  }, [pubkey]);

  return (
    <Link href={profileUrl} onClick={(e: React.MouseEvent) => e.stopPropagation()} data-testid={`notification-agg-avatar-${pubkey.slice(0, 8)}`}>
      <Avatar className="w-8 h-8 border-2 border-background">
        <AvatarImage src={avatarUrl} />
        <AvatarFallback className="text-[10px] bg-muted">{name[0]?.toUpperCase()}</AvatarFallback>
      </Avatar>
    </Link>
  );
});

const NotificationItem = memo(function NotificationItem({ notification, onRead }: { notification: any; onRead: (id: string) => void }) {
  const [, setLocation] = useLocation();
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, notification.fromPubkey), [notification.fromPubkey]);

  const displayName = useMemo(() => {
    if (profile) {
      const name = getDisplayName(profile, "");
      if (name) return name;
    }
    return shortenNpub(formatNpub(notification.fromPubkey));
  }, [profile, notification.fromPubkey]);

  const avatarUrl = profile ? getAvatarUrl(profile) : undefined;
  const config = TYPE_CONFIG[notification.type as NotifType];
  const Icon = config.icon;

  const zapAmountLabel = useMemo(() => {
    if (notification.type !== "zap") return null;
    const tags = notification.event.tags || [];
    const amountTag = tags.find((t: string[]) => t[0] === "amount");
    if (amountTag?.[1]) {
      const msats = parseInt(amountTag[1], 10);
      if (!isNaN(msats) && msats > 0) return `zapped you ${Math.floor(msats / 1000).toLocaleString()} sats`;
    }
    const bolt11Tag = tags.find((t: string[]) => t[0] === "bolt11");
    if (bolt11Tag?.[1]) {
      const match = bolt11Tag[1].match(/lnbc(\d+)([munp]?)/i);
      if (match) {
        const num = parseInt(match[1]);
        const unit = match[2] || "";
        const btc = unit === "m" ? num / 1000 : unit === "u" ? num / 1000000 : unit === "n" ? num / 1000000000 : unit === "p" ? num / 1000000000000 : num;
        const sats = Math.round(btc * 100_000_000);
        if (sats > 0) return `zapped you ${sats.toLocaleString()} sats`;
      }
    }
    const descTag = tags.find((t: string[]) => t[0] === "description");
    if (descTag?.[1]) {
      try {
        const zapReq = JSON.parse(descTag[1]);
        const amtTag = zapReq.tags?.find((t: string[]) => t[0] === "amount");
        if (amtTag?.[1]) {
          const msats = parseInt(amtTag[1], 10);
          if (!isNaN(msats) && msats > 0) return `zapped you ${Math.floor(msats / 1000).toLocaleString()} sats`;
        }
      } catch {}
    }
    return null;
  }, [notification.type, notification.event.tags]);

  // External-discussion comment (kind-1111): a reply → "replied to your comment
  // on <host>"; a pure @-mention → "mentioned you in a discussion on <host>".
  // The host is derived from the comment's own normalized anchor (its I-tag),
  // never author-supplied text — phishing-safe.
  const externalCommentLabel = useMemo(() => {
    if (notification.event.kind !== KIND_COMMENT) return null;
    if (notification.type !== "reply" && notification.type !== "mention") return null;
    const anchor = extractExternalAnchor(notification.event);
    let host = "";
    try { if (anchor) host = new URL(anchor).hostname.replace(/^www\./, ""); } catch {}
    if (notification.type === "mention") {
      return host ? `mentioned you in a discussion on ${host}` : "mentioned you in a discussion";
    }
    return host ? `replied to your comment on ${host}` : "replied to your comment";
  }, [notification.type, notification.event]);

  const timeAgo = useMemo(() => {
    try {
      return formatDistanceToNow(new Date(notification.timestamp * 1000), { addSuffix: true });
    } catch {
      return "";
    }
  }, [notification.timestamp]);

  const profileUrl = useMemo(() => {
    try {
      return `/profile/${nip19.npubEncode(notification.fromPubkey)}`;
    } catch {
      return "#";
    }
  }, [notification.fromPubkey]);

  const contentPreview = useMemo(() => {
    if (!notification.event.content || notification.type === "follow" || notification.type === "ticket") return null;

    if (notification.type === "repost") {
      try {
        const reposted = JSON.parse(notification.event.content);
        if (reposted?.content) {
          const text = reposted.content.trim();
          return text.length > 120 ? text.slice(0, 120) + "…" : text;
        }
      } catch {}
      return null;
    }

    return notification.event.content.slice(0, 120) + (notification.event.content.length > 120 ? "..." : "");
  }, [notification.event.content, notification.type]);

  const destination = useMemo(() => {
    if (notification.type === "follow") return profileUrl;
    if (notification.type === "ticket") return `/tickets?id=${notification.event.id}`;
    if ((notification.type === "reply" || notification.type === "mention") && notification.event.kind === KIND_COMMENT) {
      // External-discussion reply OR @-mention → deep-link into the RO discussion
      // for the link this comment is anchored to. The anchor is the comment's own
      // normalized I-tag; the reader shows the LINK's fetched data, never
      // author-supplied tags (phishing-safe).
      const anchor = extractExternalAnchor(notification.event);
      if (anchor) return `/news?discuss=${encodeURIComponent(anchor)}`;
    }
    if (notification.type === "reply" || notification.type === "mention") {
      const eTag = notification.event.tags.find((t: string[]) => t[0] === "e");
      const relayHint = eTag?.[2];
      if (relayHint && relayHint.startsWith("wss://")) {
        return `/thread/${notification.event.id}?relay=${encodeURIComponent(relayHint)}`;
      }
      return `/thread/${notification.event.id}`;
    }
    if (notification.type === "reaction" || notification.type === "repost" || notification.type === "zap") {
      const eTag = notification.event.tags.find((t: string[]) => t[0] === "e");
      if (eTag) {
        const params = new URLSearchParams();
        params.set("ntype", notification.type);
        params.set("by", notification.fromPubkey);
        const relayHint = eTag[2];
        if (relayHint && relayHint.startsWith("wss://")) {
          params.set("relay", relayHint);
        }
        if (notification.type === "reaction" && notification.event.content) {
          params.set("emoji", notification.event.content);
        }
        if (notification.type === "zap") {
          let sats = 0;
          const amountTag = notification.event.tags.find((t: string[]) => t[0] === "amount");
          if (amountTag?.[1]) {
            const msats = parseInt(amountTag[1], 10);
            if (!isNaN(msats) && msats > 0) sats = Math.floor(msats / 1000);
          }
          if (sats <= 0) {
            const bolt11Tag = notification.event.tags.find((t: string[]) => t[0] === "bolt11");
            if (bolt11Tag?.[1]) {
              const match = bolt11Tag[1].match(/lnbc(\d+)([munp]?)/i);
              if (match) {
                const num = parseInt(match[1]);
                const unit = match[2] || "";
                const btc = unit === "m" ? num / 1000 : unit === "u" ? num / 1000000 : unit === "n" ? num / 1000000000 : unit === "p" ? num / 1000000000000 : num;
                sats = Math.round(btc * 100_000_000);
              }
            }
          }
          if (sats <= 0) {
            const descTag = notification.event.tags.find((t: string[]) => t[0] === "description");
            if (descTag?.[1]) {
              try {
                const zapReq = JSON.parse(descTag[1]);
                const amtTag = zapReq.tags?.find((t: string[]) => t[0] === "amount");
                if (amtTag?.[1]) {
                  const msats = parseInt(amtTag[1], 10);
                  if (!isNaN(msats) && msats > 0) sats = Math.floor(msats / 1000);
                }
              } catch {}
            }
          }
          if (sats > 0) params.set("sats", String(sats));
        }
        return `/thread/${eTag[1]}?${params.toString()}`;
      }
    }
    return profileUrl;
  }, [notification, profileUrl]);

  const handleCardClick = useCallback(() => {
    onRead(notification.id);
    if (destination) setLocation(destination);
  }, [notification.id, destination, onRead, setLocation]);

  const handleAvatarClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      className={`flex items-start gap-3 p-3 sm:p-3.5 transition-colors cursor-pointer rounded-lg hover:bg-muted/10 ${
        notification.read ? "opacity-80" : ""
      }`}
      onClick={handleCardClick}
      data-testid={`notification-item-${notification.id}`}
    >
      <div className="relative shrink-0" onClick={handleAvatarClick}>
        <Link href={profileUrl} data-testid={`notification-avatar-link-${notification.id}`}>
          <Avatar className="w-8 h-8">
            <AvatarImage src={avatarUrl} />
            <AvatarFallback className="text-[10px] bg-muted">{displayName[0]?.toUpperCase()}</AvatarFallback>
          </Avatar>
        </Link>
        <div className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full ${config.bgAccent} border ${config.borderAccent} flex items-center justify-center`}>
          <Icon className={`w-2 h-2 ${config.color}`} />
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[13px] font-medium" data-testid={`notification-author-${notification.id}`}>{displayName}</span>
          <span className="text-[11px] text-foreground/60 dark:text-muted-foreground/70">{zapAmountLabel || externalCommentLabel || config.label}</span>
          {!notification.read && (
            <span className={`w-1.5 h-1.5 rounded-full ${config.dotColor} shrink-0`} />
          )}
        </div>
        {contentPreview && (
          <p className="text-[11px] text-foreground/50 dark:text-muted-foreground/60 mt-0.5 line-clamp-1" data-testid={`notification-preview-${notification.id}`}>
            {contentPreview}
          </p>
        )}
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-[10px] text-foreground/45 dark:text-muted-foreground/50">{timeAgo}</span>
        </div>
      </div>
    </div>
  );
});

const RenderNotifItem = memo(function RenderNotifItem({ item, type, onRead }: { item: any; type: NotifType; onRead: (id: string) => void }) {
  if (isAggregatedGroup(item)) {
    if (item.items.length === 1) {
      return <NotificationItem notification={item.items[0]} onRead={onRead} />;
    }
    return <AggregatedNotificationItem group={item} type={type} onRead={onRead} />;
  }
  return <NotificationItem notification={item} onRead={onRead} />;
});

const ITEMS_PER_PAGE = 15;

function getDateBucket(timestamp: number): { key: string; label: string; defaultExpanded: boolean; order: number } {
  const date = new Date(timestamp * 1000);
  if (isToday(date)) return { key: "today", label: "Today", defaultExpanded: true, order: 1 };
  if (isYesterday(date)) return { key: "yesterday", label: "Yesterday", defaultExpanded: true, order: 2 };
  if (isThisWeek(date)) return { key: "this-week", label: "This Week", defaultExpanded: false, order: 3 };
  if (isThisMonth(date)) return { key: "this-month", label: "This Month", defaultExpanded: false, order: 4 };
  const monthKey = format(date, "yyyy-MM");
  const monthLabel = format(date, "MMM yyyy");
  return { key: monthKey, label: monthLabel, defaultExpanded: false, order: 5 };
}

const DateSubGroup = memo(function DateSubGroup({ label, bucketKey, items, onRead, defaultExpanded, typeKey }: {
  label: string; bucketKey: string; items: any[]; onRead: (id: string) => void; defaultExpanded: boolean; typeKey: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const prevItemsLen = useRef(items.length);

  const aggregated = useMemo(() => aggregateNotifications(items), [items]);

  useEffect(() => {
    if (items.length !== prevItemsLen.current) {
      prevItemsLen.current = items.length;
      setVisibleCount(ITEMS_PER_PAGE);
    }
  }, [items.length]);

  const SubIcon = expanded ? ChevronDown : ChevronRight;
  const visible = aggregated.slice(0, visibleCount);
  const hasMore = visibleCount < aggregated.length;

  return (
    <div data-testid={`date-group-${typeKey}-${bucketKey}`}>
      <button
        type="button"
        className="flex items-center gap-1.5 px-3 py-1.5 w-full bg-muted/5 dark:bg-muted/3 hover:bg-muted/15 dark:hover:bg-muted/8 transition-colors cursor-pointer"
        onClick={() => setExpanded(e => !e)}
        data-testid={`button-toggle-date-${typeKey}-${bucketKey}`}
      >
        <SubIcon className="w-2.5 h-2.5 text-muted-foreground/50 shrink-0 transition-transform" />
        <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-foreground/55 dark:text-muted-foreground/60 flex-1 text-left">
          {label}
        </span>
        <span className="text-[9px] text-muted-foreground/45 dark:text-muted-foreground/40 tabular-nums" data-testid={`text-date-count-${typeKey}-${bucketKey}`}>
          {items.length}
        </span>
      </button>
      {expanded && (
        <div className="divide-y divide-border/10">
          {visible.map(item => {
            const key = isAggregatedGroup(item) ? item.key : item.id;
            return <RenderNotifItem key={key} item={item} type={typeKey as NotifType} onRead={onRead} />;
          })}
          {hasMore && (
            <button
              type="button"
              className="w-full px-3 py-2 text-[10px] text-brand/60 hover:text-brand/80 hover:bg-muted/10 transition-colors cursor-pointer font-medium"
              onClick={() => setVisibleCount(c => c + ITEMS_PER_PAGE)}
              data-testid={`button-show-more-${typeKey}-${bucketKey}`}
            >
              Show more
            </button>
          )}
        </div>
      )}
    </div>
  );
});

const GroupedNotifications = memo(function GroupedNotifications({ notifications, type, onRead, collapsed, onToggle }: { notifications: any[]; type: NotifType; onRead: (id: string) => void; collapsed: boolean; onToggle: (type: string) => void }) {
  const config = TYPE_CONFIG[type];
  const Icon = config.icon;
  const unreadCount = notifications.filter(n => !n.read).length;
  const CollapseIcon = collapsed ? ChevronRight : ChevronDown;
  const [unreadVisible, setUnreadVisible] = useState(ITEMS_PER_PAGE);

  const dateBuckets = useMemo(() => {
    const unread = notifications.filter(n => !n.read);
    const read = notifications.filter(n => n.read);

    const bucketMap = new Map<string, { label: string; items: any[]; defaultExpanded: boolean; order: number }>();

    for (const notif of read) {
      const ts = notif.event?.created_at || notif.timestamp || 0;
      const bucket = getDateBucket(ts);
      if (!bucketMap.has(bucket.key)) {
        bucketMap.set(bucket.key, { label: bucket.label, items: [], defaultExpanded: bucket.defaultExpanded, order: bucket.order });
      }
      bucketMap.get(bucket.key)!.items.push(notif);
    }

    for (const [, bucket] of bucketMap) {
      bucket.items.sort((a: any, b: any) => (b.event?.created_at || 0) - (a.event?.created_at || 0));
    }

    const sorted = Array.from(bucketMap.entries()).sort((a, b) => {
      if (a[1].order !== b[1].order) return a[1].order - b[1].order;
      return b[0].localeCompare(a[0]);
    });

    return { unread, dateBuckets: sorted };
  }, [notifications]);

  const aggregatedUnread = useMemo(() => aggregateNotifications(dateBuckets.unread), [dateBuckets.unread]);

  return (
    <div className="glass-card rounded-lg border overflow-hidden" data-testid={`notification-group-${type}`}>
      <button
        type="button"
        className={`flex items-center gap-2 px-3 py-2 w-full ${config.bgAccent} ${collapsed ? "" : `border-b ${config.borderAccent}`} hover-elevate cursor-pointer`}
        onClick={() => onToggle(type)}
        data-testid={`button-toggle-group-${type}`}
      >
        <CollapseIcon className={`w-3 h-3 ${config.color}/60 shrink-0 transition-transform`} />
        <Icon className={`w-3.5 h-3.5 ${config.color}`} />
        <span className="text-[11px] font-mono uppercase tracking-[0.15em] text-foreground/80 dark:text-muted-foreground/90 font-semibold flex-1 text-left">
          {TYPE_LABEL[type]}
        </span>
        {unreadCount > 0 && (
          <span className={`w-4 h-4 rounded-full ${config.bgAccent} border ${config.borderAccent} flex items-center justify-center`} data-testid={`badge-group-unread-${type}`}>
            <span className={`text-[9px] font-bold ${config.color}`}>{unreadCount}</span>
          </span>
        )}
        <span className="text-[10px] text-muted-foreground/60 dark:text-muted-foreground/50" data-testid={`text-group-count-${type}`}>{notifications.length}</span>
      </button>
      {!collapsed && (
        <div className="divide-y divide-border/10">
          {aggregatedUnread.length > 0 && (
            <>
              <div className="px-3 py-1.5 bg-brand/10 dark:bg-brand/5 border-b border-brand/20 dark:border-brand/10">
                <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-brand/80 dark:text-brand/70">
                  New · {dateBuckets.unread.length}
                </span>
              </div>
              {aggregatedUnread.slice(0, unreadVisible).map(item => {
                const key = isAggregatedGroup(item) ? item.key : item.id;
                return <RenderNotifItem key={key} item={item} type={type} onRead={onRead} />;
              })}
              {unreadVisible < aggregatedUnread.length && (
                <button
                  type="button"
                  className="w-full px-3 py-2 text-[10px] text-brand/60 hover:text-brand/80 hover:bg-muted/10 transition-colors cursor-pointer font-medium"
                  onClick={() => setUnreadVisible(c => c + ITEMS_PER_PAGE)}
                  data-testid={`button-show-more-${type}-new`}
                >
                  Show more
                </button>
              )}
            </>
          )}
          {dateBuckets.dateBuckets.map(([key, bucket]) => (
            <DateSubGroup
              key={key}
              bucketKey={key}
              label={bucket.label}
              items={bucket.items}
              onRead={onRead}
              defaultExpanded={bucket.defaultExpanded}
              typeKey={type}
            />
          ))}
        </div>
      )}
    </div>
  );
});

const ALL_TYPES: NotifType[] = ["ticket", "mention", "reply", "zap", "reaction", "repost", "follow"];

// Single source of truth for category labels — used by both the section
// headers and the filter tabs so the two always read the same words.
const TYPE_LABEL: Record<NotifType, string> = {
  ticket: "Support",
  mention: "Mentions",
  reply: "Replies",
  zap: "Zaps",
  reaction: "Reactions",
  repost: "Reposts",
  follow: "Follows",
};

// "all" plus whichever category types actually have notifications.
type NotifFilter = "all" | NotifType;

function getInitialCollapsed(notifications: any[]): Set<string> {
  const collapsed = new Set<string>(ALL_TYPES);
  for (const n of notifications) {
    if (!n.read) {
      collapsed.delete(n.type);
    }
  }
  return collapsed;
}

export default function Notifications() {
  const { notifications, unreadCount, markAllRead, markRead, clearAll, loading, updateLastSeen } = useNotifications();
  const iaCollapsed = useIaCollapsed();
  const needsYou = useNeedsYou();
  // The nav calls this destination Activity; the tab said "Notifications". A
  // place should answer to one name — NAV_TITLES is where that name lives, so
  // the page reads it rather than keeping its own copy to drift from.
  useDocumentTitle(iaCollapsed ? NAV_TITLES.activity : "Notifications");

  // Mark the list seen on open, and keep it seen as items stream in while the
  // page is mounted, so the badge stays at zero while the user is looking.
  const newestTimestamp = notifications[0]?.timestamp ?? 0;
  useEffect(() => {
    updateLastSeen();
  }, [updateLastSeen, notifications.length, newestTimestamp]);

  const [filter, setFilter] = useState<NotifFilter>("all");
  const hasUnreadItems = useMemo(() => notifications.some(n => !n.read), [notifications]);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => getInitialCollapsed(notifications));

  const prevUnreadTypesRef = useRef<string>("");
  useEffect(() => {
    const unreadTypes: string[] = [];
    for (const n of notifications) {
      if (!n.read && !unreadTypes.includes(n.type)) unreadTypes.push(n.type);
    }
    const key = unreadTypes.sort().join(",");
    if (key !== prevUnreadTypesRef.current && unreadTypes.length > 0) {
      prevUnreadTypesRef.current = key;
      setCollapsedSections(prev => {
        let changed = false;
        const next = new Set(prev);
        for (let i = 0; i < unreadTypes.length; i++) {
          if (next.has(unreadTypes[i])) {
            next.delete(unreadTypes[i]);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [notifications]);

  const toggleSection = useCallback((type: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const grouped = useMemo(() => {
    const groups = new Map<NotifType, any[]>();
    const typeOrder: NotifType[] = ["ticket", "mention", "reply", "zap", "reaction", "repost", "follow"];

    for (const notif of notifications) {
      if (notif.fromPubkey && isMutedPubkey(notif.fromPubkey)) continue;
      const type = notif.type as NotifType;
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type)!.push(notif);
    }

    return typeOrder.filter(t => groups.has(t)).map(t => ({
      type: t,
      items: groups.get(t)!.sort((a, b) => b.event.created_at - a.event.created_at),
    }));
  }, [notifications]);

  // Tabs are derived from the categories that actually have notifications, so
  // they always match the section headers below and never point at nothing.
  //
  // With fewer than two categories there is nothing to filter BETWEEN: the bar
  // renders "All" beside a lone "Follows", both showing the identical single
  // item. That is chrome pretending to be a choice, on the surface whose whole
  // job is separating what needs you from what doesn't — so it stays hidden
  // until a second category actually exists.
  const filterTabs = useMemo(
    () =>
      grouped.length < 2
        ? []
        : [{ value: "all" as NotifFilter, label: "All" }, ...grouped.map(g => ({ value: g.type as NotifFilter, label: TYPE_LABEL[g.type] }))],
    [grouped],
  );

  // If the active category drains away (e.g. items muted), fall back to All.
  useEffect(() => {
    if (filter !== "all" && !grouped.some(g => g.type === filter)) setFilter("all");
  }, [grouped, filter]);

  const visibleGroups = useMemo(
    () => (filter === "all" ? grouped : grouped.filter(g => g.type === filter)),
    [grouped, filter],
  );

  // Which category types still have unread items — drives the per-tab dot.
  const unreadTypes = useMemo(() => {
    const s = new Set<string>();
    for (const g of grouped) {
      if (g.items.some((n: any) => !n.read)) s.add(g.type);
    }
    return s;
  }, [grouped]);

  const activeLabel = filter === "all" ? "notifications" : TYPE_LABEL[filter].toLowerCase();

  return (
    <div className="max-w-2xl mx-auto px-3 sm:px-6 py-4 sm:py-6" data-testid="page-notifications">
      {/* No page title — the bottom nav labels this tab. One row: filter tabs
          left, Mark read right (unread counts live on the section rows below). */}
      {(filterTabs.length > 1 || hasUnreadItems) && (
        <div className="flex items-center justify-between gap-2 mb-3">
          {filterTabs.length > 1 ? (
            <PageTabs
              className="flex-1 min-w-0"
              testId="tabs-notification-filter"
              ariaLabel="Notification filters"
              active={filter}
              onChange={(v) => setFilter(v as NotifFilter)}
              tabs={filterTabs.map((tab) => {
                const showDot = filter !== tab.value && (tab.value === "all" ? unreadTypes.size > 0 : unreadTypes.has(tab.value));
                return {
                  key: tab.value,
                  label: tab.label,
                  testId: `tab-filter-${tab.value}`,
                  badge: showDot ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-brand shrink-0" aria-hidden="true" />
                  ) : undefined,
                };
              })}
            />
          ) : (
            <div className="flex-1" />
          )}
          {hasUnreadItems && (
            <Button variant="ghost" size="sm" onClick={() => { clearAll(); setCollapsedSections(new Set(ALL_TYPES)); }} className="text-xs shrink-0" data-testid="button-clear-notifications">
              <CheckCheck className="w-3.5 h-3.5 mr-1" />
              Mark read
            </Button>
          )}
        </div>
      )}

      {/* Needs you / Recent — the split is by ACTIONABILITY, not by role. A join
          request to a space you run and an invite addressed to you are the same
          shape of task; a mention is not. Bounded sections rather than one
          interleaved stream is also what stops an operator's ticket volume from
          burying their own mentions.

          Today the only decision-shaped item that exists is a pending community
          invite. Join requests and reports arrive with the Stage 2 operator work
          and slot in here. Nothing renders when there is nothing to decide —
          "Needs you" over an empty box would be worse than no heading. */}
      {iaCollapsed && (
        <div data-testid="activity-needs-you">
          <ConcordPendingInvites />
          {/* ONE notice for both queue sweeps — names the relays that never
              answered and offers retry / turn off / remove. The per-queue
              lines are gone; this card is the only reach admission here. */}
          {needsYou && (
            <SweepNoticeCard
              className="mt-2"
              entries={[
                { sweep: needsYou.admissions.sweep, subject: "join requests" },
                { sweep: needsYou.reports.sweep, subject: "reports" },
              ]}
              onRetry={needsYou.refresh}
            />
          )}
          {/* Stage 2: people waiting to be let into a space you run, gathered
              from every such space. Self-hides when nobody is waiting. */}
          <AdmissionQueue className="mt-2" />
          {/* Stage 2: everything flagged in any space you run. Sits BELOW the
              admission queue deliberately — somebody kept waiting at the door
              is a person being made to wait, which outranks a decision about
              something already said. Self-hides when nothing is reported. */}
          <ReportsQueue className="mt-2" />
          <p className="px-1 pt-4 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50" data-testid="activity-section-recent">
            Recent
          </p>
        </div>
      )}

      {loading && notifications.length === 0 ? (
        <div className="glass-card rounded-lg border p-10">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-brand/10 border border-brand/20 flex items-center justify-center animate-pulse">
              <NotificationIcon className="w-5 h-5 text-brand/60" />
            </div>
            <p className="text-sm text-muted-foreground/70" data-testid="text-loading-notifications">Scanning relays for activity...</p>
            <p className="text-[11px] text-muted-foreground/50">Fetching your notification history</p>
          </div>
        </div>
      ) : notifications.length === 0 ? (
        <div className="glass-card rounded-lg border p-10">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-brand/10 border border-brand/20 flex items-center justify-center">
              <NotificationIcon className="w-5 h-5 text-brand/60" />
            </div>
            <p className="text-sm text-muted-foreground/70" data-testid="text-no-notifications">No notifications yet</p>
            <p className="text-[11px] text-muted-foreground/50">When people interact with your posts, you'll see it here</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground/50">
              <div className="w-2 h-2 rounded-full bg-brand/40 animate-pulse" />
              Loading older notifications...
            </div>
          )}
          {visibleGroups.length === 0 ? (
            <div className="glass-card rounded-lg border p-8 text-center" data-testid="text-no-filtered-notifications">
              <p className="text-[12px] text-muted-foreground/70">No {activeLabel} yet</p>
            </div>
          ) : (
            visibleGroups.map(({ type, items }) => (
              <GroupedNotifications
                key={type}
                notifications={items}
                type={type}
                onRead={markRead}
                collapsed={filter === "all" ? collapsedSections.has(type) : false}
                onToggle={toggleSection}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
