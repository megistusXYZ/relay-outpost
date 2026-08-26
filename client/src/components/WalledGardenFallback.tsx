import { ExternalLink } from "lucide-react";
import walledGardenImg from "../assets/images/walled-garden.webp";

interface WalledGardenFallbackProps {
  url?: string;
  type?: "video" | "image" | "audio" | "embed";
  compact?: boolean;
  dark?: boolean;
  className?: string;
}

const TYPE_LABELS: Record<string, string> = {
  video: "video",
  image: "image",
  audio: "audio",
  embed: "content",
};

function RelayOutpostGlyph({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M5.64999 7.64999L2.85001 4.85001C2.54001 4.54001 2.76001 4 3.20001 4H6.79001C6.92001 4 7.05001 4.04999 7.14001 4.14999L12.14 9.14999C12.45 9.45999 12.23 10 11.79 10H8.5C6.57 10 5 11.57 5 13.5C5 15.43 6.57 17 8.5 17H10L12.15 19.15C12.46 19.46 12.24 20 11.8 20H8.51001C4.92001 20 2.01001 17.09 2.01001 13.5C2.01001 11.01 3.41001 8.84 5.48001 7.75L5.64999 7.64999Z" />
      <path d="M18.35 16.35L21.15 19.15C21.46 19.46 21.24 20 20.8 20H17.21C17.08 20 16.95 19.95 16.86 19.85L11.86 14.85C11.55 14.54 11.77 14 12.21 14H15.5C17.43 14 19 12.43 19 10.5C19 8.57 17.43 7 15.5 7H14L11.85 4.85001C11.54 4.54001 11.76 4 12.2 4H15.49C19.08 4 21.99 6.91 21.99 10.5C21.99 12.99 20.59 15.16 18.52 16.25L18.35 16.35Z" />
    </svg>
  );
}

export function WalledGardenFallback({
  url,
  type = "video",
  compact = false,
  dark = false,
  className = "",
}: WalledGardenFallbackProps) {
  const label = TYPE_LABELS[type] || "content";

  if (compact) {
    return (
      <div
        className={`rounded-xl border overflow-hidden ${
          dark
            ? "border-white/10 bg-white/[0.04]"
            : "border-brand/15 bg-brand/[0.04]/[0.04]"
        } ${className}`}
        data-testid="walled-garden-compact"
      >
        <div className="flex items-center gap-3 px-3 py-2.5">
          <RelayOutpostGlyph
            className={`w-5 h-5 shrink-0 ${
              dark ? "text-brand/60" : "text-brand/50"
            }`}
          />
          <div className="flex-1 min-w-0">
            <p
              className={`text-xs font-medium ${
                dark ? "text-white/70" : "text-foreground/70"
              }`}
            >
              This {label} can't be shown here
            </p>
            <p
              className={`text-[10px] mt-0.5 ${
                dark ? "text-white/35" : "text-muted-foreground/50"
              }`}
            >
              It may be unavailable, or its host doesn't allow embedding
            </p>
          </div>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={`shrink-0 flex items-center gap-1 text-[11px] font-medium rounded-md px-2 py-1 transition-colors ${
                dark
                  ? "text-brand bg-brand/25 hover:bg-brand/35"
                  : "text-brand bg-brand/10 hover:bg-brand/20"
              }`}
              data-testid="link-walled-garden-open"
            >
              Open <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-xl overflow-hidden ${
        dark
          ? "bg-black"
          : "border border-brand/15"
      } ${className}`}
      style={{ aspectRatio: "16/9" }}
      data-testid="walled-garden-full"
    >
      <img
        src={walledGardenImg}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        aria-hidden="true"
      />

      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/30" />

      <div className="absolute inset-0 flex flex-col items-center justify-end p-4 pb-5 text-center">
        <RelayOutpostGlyph className="w-6 h-6 text-brand/70 mb-2" />

        <p className="text-sm sm:text-base font-brand font-semibold text-white/90 tracking-wide leading-snug">
          This content can't be shown here
        </p>

        <p className="text-[11px] text-white/40 mt-1.5 max-w-[280px] leading-relaxed">
          It may be unavailable, or its host doesn't allow embedding.
        </p>

        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-brand bg-brand/25 hover:bg-brand/35 backdrop-blur-sm border border-brand/30 rounded-lg px-3.5 py-1.5 transition-colors"
            data-testid="link-walled-garden-open"
          >
            Open in browser <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}
