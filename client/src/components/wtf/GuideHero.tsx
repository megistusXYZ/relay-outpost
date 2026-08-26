import { MediaFrame } from "./MediaFrame";

/** Hero banner slot at the top of each guide. */
export function GuideHero({
  illustration,
  imageSrc,
  imageAlt,
  className = "",
}: {
  illustration?: React.ReactNode;
  imageSrc?: string;
  imageAlt?: string;
  className?: string;
}) {
  return (
    <div className={`mt-6 mb-8 ${className}`}>
      {illustration ? (
        <MediaFrame>{illustration}</MediaFrame>
      ) : imageSrc ? (
        <MediaFrame>
          <img src={imageSrc} alt={imageAlt ?? ""} className="block w-full h-auto" />
        </MediaFrame>
      ) : (
        <MediaFrame variant="image" />
      )}
    </div>
  );
}
