/**
 * The Relays destination: three stacked servers, each with a status light.
 * Sits under Discover's cloud in the rail — the cloud is the network you
 * read; the stack is the part of it you run. Drawn on the cloud's 48-unit
 * grid with the same stroke weight so the two read as a pair; currentColor
 * throughout so it follows the nav's active and inactive colours.
 */
export function ServerStackIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="7" y="7" width="34" height="10" rx="3" />
      <rect x="7" y="19" width="34" height="10" rx="3" />
      <rect x="7" y="31" width="34" height="10" rx="3" />
      <circle cx="13" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="13" cy="24" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="13" cy="36" r="1.5" fill="currentColor" stroke="none" />
      <path d="M27 12h8M27 24h8M27 36h8" />
    </svg>
  );
}
