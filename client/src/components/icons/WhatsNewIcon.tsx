/** "What's new" mark — a checklist with a check sweep. Uses currentColor so it
 *  inherits the surrounding text color. Size via className (e.g. "w-4 h-4"). */
export function WhatsNewIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M22.56 12.8199L22 13.3199L14.29 20.3199L13.7 20.8599L13.2 20.2399L9.91 16.1299L9.45 15.5399L10.62 14.6099L11.09 15.1899L13.88 18.6699L21.55 11.7099L22.56 12.8199Z" />
      <path d="M11.4 4.91992H1.5V6.41992H11.4V4.91992Z" />
      <path d="M11.4 10.3999H1.5V11.8999H11.4V10.3999Z" />
      <path d="M7.06 15.8799H1.5V17.3799H7.06V15.8799Z" />
    </svg>
  );
}
