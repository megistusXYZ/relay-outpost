import { Image as ImageIcon, Play } from "lucide-react";

/**
 * Shared 16:9 branded frame for guide media. Renders real media or an
 * illustration when given children; otherwise a clean empty/poster state
 * (a small muted icon — no dev-style "placeholder" text).
 */
export function MediaFrame({
  children,
  variant = "image",
  className = "",
}: {
  children?: React.ReactNode;
  variant?: "image" | "video";
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[16px] border border-border/60 bg-foreground/[0.03] ${className}`}
    >
      {children ?? (
        <div className="aspect-[16/9] w-full flex items-center justify-center">
          {variant === "video" ? (
            <div className="w-12 h-12 rounded-full bg-foreground/[0.06] border border-border/60 flex items-center justify-center">
              <Play className="w-5 h-5 text-foreground/70 ml-0.5" />
            </div>
          ) : (
            <ImageIcon className="w-8 h-8 text-foreground/70" />
          )}
        </div>
      )}
    </div>
  );
}
