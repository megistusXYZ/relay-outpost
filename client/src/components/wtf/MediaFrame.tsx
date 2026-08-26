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
      className={`overflow-hidden rounded-xl border border-brand/15 dark:border-brand/10 bg-gradient-to-br from-brand/[0.05] to-brand/[0.03] ${className}`}
    >
      {children ?? (
        <div className="aspect-[16/9] w-full flex items-center justify-center">
          {variant === "video" ? (
            <div className="w-12 h-12 rounded-full bg-brand/10 border border-brand/15 flex items-center justify-center">
              <Play className="w-5 h-5 text-brand/40 ml-0.5" />
            </div>
          ) : (
            <ImageIcon className="w-8 h-8 text-brand/25" />
          )}
        </div>
      )}
    </div>
  );
}
