import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { reportCrash } from "@/lib/crash-report";
import { ErrorScreen } from "@/components/ErrorScreen";
import { reloadOntoFreshShell } from "@/lib/sw-shell";

type SplashWindow = {
  __roHideSplash?: () => void;
  __roCss?: Promise<void>;
};

/**
 * Lift the launch screen so the crash screen under it can be seen. The splash
 * normally lifts when the first page is ready (lib/launch-handoff.ts); a crash
 * above the router means that moment never comes, and the splash would sit
 * over a blank page until its own 9 s "taking longer" prompt.
 *
 * Waits for the app stylesheet when it is still arriving (production loads it
 * without blocking paint), capped, so the screen it reveals is styled.
 */
export function hideSplashForCrash(
  w: SplashWindow | undefined = typeof window !== "undefined" ? (window as SplashWindow) : undefined,
  capMs = 1500,
): void {
  if (!w) return;
  let done = false;
  const hide = () => {
    if (done) return;
    done = true;
    try { w.__roHideSplash?.(); } catch {}
  };
  const css = w.__roCss;
  if (!css) return hide();
  css.then(hide, hide);
  setTimeout(hide, capMs);
}

interface State {
  error: Error | null;
  reloading: boolean;
}

/**
 * The last line: wraps the whole app in main.tsx, so a render crash anywhere
 * above the route boundary (a provider, the shell) shows a calm screen with a
 * Reload instead of a blank page.
 */
export class RootErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  /** Reload onto the newest page, so a crash in a stale build doesn't come straight back. */
  handleReload = () => {
    this.setState({ reloading: true });
    void reloadOntoFreshShell();
  };

  componentDidCatch(error: Error, info: ErrorInfo) {
    try { console.error("[root-boundary] app crashed:", error, info?.componentStack ?? ""); } catch {}
    // Same anonymous report the other boundaries send; never allowed to throw.
    try { reportCrash(error, info?.componentStack ?? undefined); } catch {}
    hideSplashForCrash();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex min-h-[100dvh] w-full items-center justify-center bg-background text-foreground">
        <ErrorScreen
          kind="broken"
          title="Something stopped working"
          body="Reload to get going again. Your posts and messages are safe on the relays."
          primary={{
            label: this.state.reloading ? "Reloading…" : "Reload",
            onClick: this.handleReload,
            disabled: this.state.reloading,
            testId: "button-app-crash-reload",
          }}
          detail={error.message || "Unknown error"}
          testId="app-crash"
        />
      </div>
    );
  }
}
