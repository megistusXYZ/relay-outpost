import type { SVGProps } from "react";

/**
 * The RelayOutpost "R" brand mark as an inline SVG.
 *
 * The two paths use `fill="currentColor"` so the mark inherits the surrounding
 * text color. That is what lets the header's theme foreground colors — and the
 * white-on-banner treatment applied by index.css — flow onto the mark without
 * any per-call overrides. Pass sizing/color via `className` (e.g. `w-8 h-8
 * text-brand dark:text-white/90`); all other SVG props are spread onto
 * the root element.
 *
 * The path `d` values + viewBox are copied verbatim from the desktop rail logo
 * (DesktopStoriesRail). The internal `<clipPath>` uses a unique id
 * (`brandmark_clip`) so it never collides with the rail's `clip0_rail_brand`
 * when both render on the same page.
 */
export function BrandMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <g clipPath="url(#brandmark_clip)">
        <path
          d="M5.64999 7.64999L2.85001 4.85001C2.54001 4.54001 2.76001 4 3.20001 4H6.79001C6.92001 4 7.05001 4.04999 7.14001 4.14999L12.14 9.14999C12.45 9.45999 12.23 10 11.79 10H8.5C6.57 10 5 11.57 5 13.5C5 15.43 6.57 17 8.5 17H10L12.15 19.15C12.46 19.46 12.24 20 11.8 20H8.51001C4.92001 20 2.01001 17.09 2.01001 13.5C2.01001 11.01 3.41001 8.84 5.48001 7.75L5.64999 7.64999Z"
          fill="currentColor"
        />
        <path
          d="M18.35 16.35L21.15 19.15C21.46 19.46 21.24 20 20.8 20H17.21C17.08 20 16.95 19.95 16.86 19.85L11.86 14.85C11.55 14.54 11.77 14 12.21 14H15.5C17.43 14 19 12.43 19 10.5C19 8.57 17.43 7 15.5 7H14L11.85 4.85001C11.54 4.54001 11.76 4 12.2 4H15.49C19.08 4 21.99 6.91 21.99 10.5C21.99 12.99 20.59 15.16 18.52 16.25L18.35 16.35Z"
          fill="currentColor"
        />
      </g>
      <defs>
        <clipPath id="brandmark_clip">
          <rect width="24" height="24" />
        </clipPath>
      </defs>
    </svg>
  );
}

export default BrandMark;
