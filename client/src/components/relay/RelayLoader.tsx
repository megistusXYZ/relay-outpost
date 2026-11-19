import { useEffect, useRef, useState } from "react";
import { loaderMounted } from "@/lib/otto-busy";
import { RelayLogo } from "./RelayLogo";

/** One turn of the ring, in ms. Must match `rl-work` in relay-logo.css. */
export const RELAY_LAP_MS = 900;

export type RelayWorkPhase = "idle" | "work" | "done";

/**
 * Turns a loading flag into a phase for the logo.
 *
 * - Nothing shows for the first `delayMs`, so a fast load never flashes a loader.
 * - When loading ends, the ring finishes its current turn before it stops, so
 *   it never snaps back mid-rotation.
 */
export function useRelayWork(loading: boolean, delayMs = 300): RelayWorkPhase {
  const [phase, setPhase] = useState<RelayWorkPhase>("idle");
  const startedAt = useRef(0);

  useEffect(() => {
    if (loading) {
      const t = setTimeout(() => {
        startedAt.current = Date.now();
        setPhase("work");
      }, delayMs);
      return () => clearTimeout(t);
    }
    if (!startedAt.current) return;
    const elapsed = Date.now() - startedAt.current;
    const left = (RELAY_LAP_MS - (elapsed % RELAY_LAP_MS)) % RELAY_LAP_MS;
    const t = setTimeout(() => {
      startedAt.current = 0;
      setPhase("done");
    }, left);
    return () => clearTimeout(t);
  }, [loading, delayMs]);

  return phase;
}

export interface RelayLoaderProps {
  loading: boolean;
  size?: number;
  /** Read out by screen readers while loading. */
  label?: string;
  delayMs?: number;
  /** Keep the logo on screen (as the icon) when not loading. */
  persist?: boolean;
  className?: string;
}

/** Drop-in replacement for a spinner. */
export function RelayLoader({
  loading,
  size = 20,
  label = "Loading",
  delayMs = 300,
  persist = false,
  className,
}: RelayLoaderProps) {
  const phase = useRelayWork(loading, delayMs);
  const working = phase === "work";
  // A ring on screen tells the logo in the app's chrome that the app is busy, as the older loaders do.
  useEffect(() => (working ? loaderMounted() : undefined), [working]);
  // Once the turn is finished the loader is gone, unless it was asked to stay as the icon.
  if (!working && !persist) return null;
  return (
    <span role="status" aria-live="polite" className={className}>
      <RelayLogo state={working ? "work" : "icon"} size={size} label={working ? label : ""} />
    </span>
  );
}
