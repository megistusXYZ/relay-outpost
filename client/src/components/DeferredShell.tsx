import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Loads app-shell overlays nobody sees at launch (create studio, orbit menu,
 * composer, feedback drawer) after the first screen instead of before it:
 * once the app is idle, or at once when something asks to open one.
 *
 * They open through window events fired from anywhere. While they aren't
 * mounted yet, this listens for those events itself, and replays each one
 * after the overlays have mounted and attached their own listeners, so an
 * early open is never lost.
 */
export function DeferredShell({
  events,
  idleMs = 2500,
  children,
}: {
  /** The window events that open these overlays. */
  events: readonly string[];
  /** Upper bound on waiting for the browser to go idle. */
  idleMs?: number;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const queue = useRef<Array<{ type: string; detail: unknown }>>([]);

  useEffect(() => {
    if (mounted) return;
    const capture = (e: Event) => {
      queue.current.push({ type: e.type, detail: (e as CustomEvent).detail });
      setMounted(true);
    };
    for (const t of events) window.addEventListener(t, capture);
    const ric = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const cic = (window as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
    const idle = ric ? ric(() => setMounted(true), { timeout: idleMs }) : undefined;
    const timer = setTimeout(() => setMounted(true), idleMs);
    return () => {
      for (const t of events) window.removeEventListener(t, capture);
      if (idle !== undefined) cic?.(idle);
      clearTimeout(timer);
    };
    // `events` is a constant list per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, idleMs]);

  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      {children}
      {/* Last in the boundary: its effect runs after the overlays' own. */}
      <Replay queue={queue} />
    </Suspense>
  );
}

function Replay({ queue }: { queue: { current: Array<{ type: string; detail: unknown }> } }) {
  useEffect(() => {
    const pending = queue.current;
    queue.current = [];
    for (const { type, detail } of pending) window.dispatchEvent(new CustomEvent(type, { detail }));
  }, [queue]);
  return null;
}
