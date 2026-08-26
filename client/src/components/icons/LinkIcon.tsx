// Custom chain/link glyph (user-provided) — the generic "website" icon in the
// profile Details section, in place of a globe. Inherits color via currentColor.
export function LinkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M7.5 18.25C3.92 18.25 1 15.33 1 11.75C1 8.17 3.92 5.25 7.5 5.25H8.25V6.75H7.5C4.74 6.75 2.5 8.99 2.5 11.75C2.5 14.51 4.74 16.75 7.5 16.75C10.26 16.75 12.5 14.51 12.5 11.75V11H14V11.75C14 15.33 11.08 18.25 7.5 18.25Z" />
      <path d="M15.75 18.5H15V17H15.75C18.64 17 21 14.64 21 11.75C21 8.86 18.64 6.5 15.75 6.5C12.86 6.5 10.5 8.86 10.5 11.75V12.5H9V11.75C9 8.03 12.03 5 15.75 5C19.47 5 22.5 8.03 22.5 11.75C22.5 15.47 19.47 18.5 15.75 18.5Z" />
    </svg>
  );
}
