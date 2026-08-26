import * as React from "react";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Extra classes applied to the dialog/drawer content (used for accent borders). */
  contentClassName?: string;
  /** Whether the body should scroll within the panel. Defaults to true. */
  scrollBody?: boolean;
};

/**
 * Tracks whether the viewport is below Tailwind's `md` breakpoint (768px).
 * The chat task spec calls for bottom-sheet treatment on phone-sized
 * viewports under `md`, so we use that breakpoint here.
 */
function useIsBelowMd() {
  const [isBelowMd, setIsBelowMd] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 767px)").matches;
  });

  React.useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const onChange = (e: MediaQueryListEvent) => setIsBelowMd(e.matches);
    setIsBelowMd(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isBelowMd;
}

export function ResponsiveFormPanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  contentClassName,
  scrollBody = true,
}: Props) {
  const isMobile = useIsBelowMd();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent
          className={cn(
            "glass-dialog-card max-h-[90dvh] flex flex-col",
            contentClassName,
          )}
        >
          <DrawerHeader className="text-left pb-2">
            <DrawerTitle className="text-sm font-brand tracking-wide flex items-center gap-2">
              {title}
            </DrawerTitle>
            {description ? (
              <DrawerDescription className="text-xs text-muted-foreground/60">
                {description}
              </DrawerDescription>
            ) : null}
          </DrawerHeader>
          <div
            className={cn(
              "px-4 pb-2 flex-1 min-h-0",
              scrollBody && "overflow-y-auto",
            )}
          >
            {children}
          </div>
          {footer ? (
            <DrawerFooter
              className="border-t border-border/20 pt-3"
              style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
            >
              {footer}
            </DrawerFooter>
          ) : null}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        // z-[210] (matching the mobile Drawer) lifts the panel above full-screen
        // content overlays it may be launched from — notably the channel room
        // frame at z-[60]. Without this the modal opens BEHIND that frame:
        // invisible, yet Radix's modal pointer-events lock still fires, so the
        // whole surface freezes and the list never shows (the desktop
        // "members button froze" bug). Both content and overlay must clear it.
        overlayClassName="z-[210]"
        className={cn(
          "glass-dialog-card z-[210] max-w-sm w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-4rem)] sm:max-h-[70vh] p-4 sm:p-6 flex flex-col",
          contentClassName,
        )}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm font-brand tracking-wide flex items-center gap-2">
            {title}
          </AlertDialogTitle>
          {description ? (
            <AlertDialogDescription className="text-xs text-muted-foreground/60">
              {description}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <div
          className={cn(
            "flex-1 min-h-0",
            scrollBody && "overflow-y-auto",
          )}
        >
          {children}
        </div>
        {footer ? <AlertDialogFooter>{footer}</AlertDialogFooter> : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
