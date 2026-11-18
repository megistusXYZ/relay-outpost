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
      <div className="absolute left-6 top-0 bottom-0 w-px bg-border/60" />

      <div className="relative pl-14">
        <div className="absolute left-3.5 top-3 w-6 h-6 -ml-0.5 rounded-full bg-foreground text-background flex items-center justify-center z-10">
          <span className="text-[12px] font-semibold tabular-nums">{number}</span>
        </div>

        <div className="rounded-[20px] border border-border/60 bg-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full dark:bg-foreground/[0.05] flex items-center justify-center shrink-0">
              <Icon className="w-4.5 h-4.5 text-foreground/75" />
            </div>
            <h3 className="text-[16px] font-semibold text-foreground">{title}</h3>
          </div>

          <div className="text-[15px] text-foreground/75 leading-relaxed space-y-3">
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
