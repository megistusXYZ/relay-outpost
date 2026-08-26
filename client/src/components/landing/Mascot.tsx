// The Relay Outpost mascot — a frontier-ranger robot used as a friendly
// "companion" accent across the landing page (Discord/Wumpus style: personality
// peeking around the page, not a content block). Each pose is a transparent
// cutout living in /images/landing/mascot-<pose>.webp (+ a -sm variant for
// phones). Drop a new pose by adding it to POSES and shipping the two webp files.
//
// Structure is layered so the motion reads as "alive" without fighting itself:
//   root (ground glow)
//     └ bob   — gentle vertical float (translateY)
//         └ sway img — slight rotate, so wave/perch feel hand-animated
// All motion is disabled under prefers-reduced-motion.

export type MascotPose = "wave" | "followers" | "console" | "perch";

// Intrinsic (trimmed) pixel dimensions — used for the aspect ratio so the
// layout never shifts while the image loads.
const POSES: Record<MascotPose, { w: number; h: number; alt: string }> = {
  wave:      { w: 269, h: 352, alt: "The Relay Outpost ranger waving hello" },
  followers: { w: 180, h: 185, alt: "The Relay Outpost ranger showing off a follower count" },
  console:   { w: 254, h: 158, alt: "The Relay Outpost ranger working at a control console" },
  perch:     { w: 148, h: 283, alt: "The Relay Outpost ranger perched on the relay lines" },
};

interface MascotProps {
  pose: MascotPose;
  /** Controls the rendered width — pass Tailwind width classes (e.g. "w-[150px] md:w-[180px]"). */
  className?: string;
  /** Gentle float + sway. On by default; respects prefers-reduced-motion. */
  animated?: boolean;
  /** Soft violet glow pooled under his feet. On by default. */
  glow?: boolean;
  /** Eager-load + decode for above-the-fold use (the hero). Others lazy-load. */
  priority?: boolean;
}

export function Mascot({ pose, className = "", animated = true, glow = true, priority = false }: MascotProps) {
  const { w, h, alt } = POSES[pose];
  const base = `/images/landing/mascot-${pose}`;

  return (
    <div className={`pointer-events-none relative select-none ${className}`} aria-hidden="true">
      {glow && (
        <div
          aria-hidden
          className={`absolute left-1/2 bottom-[6%] -z-10 h-[28%] w-[80%] -translate-x-1/2 rounded-[50%] bg-brand/30 blur-2xl ${animated ? "mascot-glow motion-reduce:animate-none" : ""}`}
        />
      )}
      <div className={animated ? "mascot-bob motion-reduce:animate-none" : ""}>
        <picture>
          <source media="(max-width: 640px)" srcSet={`${base}-sm.webp`} type="image/webp" />
          <img
            src={`${base}.webp`}
            width={w}
            height={h}
            alt={alt}
            draggable={false}
            loading={priority ? "eager" : "lazy"}
            decoding={priority ? "auto" : "async"}
            className={`block h-auto w-full drop-shadow-[0_18px_22px_rgba(0,0,0,0.55)] ${animated ? "mascot-sway motion-reduce:animate-none" : ""}`}
            style={{ aspectRatio: `${w} / ${h}` }}
          />
        </picture>
      </div>
    </div>
  );
}
