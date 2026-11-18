/**
 * Icons for the Relays welcome, drawn in the app's own hand rather than
 * borrowed from a generic set: single-weight line art on a 24-unit grid, no
 * tiles or fills (owner, 2026-10-03: "we don't need all the square
 * containers around the icons"), theme colours only — light and dark alike.
 */
import { OttoMark } from "@/components/OttoMark";

type IconProps = { className?: string };
const base = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };


/**
 * The hero: the R mark, lit — a sheen across it from the top, a soft brand
 * glow behind, a shadow beneath that lifts it off the page, and one fine ring
 * a slow light travels around. Calm when the reader has asked for less motion.
 */
export function HomeRing({ size = 132 }: { size?: number }) {
  const ring = Math.round(size * 0.86);
  const mark = Math.round(size * 0.34);
  return (
    <div className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size }} aria-hidden="true" data-testid="relays-home-ring">
      {/* the glow, wide and soft */}
      <div className="absolute -inset-8 rounded-full bg-[radial-gradient(closest-side,hsl(var(--brand)/0.30),hsl(var(--brand)/0.08)_55%,transparent)] blur-xl" />
      {/* a faint full ring… */}
      <div className="absolute rounded-full border border-brand/15 dark:border-white/[0.07]" style={{ width: ring, height: ring }} />
      {/* …and the light travelling around it */}
      <div
        className="absolute rounded-full p-[1.5px] motion-safe:animate-[spin_14s_linear_infinite] [-webkit-mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)] [-webkit-mask-composite:xor] [mask:linear-gradient(#000_0_0)_content-box_exclude,linear-gradient(#000_0_0)] bg-[conic-gradient(from_0deg,transparent_0deg,transparent_170deg,hsl(var(--brand)/0.25)_250deg,hsl(var(--brand))_320deg,hsl(0_0%_100%/0.9)_340deg,transparent_360deg)]"
        style={{ width: ring, height: ring }}
      />
      {/* a glass disc the mark sits on: a lit top edge, a soft brand shadow below */}
      <div
        className="absolute rounded-full border border-white/70 dark:border-white/[0.08] bg-[radial-gradient(circle_at_50%_25%,hsl(0_0%_100%/0.9),hsl(0_0%_100%/0.55)_60%)] dark:bg-[radial-gradient(circle_at_50%_25%,hsl(var(--brand)/0.20),hsl(0_0%_100%/0.02)_70%)] shadow-[0_22px_44px_-20px_hsl(var(--brand)/0.65),inset_0_1px_0_hsl(0_0%_100%/0.9)] dark:shadow-[0_22px_44px_-18px_hsl(var(--brand)/0.55),0_8px_20px_-10px_rgba(0,0,0,0.6),inset_0_1px_0_hsl(0_0%_100%/0.12)]"
        style={{ width: Math.round(size * 0.66), height: Math.round(size * 0.66) }}
      />
      {/* Otto, with the app's mood (components/OttoMark) */}
      <OttoMark
        size={mark}
        className="relative text-foreground [filter:drop-shadow(0_0_16px_hsl(var(--brand)/0.45))_drop-shadow(0_10px_16px_rgba(0,0,0,0.35))]"
      />
    </div>
  );
}

/** Hosted for you: a cloud carrying a small spark. */
export function HostedIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M7.5 18.5h9.25a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 6.9 9.6 4.5 4.5 0 0 0 7.5 18.5Z" />
      <path d="M12 10.25v3.5M10.25 12h3.5" />
    </svg>
  );
}

/** Run it yourself: your own server, its light on. */
export function SelfHostIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4" y="4.5" width="16" height="6.5" rx="2" />
      <rect x="4" y="13" width="16" height="6.5" rx="2" />
      <path d="M7.5 7.75h.01M7.5 16.25h.01" strokeWidth="2.4" />
      <path d="M12 7.75h4.5M12 16.25h4.5" />
    </svg>
  );
}

/** Connect one you have: two rings joined. */
export function ConnectIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="9" cy="12" r="5" />
      <circle cx="15" cy="12" r="5" />
    </svg>
  );
}

/** Your members, your rules: a shield with a person. */
export function RulesIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3.5 5 6.25v5.1c0 4.3 2.9 7.6 7 9.15 4.1-1.55 7-4.85 7-9.15v-5.1L12 3.5Z" />
      <circle cx="12" cy="10.25" r="2" />
      <path d="M8.75 15.5a3.6 3.6 0 0 1 6.5 0" />
    </svg>
  );
}

/** Moderate from your phone. */
export function PhoneIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="6.5" y="3" width="11" height="18" rx="2.6" />
      <path d="M10.5 18h3" />
      <path d="m9.75 10.75 1.6 1.6 3-3.1" />
    </svg>
  );
}

/** Yours to keep: two arrows trading places. */
export function KeepIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M7.5 10h9l-2.5-2.5M16.5 14h-9l2.5 2.5" />
    </svg>
  );
}
