import { X } from "lucide-react"

/**
 * The close control shared by dialogs and sheets. It has to be findable on top
 * of whatever the overlay shows, photos included: the dark translucent chip
 * gives contrast on light images, its light hairline ring and white icon on
 * dark ones. The button around it is the 44px tap target. It must stay the
 * content's last child button (ZapDialog hides it with
 * `[&>button:last-child]:hidden`). See overlay-close.test.ts.
 */
export const OVERLAY_CLOSE_BUTTON =
  "group absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full outline-none disabled:pointer-events-none"

export function OverlayCloseChip() {
  return (
    <span
      data-close-chip
      className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/35 shadow-[0_1px_6px_rgba(0,0,0,0.45)] backdrop-blur-sm transition-colors group-hover:bg-black/75 group-focus-visible:ring-2 group-focus-visible:ring-white"
    >
      <X className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
    </span>
  )
}
