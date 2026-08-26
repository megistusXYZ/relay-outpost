import { useEffect, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import {
  applyUpdate,
  dismissUpdate,
  getAppUpdateState,
  startAppUpdatePolling,
  subscribeAppUpdate,
} from "@/lib/app-update";

/**
 * "Update ready · Restart" — a small, calm, dismissible pill that appears
 * ONLY when a new build is confirmed available (a waiting/updated service
 * worker, or /api/version differing from this bundle's stamped version).
 *
 * Mounted once in App.tsx alongside the other global chrome. Sits above the
 * mobile footer nav (z-50, bottom-0) and never overlaps it; on desktop the
 * footer is hidden so it hugs the bottom. Restart is user-initiated, so the
 * immediate reload is exempt from main.tsx's deferred-reload contract.
 */
export function UpdateReadyPill() {
  const state = useSyncExternalStore(subscribeAppUpdate, getAppUpdateState);

  // Idempotent — arms the visibility-driven /api/version poll (prod only).
  // The SW-side signals are wired from main.tsx on the existing registration.
  useEffect(() => {
    startAppUpdatePolling();
  }, []);

  if (!state.ready) return null;

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-50 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:bottom-6"
      role="status"
      data-testid="pill-update-ready"
    >
      <div className="flex items-center gap-0.5 rounded-full border border-border dark:border-brand/25 bg-background/95 backdrop-blur-md shadow-lg dark:shadow-[0_4px_20px_rgba(0,0,0,0.45)] pl-3.5 pr-1 py-1">
        <span className="text-xs text-foreground/80 whitespace-nowrap">Update ready</span>
        <span className="text-muted-foreground/40 px-1" aria-hidden>
          ·
        </span>
        <button
          type="button"
          onClick={() => applyUpdate()}
          className="text-xs font-semibold text-brand px-2 h-8 rounded-full hover:bg-brand/10 transition-colors cursor-pointer"
          data-testid="button-update-restart"
        >
          Restart
        </button>
        <button
          type="button"
          onClick={() => dismissUpdate()}
          aria-label="Dismiss update notice"
          className="w-8 h-8 flex items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
          data-testid="button-update-dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
