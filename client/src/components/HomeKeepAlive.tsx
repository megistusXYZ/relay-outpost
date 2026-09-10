import { Component, Suspense, createRef, useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";
import { appHistoryIndex } from "@/lib/app-history";
import { captureScrollAnchor, getScrollToken } from "@/lib/scroll-restore";
import { nextHomeLayer, publishCommittedHomeLayer, type HomeInstance } from "@/lib/home-keepalive";
import { SurfaceActiveContext } from "@/contexts/SurfaceActiveContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";

/** Where the reader was, taken the instant before the layer hid. */
interface ReaderPlace {
  scrollTop: number;
  anchorId: string | null;
  /** The anchor row's top relative to the scroller's top (px). */
  anchorOffset: number;
}

interface KeeperProps {
  visible: boolean;
  /** The kept-alive instance — a new key is a different Home, never a reveal. */
  instanceKey: string;
  children: ReactNode;
}

function scroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".feed-scroll-container");
}

/**
 * Owns the layer's wrapper: hides it without destroying its layout, and holds
 * the reader's place across the hide. A class because `getSnapshotBeforeUpdate`
 * is React's designed hook for exactly this — it runs after render but BEFORE
 * the DOM mutates, the one moment the outgoing screen is still exactly what
 * the reader saw.
 */
class RevealKeeper extends Component<KeeperProps> {
  private layer = createRef<HTMLDivElement>();
  private place: ReaderPlace | null = null;

  componentDidMount() {
    this.syncInert();
  }

  getSnapshotBeforeUpdate(prev: KeeperProps): ReaderPlace | null {
    if (!prev.visible || this.props.visible || prev.instanceKey !== this.props.instanceKey) return null;
    const main = scroller();
    if (!main) return null;
    const anchor = captureScrollAnchor(main);
    return { scrollTop: main.scrollTop, anchorId: anchor?.id ?? null, anchorOffset: anchor?.offset ?? 0 };
  }

  componentDidUpdate(prev: KeeperProps, _state: unknown, snapshot: ReaderPlace | null) {
    if (prev.instanceKey !== this.props.instanceKey) this.place = null;
    if (snapshot) this.place = snapshot;
    this.syncInert();
    if (!prev.visible && this.props.visible && prev.instanceKey === this.props.instanceKey) this.reveal();
  }

  /** Imperative: React 18 has no boolean `inert` prop. */
  private syncInert() {
    const el = this.layer.current;
    if (!el) return;
    el.toggleAttribute("inert", !this.props.visible);
    if (this.props.visible) el.removeAttribute("aria-hidden");
    else el.setAttribute("aria-hidden", "true");
  }

  /**
   * Put the reader back. The rows never left the DOM, so this is one write —
   * the anchor row to its old on-screen offset — before the first paint. A
   * second pass a frame later catches a row that a frozen virtualizer
   * repositioned on reveal (only after a rotation or resize while hidden).
   */
  private reveal() {
    const place = this.place;
    this.place = null;
    const main = scroller();
    const layer = this.layer.current;
    if (!place || !main || !layer) return;
    main.scrollTop = place.scrollTop;
    const pin = () => {
      if (!place.anchorId) return;
      const row = layer.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(place.anchorId)}"]`);
      if (!row) return;
      const delta = row.getBoundingClientRect().top - main.getBoundingClientRect().top - place.anchorOffset;
      if (Math.abs(delta) >= 1) main.scrollTop += delta;
    };
    pin();
    requestAnimationFrame(pin);
  }

  render() {
    return (
      <div ref={this.layer} className={this.props.visible ? undefined : "surface-hidden"} data-home-layer="">
        {this.props.children}
      </div>
    );
  }
}

/**
 * Home, kept alive across drill-ins (lib/home-keepalive.ts decides; this
 * renders). While a page pushed ON TOP of Home is showing — a thread, a
 * profile — Home stays mounted, hidden and frozen, and Back reveals the same
 * DOM at the same place: nothing is rebuilt, so nothing can be rebuilt wrong.
 *
 * Rendered AFTER the route <Switch> output, so document-order lookups
 * (`querySelector('[data-event-id=…]')`) find the page on top first, and
 * OUTSIDE the router's per-route keyed ErrorBoundary, which remounts its whole
 * subtree whenever the route base changes.
 */
export function HomeKeepAlive({
  renderHome,
  fallback,
  errorFallback,
}: {
  renderHome: () => ReactNode;
  fallback: ReactNode;
  errorFallback: ReactNode;
}) {
  const [location] = useLocation();
  const instanceRef = useRef<HomeInstance | null>(null);
  const layer = nextHomeLayer(instanceRef.current, { path: location, token: getScrollToken(), idx: appHistoryIndex() });
  // Derived and idempotent for a given (previous instance, history point), so
  // a repeated render computes the same thing.
  instanceRef.current = layer.instance;

  useLayoutEffect(() => {
    publishCommittedHomeLayer(layer);
  });

  if (!layer.instance) return null;
  return (
    <SurfaceActiveContext.Provider value={layer.visible}>
      <RevealKeeper visible={layer.visible} instanceKey={layer.instance.key}>
        <ErrorBoundary key={layer.instance.key} fallback={errorFallback}>
          <Suspense fallback={layer.visible ? fallback : null}>{renderHome()}</Suspense>
        </ErrorBoundary>
      </RevealKeeper>
    </SurfaceActiveContext.Provider>
  );
}
