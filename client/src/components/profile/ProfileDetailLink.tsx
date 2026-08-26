/**
 * Subtle-but-professional link treatment for the profile Details section.
 *
 * Two shapes over the same brand map:
 *  · <DetailLink> — a compact chip for a primary link (the website field): a
 *    brand-aware glyph, the clean host/handle, and a quiet external arrow.
 *  · linkifyBio()  — turns raw URLs sitting inside the free-text bio into real
 *    links styled to stand out a touch without shouting.
 *
 * Restraint budget: one accent, brand glyph tinted only for recognized hosts,
 * everything else neutral. Reads in light and dark.
 */
import type { ReactNode, ComponentType } from "react";
import { Github, Youtube, Twitter, Send, Zap, ExternalLink } from "lucide-react";
import { LinkIcon } from "@/components/icons/LinkIcon";

interface Brand {
  Icon: ComponentType<{ className?: string }>;
  /** Icon tint — a Tailwind text-* class. Neutral unless the host is known. */
  tint: string;
  /** Brand name for a recognized host; null → use the cleaned URL as the label. */
  label: string | null;
}

function brandFor(rawUrl: string): Brand {
  let host = "";
  try {
    host = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`).hostname.replace(/^www\./, "");
  } catch {
    host = rawUrl;
  }
  const h = host.toLowerCase();
  if (h.includes("github.")) return { Icon: Github, tint: "text-foreground", label: "GitHub" };
  if (h === "x.com" || h.includes("twitter.")) return { Icon: Twitter, tint: "text-sky-500", label: "X" };
  if (h.includes("youtube.") || h === "youtu.be") return { Icon: Youtube, tint: "text-red-500", label: "YouTube" };
  if (h.includes("t.me") || h.includes("telegram.")) return { Icon: Send, tint: "text-sky-500", label: "Telegram" };
  if (h.includes("fountain.fm")) return { Icon: Zap, tint: "text-amber-500", label: "Fountain" };
  // Generic host: neutral chain/link glyph that matches the other Details-row icons.
  return { Icon: LinkIcon, tint: "text-muted-foreground/60", label: null };
}

/** Clean display text for a URL: host + first path segment, no scheme/query. */
function prettyUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
    const seg = u.pathname.split("/").filter(Boolean)[0];
    const host = u.hostname.replace(/^www\./, "");
    return seg ? `${host}/${seg}` : host;
  } catch {
    return rawUrl.replace(/^https?:\/\//, "");
  }
}

export function DetailLink({ url }: { url: string }) {
  const href = url.startsWith("http") ? url : `https://${url}`;
  const { Icon, tint, label } = brandFor(url);
  // Borderless row: brand glyph in the SAME icon column as the ⚡/📅 rows, the
  // clean host/handle, and a quiet external arrow — professional, not a chip.
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="group/link flex items-center gap-2 min-w-0 text-brand hover:underline"
      data-testid="detail-link"
    >
      <Icon className={`w-3.5 h-3.5 shrink-0 ${tint}`} />
      <span className="truncate">{label ?? prettyUrl(url)}</span>
      <ExternalLink className="w-3 h-3 shrink-0 text-muted-foreground/40 group-hover/link:text-brand/60 transition-colors" />
    </a>
  );
}

const URL_RE = /(https?:\/\/[^\s]+)/g;

/** Split bio text on URLs, rendering each URL as a subtle inline link. */
export function linkifyBio(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(URL_RE);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (URL_RE.test(part)) {
      URL_RE.lastIndex = 0; // reset the global regex between tests
      out.push(
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-brand font-medium underline decoration-primary/30 underline-offset-2 hover:decoration-primary break-all"
        >
          {prettyUrl(part)}
        </a>,
      );
    } else {
      out.push(<span key={i}>{part}</span>);
    }
  }
  return out;
}
