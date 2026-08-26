import { MediaFrame } from "./MediaFrame";

export interface StepProps {
  number: number;
  title: string;
  description: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  /** Step has an image slot. */
  mediaBanner?: boolean;
  /** Step has a video slot. */
  mediaVideo?: boolean;
  /** A branded illustration node to fill the image slot. */
  image?: React.ReactNode;
  /** A real screenshot path (drop-in later); used if no `image`. */
  imageSrc?: string;
  imageAlt?: string;
  /** A real screencast path (drop-in later). */
  videoSrc?: string;
  poster?: string;
}

export function StepCard({
  number,
  title,
  description,
  icon: Icon,
  mediaBanner,
  mediaVideo,
  image,
  imageSrc,
  imageAlt,
  videoSrc,
  poster,
}: StepProps) {
  return (
    <div className="relative">
      <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-brand/20 via-brand/10 to-transparent" />

      <div className="relative pl-14">
        <div className="absolute left-3.5 top-3 w-5 h-5 rounded-full bg-brand/15 dark:bg-brand/20 border border-brand/25 flex items-center justify-center z-10">
          <span className="text-[9px] font-black text-brand">{number}</span>
        </div>

        <div className="rounded-xl border border-border/30 dark:border-border/15 bg-white/60 dark:bg-muted/10 p-5 transition-all duration-300 hover:border-brand/15 dark:hover:border-brand/10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand/10 to-brand/10 border border-brand/10 flex items-center justify-center shrink-0">
              <Icon className="w-4.5 h-4.5 text-brand" />
            </div>
            <h3 className="text-sm font-bold text-foreground/90">{title}</h3>
          </div>

          <div className="text-sm text-foreground/70 dark:text-muted-foreground leading-relaxed space-y-3">
            {description}
          </div>

          {mediaBanner && (
            <div className="mt-4">
              {image ? (
                <MediaFrame>{image}</MediaFrame>
              ) : imageSrc ? (
                <MediaFrame>
                  <img src={imageSrc} alt={imageAlt ?? title} className="block w-full h-auto" />
                </MediaFrame>
              ) : (
                <MediaFrame variant="image" />
              )}
            </div>
          )}

          {mediaVideo && (
            <div className="mt-4">
              {videoSrc ? (
                <MediaFrame>
                  <video src={videoSrc} poster={poster} controls playsInline className="block w-full h-auto" />
                </MediaFrame>
              ) : (
                <MediaFrame variant="video" />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
