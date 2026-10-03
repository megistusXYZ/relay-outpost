/**
 * Icons for the Relays welcome, drawn in the app's own hand rather than
 * borrowed from a generic set: single-weight line art on a 24-unit grid, no
 * tiles or fills (owner, 2026-10-03: "we don't need all the square
 * containers around the icons"), theme colours only — light and dark alike.
 */
import type { CSSProperties } from "react";
import { BrandMark } from "@/components/BrandMark";

type IconProps = { className?: string };
const base = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

/** The hero: the R mark at the centre of a fine orbit and its eight lit dots — your corner of the network. */
export function HomeRing({ size = 120 }: { size?: number }) {
  const r = size * 0.42;
  const dot = Math.max(4, Math.round(size / 24));
  return (
    <div className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size }} aria-hidden="true" data-testid="relays-home-ring">
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(closest-side,hsl(var(--brand)/0.18),transparent)]" />
      <div className="absolute rounded-full border border-brand/20" style={{ width: r * 2, height: r * 2 }} />
      {Array.from({ length: 8 }, (_, i) => {
        const style: CSSProperties = {
          width: dot, height: dot, marginLeft: -dot / 2, marginTop: -dot / 2,
          transform: `rotate(${i * 45}deg) translateY(-${r}px)`,
          animationDelay: `${i * 70}ms`,
        };
        return <i key={i} className="absolute left-1/2 top-1/2 rounded-full bg-brand shadow-[0_0_8px_hsl(var(--brand)/0.6)] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-700 motion-safe:fill-mode-both" style={style} />;
      })}
      <BrandMark className="relative text-brand drop-shadow-[0_0_14px_hsl(var(--brand)/0.45)]" style={{ width: size * 0.34, height: size * 0.34 }} />
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
