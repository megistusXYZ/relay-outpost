"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { withBackClose } from "@/hooks/use-back-closable"
import { cva, type VariantProps } from "class-variance-authority"
import { OVERLAY_CLOSE_BUTTON, OverlayCloseChip } from "@/components/ui/overlay-close"
import { ignoreToastInteraction } from "@/components/ui/toast"
import { OttoMark } from "@/components/OttoMark"
import { footerMarkRect, holdMarkForSheet } from "@/lib/mark-sheet"

import { cn } from "@/lib/utils"

// Back closes an open sheet instead of navigating under it — the modal-back
// contract, inherited by every Sheet in the app (lib/modal-history.ts).
const Sheet = withBackClose(SheetPrimitive.Root, "Sheet")

const SheetTrigger = SheetPrimitive.Trigger

const SheetClose = SheetPrimitive.Close

const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "sheet-scrim fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-150 data-[state=open]:duration-200",
  {
    variants: {
      side: {
        // Edge-docked sheets get a safe-area inset by default so their content
        // clears the notch (top) / home-bar (bottom) on notched phones + PWAs.
        // These come after the base `p-6`, and cn()/tailwind-merge lets any
        // caller's own pt-/pb- override it (no double padding).
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top pt-[calc(1.5rem+env(safe-area-inset-top,0px))]",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4  border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  }
)

/** A bottom sheet that grows out of the mark instead of sliding up (index.css .sheet-from-mark). */
const MARK_SHEET =
  "sheet-from-mark fixed z-50 gap-4 bg-background p-6 shadow-lg inset-x-0 bottom-0 border-t pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]"

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  /**
   * Class for the scrim behind the sheet — the same escape hatch AlertDialog
   * already carries. The overlay is hardcoded `z-50`, which is BELOW surfaces
   * that legitimately raise themselves (the channel room frame sits above it),
   * so a sheet opened over one of those renders its scrim underneath: the panel
   * appears but nothing beneath it is dismissable, and it reads as frozen.
   * Pass `z-[60]` or higher there rather than raising the global default and
   * disturbing every other sheet in the app.
   */
  overlayClassName?: string
  /**
   * A bottom sheet that opens out of the Relay mark (owner, 2026-11-23): it
   * grows from where the footer's mark sits, and the mark becomes its close
   * control, top right. Only takes effect where that mark is on screen (a
   * phone with the pill menu); elsewhere the sheet slides up with its usual X.
   */
  fromMark?: boolean
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, children, style, overlayClassName, fromMark, onPointerDownOutside, onInteractOutside, ...props }, ref) => {
  // iOS standalone-PWA compositing fix for bottom sheets.
  //
  // On display-mode:standalone WebKit, a portaled `position: fixed`,
  // transform-animated bottom sheet can render its OWN background transparent —
  // the page behind (feed rows, watermark, colored status dots) bleeds through
  // and it reads as half-crashed. Neither the `bg-background` utility class nor a
  // negative-z backing child paints reliably in that configuration: the scroll-
  // in-transform layer promotion drops the fill.
  //
  // The proven cure (identical to the mobile sidebar drawer, sidebar.tsx) is to
  // force an explicit opaque fill onto the element's OWN dedicated compositing
  // layer — an inline background-color that beats the paint-skip, plus
  // translateZ(0) + isolation:isolate so WebKit rasterizes that fill into a GPU
  // layer that always composites. Because the fill lives on the sheet element
  // itself (paint layer 1, behind every descendant) it needs no z-index games.
  //
  // Scoped to `side="bottom"` (the affected surface: Saved/Feed options,
  // Communities, Search, Calendar); edge/side drawers manage their own fill.
  const isBottom = side === "bottom"
  // Read once, as the sheet mounts: where the footer's mark is. Null means it
  // is not on screen, and the sheet behaves as any other.
  const [markRect] = React.useState(() => (fromMark && isBottom ? footerMarkRect() : null))
  const opensFromMark = !!markRect
  // The element arrives a commit after this component mounts (the portal
  // renders its children on its second pass), so it is held in state: the
  // measuring below runs when it is really there.
  const [el, setEl] = React.useState<HTMLDivElement | null>(null)
  const setRefs = React.useCallback((node: HTMLDivElement | null) => {
    setEl(node)
    if (typeof ref === "function") ref(node)
    else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node
  }, [ref])
  React.useLayoutEffect(() => {
    if (!markRect || !el) return
    // The sheet is docked to the bottom edge, so its top is known from its
    // height even while the opening animation is scaling it.
    const top = window.innerHeight - el.offsetHeight
    el.style.setProperty("--mark-ox", `${Math.round(markRect.left + markRect.width / 2)}px`)
    el.style.setProperty("--mark-oy", `${Math.round(markRect.top + markRect.height / 2 - top)}px`)
    return holdMarkForSheet()
  }, [markRect, el])
  return (
    <SheetPortal>
      <SheetOverlay className={overlayClassName} />
      <SheetPrimitive.Content
        ref={setRefs}
        className={cn(opensFromMark ? MARK_SHEET : sheetVariants({ side }), isBottom && "isolate", className)}
        style={
          isBottom
            ? {
                backgroundColor: "hsl(var(--background))",
                transform: "translateZ(0)",
                ...(opensFromMark ? { transformOrigin: "var(--mark-ox, 50%) var(--mark-oy, 100%)" } : null),
                ...style,
              }
            : style
        }
        {...props}
        // A tap on a toast raised from this sheet (an Undo) isn't "outside".
        onPointerDownOutside={ignoreToastInteraction(onPointerDownOutside)}
        onInteractOutside={ignoreToastInteraction(onInteractOutside)}
      >
        {children}
        <SheetPrimitive.Close className={cn(OVERLAY_CLOSE_BUTTON, opensFromMark && "sheet-mark-close")} data-testid={opensFromMark ? "sheet-mark-close" : undefined}>
          {opensFromMark ? (
            // The mark itself, arrived from the corner: tapping it sends the sheet back.
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-foreground text-background shadow-[0_8px_18px_-10px_rgba(13,15,18,0.5)]">
              <OttoMark size={28} className="!size-7" role="post" />
            </span>
          ) : (
            <OverlayCloseChip />
          )}
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  )
})
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
