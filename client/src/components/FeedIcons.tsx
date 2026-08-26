import type { ReactNode } from "react";

export type FeedIconKey =
  | "bitcoin"
  | "lightning"
  | "shield"
  | "lock"
  | "signal"
  | "flame"
  | "globe"
  | "code"
  | "relay";

interface IconProps {
  className?: string;
}

export function BitcoinIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M13.38 12.75H9C8.59 12.75 8.25 12.41 8.25 12V8.5C8.25 8.09 8.59 7.75 9 7.75H13.38C14.71 7.75 15.88 8.92 15.88 10.25C15.88 11.63 14.75 12.75 13.38 12.75ZM9.75 11.25H13.37C13.92 11.25 14.37 10.8 14.37 10.25C14.37 9.8 13.92 9.25 13.37 9.25H9.75V11.25Z" />
      <path d="M14 16.25H9C8.59 16.25 8.25 15.91 8.25 15.5V12C8.25 11.59 8.59 11.25 9 11.25H14C15.52 11.25 16.75 12.37 16.75 13.75C16.75 15.13 15.52 16.25 14 16.25ZM9.75 14.75H14C14.69 14.75 15.25 14.3 15.25 13.75C15.25 13.2 14.69 12.75 14 12.75H9.75V14.75Z" />
      <path d="M11.8 18C11.39 18 11.05 17.66 11.05 17.25V15.5C11.05 15.09 11.39 14.75 11.8 14.75C12.21 14.75 12.55 15.09 12.55 15.5V17.25C12.55 17.66 12.21 18 11.8 18Z" />
      <path d="M11.8 9.25C11.39 9.25 11.05 8.91 11.05 8.5V6.75C11.05 6.34 11.39 6 11.8 6C12.21 6 12.55 6.34 12.55 6.75V8.5C12.55 8.91 12.21 9.25 11.8 9.25Z" />
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.2" />
    </svg>
  );
}

function LightningIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M13 2L4.5 13H12L11 22L19.5 11H12L13 2Z" fill="currentColor" />
    </svg>
  );
}

function ShieldIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M12 2L3.5 6.5V11C3.5 16.25 7.08 21.15 12 22.5C16.92 21.15 20.5 16.25 20.5 11V6.5L12 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12L11 14L15 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 11V7C8 4.79 9.79 3 12 3C14.21 3 16 4.79 16 7V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="16" r="1.5" fill="currentColor" />
    </svg>
  );
}

function SignalIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <line x1="12" y1="22" x2="12" y2="11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="9" r="2" stroke="currentColor" strokeWidth="1.4" fill="currentColor" />
      <path d="M7.5 6.5C9 4.5 10.5 3.5 12 3.5S15 4.5 16.5 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M5 4.5C7.5 1.5 9.8 0.5 12 0.5S16.5 1.5 19 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="8" y1="22" x2="16" y2="22" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function FlameIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M12 2C12 2 8 7 8 12C8 14.21 9.79 16 12 16C14.21 16 16 14.21 16 12C16 7 12 2 12 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 16V22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7 20H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 12.5C10 11 12 9 12 9C12 9 14 11 14 12.5C14 13.33 13.33 14 12.5 14H11.5C10.67 14 10 13.33 10 12.5Z" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

function GlobeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.4" />
      <ellipse cx="12" cy="12" rx="4" ry="9.5" stroke="currentColor" strokeWidth="1.2" />
      <line x1="2.5" y1="9" x2="21.5" y2="9" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <line x1="2.5" y1="15" x2="21.5" y2="15" stroke="currentColor" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}

function CodeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M8 18L2 12L8 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 6L22 12L16 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 4L10 20" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

function RelayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M5.65 7.65L2.85 4.85C2.54 4.54 2.76 4 3.2 4H6.79C6.92 4 7.05 4.05 7.14 4.15L12.14 9.15C12.45 9.46 12.23 10 11.79 10H8.5C6.57 10 5 11.57 5 13.5C5 15.43 6.57 17 8.5 17H10L12.15 19.15C12.46 19.46 12.24 20 11.8 20H8.51C4.92 20 2.01 17.09 2.01 13.5C2.01 11.01 3.41 8.84 5.48 7.75L5.65 7.65Z" fill="currentColor" />
      <path d="M18.35 16.35L21.15 19.15C21.46 19.46 21.24 20 20.8 20H17.21C17.08 20 16.95 19.95 16.86 19.85L11.86 14.85C11.55 14.54 11.77 14 12.21 14H15.5C17.43 14 19 12.43 19 10.5C19 8.57 17.43 7 15.5 7H14L11.85 4.85C11.54 4.54 11.76 4 12.2 4H15.49C19.08 4 21.99 6.91 21.99 10.5C21.99 12.99 20.59 15.16 18.52 16.25L18.35 16.35Z" fill="currentColor" />
    </svg>
  );
}

const FEED_ICON_MAP: Record<FeedIconKey, (props: IconProps) => ReactNode> = {
  bitcoin: BitcoinIcon,
  lightning: LightningIcon,
  shield: ShieldIcon,
  lock: LockIcon,
  signal: SignalIcon,
  flame: FlameIcon,
  globe: GlobeIcon,
  code: CodeIcon,
  relay: RelayIcon,
};

export const FEED_ICON_LIST: FeedIconKey[] = [
  "signal",
  "bitcoin",
  "lightning",
  "shield",
  "lock",
  "flame",
  "globe",
  "code",
  "relay",
];

export function isValidFeedIconKey(key: unknown): key is FeedIconKey {
  return typeof key === "string" && key in FEED_ICON_MAP;
}

export function FeedIcon({ iconKey, className }: { iconKey: FeedIconKey; className?: string }) {
  const Component = FEED_ICON_MAP[iconKey];
  if (!Component) return null;
  return <>{Component({ className })}</>;
}

export function getFeedIconComponent(iconKey: FeedIconKey | undefined): ((props: IconProps) => ReactNode) | null {
  if (!iconKey) return null;
  return FEED_ICON_MAP[iconKey] || null;
}
