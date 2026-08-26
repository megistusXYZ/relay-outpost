import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Clock,
  Trash2,
  RefreshCw,
  FileText,
  BarChart3,
  Radio,
  AlertCircle,
  Send,
  X,
  Satellite,
  Pencil,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Image as ImageIcon,
  Link as LinkIcon,
  Bell,
  Mail,
} from "lucide-react";
import { getKindLabel, formatScheduledTime, type ScheduledPostWithDecrypted } from "@/lib/schedule";

const STATUS_COLORS: Record<string, { dot: string; badge: string; text: string }> = {
  pending: {
    dot: "bg-brand",
    badge: "bg-brand/10 text-brand border-brand/20",
    text: "text-brand",
  },
  publishing: {
    dot: "bg-blue-500",
    badge: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
    text: "text-blue-700 dark:text-blue-400",
  },
  failed: {
    dot: "bg-red-500",
    badge: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
    text: "text-red-700 dark:text-red-400",
  },
  published: {
    dot: "bg-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 border-emerald-500/20",
    text: "text-emerald-800 dark:text-emerald-400",
  },
  cancelled: {
    dot: "bg-gray-500",
    badge: "bg-gray-500/10 text-gray-400 border-gray-500/20",
    text: "text-gray-400",
  },
};

export function getScheduledDotColor(status: string): string {
  return STATUS_COLORS[status]?.dot || STATUS_COLORS.pending.dot;
}

function KindIcon({ kind, className }: { kind: number; className?: string }) {
  switch (kind) {
    case 1:
      return <FileText className={className} />;
    case 1059:
      return <Bell className={className} />;
    case 1068:
      return <BarChart3 className={className} />;
    case 30023:
      return <FileText className={className} />;
    default:
      return <Radio className={className} />;
  }
}

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|avif|svg|bmp)(\?.*)?$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|avi)(\?.*)?$/i;
const URL_REGEX = /https?:\/\/[^\s<]+/g;

function isMediaUrl(url: string): "image" | "video" | null {
  if (IMAGE_EXTENSIONS.test(url)) return "image";
  if (VIDEO_EXTENSIONS.test(url)) return "video";
  return null;
}

function getDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function ContentRenderer({ content, expanded }: { content: string; expanded: boolean }) {
  const parsed = useMemo(() => {
    const parts: Array<{ type: "text" | "url"; value: string; mediaType?: "image" | "video" | null }> = [];
    let lastIndex = 0;
    const matches = [...content.matchAll(URL_REGEX)];

    for (const match of matches) {
      const idx = match.index!;
      if (idx > lastIndex) {
        parts.push({ type: "text", value: content.slice(lastIndex, idx) });
      }
      parts.push({ type: "url", value: match[0], mediaType: isMediaUrl(match[0]) });
      lastIndex = idx + match[0].length;
    }
    if (lastIndex < content.length) {
      parts.push({ type: "text", value: content.slice(lastIndex) });
    }
    return parts;
  }, [content]);

  const textParts = parsed.filter(p => p.type === "text" || (p.type === "url" && !p.mediaType));
  const mediaParts = parsed.filter(p => p.type === "url" && p.mediaType);
  const linkParts = parsed.filter(p => p.type === "url" && !p.mediaType);
  const textContent = textParts
    .map(p => p.type === "text" ? p.value : "")
    .join("")
    .trim();

  if (!expanded) {
    const truncatedText = textContent.length > 120 ? textContent.slice(0, 120) + "…" : textContent;
    return (
      <div className="space-y-1.5">
        {truncatedText && (
          <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap break-words">
            {truncatedText}
          </p>
        )}
        {mediaParts.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {mediaParts.slice(0, 2).map((part, i) => (
              <div key={i} className="rounded-md overflow-hidden border border-border/30 bg-black/20">
                {part.mediaType === "video" ? (
                  <video
                    src={part.value}
                    muted
                    preload="metadata"
                    className="h-24 max-w-[180px] object-cover"
                  />
                ) : (
                  <img
                    src={part.value}
                    alt="Scheduled post media"
                    className="h-24 max-w-[180px] object-cover"
                    loading="lazy"
                  />
                )}
              </div>
            ))}
            {mediaParts.length > 2 && (
              <span className="inline-flex items-center text-[10px] text-brand/70 px-1">
                +{mediaParts.length - 2} more
              </span>
            )}
          </div>
        )}
        {linkParts.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[10px] text-sky-400/70 bg-sky-500/10 rounded-full px-2 py-0.5">
              <LinkIcon className="w-2.5 h-2.5" />
              {linkParts.length} link{linkParts.length > 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {parsed.map((part, i) => {
        if (part.type === "text") {
          const trimmed = part.value.trim();
          if (!trimmed) return null;
          return (
            <p key={i} className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap break-words">
              {part.value}
            </p>
          );
        }

        if (part.mediaType === "image") {
          return (
            <div key={i} className="rounded-lg overflow-hidden border border-border/30 bg-black/20">
              <img
                src={part.value}
                alt="Scheduled post media"
                className="w-full max-h-64 sm:max-h-80 object-contain"
                loading="lazy"
              />
            </div>
          );
        }

        if (part.mediaType === "video") {
          return (
            <div key={i} className="rounded-lg overflow-hidden border border-border/30 bg-black/20">
              <video
                src={part.value}
                controls
                preload="metadata"
                className="w-full max-h-64 sm:max-h-80"
              />
            </div>
          );
        }

        return (
          <a
            key={i}
            href={part.value}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/30 bg-card/60 hover:bg-card hover:border-brand/30 transition-colors group min-w-0"
          >
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-brand flex-shrink-0" />
            <span className="text-xs text-brand/80 group-hover:text-brand-strong truncate">
              {getDomain(part.value)}
            </span>
          </a>
        );
      })}
    </div>
  );
}

interface ScheduledPostCardProps {
  post: ScheduledPostWithDecrypted;
  onCancel: (id: number) => void;
  onReschedule: (id: number, newTime: Date) => void;
  onRetry?: (id: number) => void;
}

export function ScheduledPostCard({ post, onCancel, onReschedule, onRetry }: ScheduledPostCardProps) {
  const [showReschedule, setShowReschedule] = useState(false);
  const [newDateTime, setNewDateTime] = useState("");
  const [expanded, setExpanded] = useState(false);
  const colors = STATUS_COLORS[post.status] || STATUS_COLORS.pending;

  const isGiftWrap = post.kind === 1059;
  const fullContent = isGiftWrap
    ? (post.contentPreview || "Scheduled DM")
    : (post.decryptedEvent?.content || post.contentPreview || "");
  const hasExpandableContent = !isGiftWrap && (fullContent.length > 120 || URL_REGEX.test(fullContent));

  const handleReschedule = () => {
    if (!newDateTime) return;
    const dt = new Date(newDateTime);
    if (dt.getTime() <= Date.now()) return;
    onReschedule(post.id, dt);
    setShowReschedule(false);
    setNewDateTime("");
  };

  return (
    <div className="glass-card border rounded-lg transition-colors overflow-hidden">
      <div className="p-3">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <KindIcon kind={post.kind} className="w-4 h-4 text-muted-foreground/60" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <Badge variant="outline" className={`text-[9px] uppercase tracking-wider ${colors.badge}`}>
                {post.status}
              </Badge>
              <Badge variant="outline" className="text-[9px] uppercase tracking-wider">
                {getKindLabel(post.kind)}
              </Badge>
              {(post as any).backend === "device" && (
                <Badge variant="outline" className="text-[9px] uppercase tracking-wider border-emerald-500/40 text-emerald-600 dark:text-emerald-400" title="Stored only on this device; publishes when the app is open.">
                  On device
                </Badge>
              )}
            </div>

            {isGiftWrap ? (
              <div className="flex items-center gap-2 mb-1.5">
                <Mail className="w-3.5 h-3.5 text-brand/70 flex-shrink-0" />
                <p className="text-sm text-foreground/80 leading-relaxed">
                  {fullContent}
                </p>
              </div>
            ) : post.decryptFailed ? (
              <p className="text-sm text-muted-foreground/50 italic mb-1.5">
                Unable to decrypt — key may have been cleared
              </p>
            ) : fullContent ? (
              <div className="mb-1.5">
                <ContentRenderer content={fullContent} expanded={expanded} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/50 italic mb-1.5">Encrypted content</p>
            )}

            <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50 flex-wrap">
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {post.status === "published" && post.publishedAt ? (
                  <span>Published {new Date(post.publishedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                ) : (
                  <span>{formatScheduledTime(post.scheduledAt)}</span>
                )}
              </div>
              {post.relayUrls.length > 0 && (
                <>
                  <span>·</span>
                  <div className="flex items-center gap-1">
                    <Satellite className="w-3 h-3" />
                    <span>
                      {post.relayUrls.length} relay{post.relayUrls.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </>
              )}
              {hasExpandableContent && !post.decryptFailed && (
                <>
                  <span>·</span>
                  <button
                    onClick={() => setExpanded(!expanded)}
                    className="inline-flex items-center gap-0.5 text-brand/70 hover:text-brand-strong transition-colors"
                  >
                    {expanded ? (
                      <>
                        <ChevronUp className="w-3 h-3" />
                        <span>Less</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3 h-3" />
                        <span>View</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>

            {post.status === "failed" && (
              <div className="flex items-center gap-2 mt-1.5">
                {post.failureReason && (
                  <div className="flex items-center gap-1.5 text-[10px] text-red-700/70 dark:text-red-400/70 min-w-0 flex-1">
                    <AlertCircle className="w-3 h-3 flex-shrink-0" />
                    <span className="break-words truncate">{post.failureReason}</span>
                  </div>
                )}
                {onRetry && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px] border-red-500/20 text-red-700 dark:text-red-400 hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300 flex-shrink-0"
                    onClick={() => onRetry(post.id)}
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Retry
                  </Button>
                )}
              </div>
            )}

            {showReschedule && (
              <div className="flex items-center gap-2 mt-2 flex-wrap sm:flex-nowrap">
                <Input
                  type="datetime-local"
                  value={newDateTime}
                  onChange={(e) => setNewDateTime(e.target.value)}
                  className="h-7 text-xs flex-1 min-w-[160px]"
                />
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleReschedule}>
                    <Send className="w-3 h-3 mr-1" />
                    Set
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => {
                      setShowReschedule(false);
                      setNewDateTime("");
                    }}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          {(post.status === "pending" || post.status === "failed") && (
            <div className="flex flex-col gap-1 flex-shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground/50 hover:text-brand"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("edit-scheduled-post", { detail: post }));
                }}
                title="Edit content"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground/50 hover:text-foreground"
                onClick={() => setShowReschedule(!showReschedule)}
                title="Reschedule"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground/50 hover:text-red-700 dark:hover:text-red-400"
                onClick={() => onCancel(post.id)}
                title="Cancel"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
