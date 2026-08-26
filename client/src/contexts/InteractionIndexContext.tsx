import { createContext, useCallback, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { interactionIndexStore } from "@/lib/interaction-index-store";
import type { DerivedInteraction } from "@/lib/interaction-index";

/**
 * Owns the shared interaction read-model's lifecycle for a subtree: starts the
 * single store subscription and keeps it pointed at the logged-in viewer. The
 * store itself is a process-wide singleton, so the hooks below work even for a
 * post rendered outside any provider — this just centralizes viewer identity.
 */
const InteractionIndexContext = createContext<null | true>(null);

export function InteractionIndexProvider({ children }: { children: ReactNode }) {
  const { pubkey } = useNostrAuth();
  useEffect(() => {
    interactionIndexStore.ensureStarted();
    interactionIndexStore.setViewer(pubkey ?? null);
  }, [pubkey]);
  return <InteractionIndexContext.Provider value={true}>{children}</InteractionIndexContext.Provider>;
}

/**
 * Subscribe a component to one post's derived interaction state (reaction count,
 * the viewer's own reaction/repost/reply). Self-heals if no provider is mounted:
 * ensures the store is running and knows the current viewer.
 */
export function useInteraction(eventId: string): DerivedInteraction {
  const hasProvider = useContext(InteractionIndexContext);
  const { pubkey } = useNostrAuth();
  // Unwrapped usage (no provider in tree): keep the singleton warm + correct.
  useEffect(() => {
    if (hasProvider) return;
    interactionIndexStore.ensureStarted();
    interactionIndexStore.setViewer(pubkey ?? null);
  }, [hasProvider, pubkey]);

  const subscribe = useCallback((cb: () => void) => interactionIndexStore.subscribe(eventId, cb), [eventId]);
  const getSnapshot = useCallback(() => interactionIndexStore.getSnapshot(eventId), [eventId]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Count-only slice (reaction count) — for consumers that don't need viewer state. */
export function useInteractionCounts(eventId: string): { reactionCount: number } {
  const { reactionCount } = useInteraction(eventId);
  return { reactionCount };
}

/** Viewer-relative slice (has-liked / -reposted / -replied + my reaction). */
export function useViewerInteraction(eventId: string): Omit<DerivedInteraction, "reactionCount"> {
  const { reactionCount: _drop, ...viewer } = useInteraction(eventId);
  return viewer;
}
