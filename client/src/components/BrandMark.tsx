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
          d="M19.998 9.857A8.28 8.28 0 1 1 14.143 4.002A1.08 1.08 0 0 1 13.584 6.088A6.12 6.12 0 1 0 17.911 10.416A1.08 1.08 0 0 1 19.998 9.857Z"
          fill="currentColor"
        />
        <path
          d="M15.53 6.91A1.56 1.56 0 1 0 18.65 6.91A1.56 1.56 0 1 0 15.53 6.91Z"
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
