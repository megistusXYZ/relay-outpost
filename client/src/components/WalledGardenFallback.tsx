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
      <path d="M19.998 9.857A8.28 8.28 0 1 1 14.143 4.002A1.08 1.08 0 0 1 13.584 6.088A6.12 6.12 0 1 0 17.911 10.416A1.08 1.08 0 0 1 19.998 9.857Z" />
      <path d="M15.53 6.91A1.56 1.56 0 1 0 18.65 6.91A1.56 1.56 0 1 0 15.53 6.91Z" />
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
