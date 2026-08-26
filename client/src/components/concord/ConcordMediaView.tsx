/**
 * Renders one Concord media attachment. Encrypted files are fetched + decrypted
 * to a blob URL in-app (cached); public GIFs render directly. Reserves the
 * aspect ratio from `dim` so the layout doesn't jump while decrypting.
 */
import { useEffect, useState } from "react";
import { Loader2, FileWarning, Download } from "lucide-react";
import { resolveMediaUrl, isEncrypted, mediaKind, type ConcordMedia } from "@/lib/concord/concord-media";

export function ConcordMediaView({ media }: { media: ConcordMedia }) {
  const [url, setUrl] = useState<string | null>(isEncrypted(media) ? null : media.url);
  const [failed, setFailed] = useState(false);
  const kind = mediaKind(media);

  useEffect(() => {
    if (!isEncrypted(media)) { setUrl(media.url); return; }
    let cancelled = false;
    setUrl(null); setFailed(false);
    resolveMediaUrl(media).then((u) => { if (!cancelled) setUrl(u); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [media]);

  // max-w-full BEFORE the 280px clamp: on a 350px panel the message column is
  // only ~235px, and the transcript is overflow-x-hidden — so a flat 280px cut
  // the right edge off every attachment with no way to scroll to it.
  const [w, h] = (media.dim?.split("x").map(Number) ?? []) as (number | undefined)[];
  const ratio = w && h ? `${w} / ${h}` : undefined;

  if (failed) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/30 bg-muted/20 px-3 py-2 text-xs text-muted-foreground/60 max-w-full sm:max-w-[280px]">
        <FileWarning className="w-4 h-4 shrink-0" /> Couldn't load attachment
      </div>
    );
  }
  if (!url) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border/20 bg-muted/20 max-w-full sm:max-w-[280px]" style={{ aspectRatio: ratio ?? "4 / 3", width: 240 }}>
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  if (kind === "image") {
    return (
      <img src={url} alt={media.name ?? "image"} loading="lazy"
        className="rounded-lg max-w-full sm:max-w-[280px] max-h-[360px] w-auto h-auto object-contain border border-border/20"
        style={ratio ? { aspectRatio: ratio } : undefined} />
    );
  }
  if (kind === "video") {
    return <video src={url} controls playsInline className="rounded-lg max-w-full sm:max-w-[280px] max-h-[360px] border border-border/20" />;
  }
  if (kind === "audio") {
    return <audio src={url} controls className="w-full max-w-full sm:max-w-[280px]" />;
  }
  return (
    <a href={url} download={media.name ?? "file"} className="flex items-center gap-2 rounded-lg border border-border/30 bg-muted/20 px-3 py-2 text-xs hover:bg-muted/30 max-w-full sm:max-w-[280px]">
      <Download className="w-4 h-4 shrink-0 text-brand/70" />
      <span className="truncate">{media.name ?? "Download file"}</span>
    </a>
  );
}
