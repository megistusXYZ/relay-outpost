import { Component, Fragment } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { reportCrash } from "@/lib/crash-report";

/**
 * Distinctive console prefix for every error this boundary catches — grep for
 * it in remote-device logs / screenshots when debugging feed crashes.
 */
export const FEED_BOUNDARY_LOG_PREFIX = "[feed-boundary]";

interface Props {
  children: ReactNode;
  /** Which feed surface this guards — included in the console log. */
  label?: string;
}

interface State {
  error: Error | null;
  /**
   * Bumped on every reset; keys the children Fragment so "tap to reload feed"
   * REMOUNTS the crashed subtree (fresh component state) instead of re-rendering
   * the same broken tree into the same broken state.
   */
  resetCount: number;
}

/**
 * Containment vessel for the feed surfaces (Home lanes, Saved lanes, media
 * mosaics). A render crash inside a post card or the virtualizer must never
 * propagate above the feed — historically it unmounted the whole route shell,
 * taking the menu and nav down with it (the "app breaks" half of the iOS
 * glitch reports). Catches the error, logs it with a distinctive prefix, and
 * shows a compact retry card; the rest of the app keeps working.
 */
export class FeedErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetCount: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    try {
      console.error(
        `${FEED_BOUNDARY_LOG_PREFIX} feed render crashed (${this.props.label ?? "feed"}):`,
        error,
        info?.componentStack ?? ""
      );
    } catch {}
    // Anonymous crash report — separate try/catch so it can never break the
    // console log above or the retry-card fallback below.
    try { reportCrash(error, info?.componentStack ?? undefined); } catch {}
  }

  handleReset = () => {
    this.setState((s) => ({ error: null, resetCount: s.resetCount + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <div
          className="glass-card rounded-lg flex flex-col items-center justify-center gap-2 py-10 px-4 text-center"
          data-testid="feed-error-boundary"
        >
          <p className="text-sm font-medium">Something broke in the feed</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            The rest of the app is fine — tap below to reload just the feed.
          </p>
          <code className="max-w-xs break-words rounded bg-foreground/5 px-2 py-1 text-[10px] text-muted-foreground/70">
            {this.state.error.message || "Unknown error"}
          </code>
          <button
            onClick={this.handleReset}
            className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
            data-testid="button-feed-boundary-reset"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            Reload feed
          </button>
        </div>
      );
    }
    // Keyed Fragment: reset → new key → React discards and remounts the whole
    // feed subtree (no stray wrapper DOM node that could disturb feed layout).
    return <Fragment key={this.state.resetCount}>{this.props.children}</Fragment>;
  }
}
