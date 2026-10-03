import { Component, Fragment } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { reportCrash } from "@/lib/crash-report";
import { ErrorScreen } from "@/components/ErrorScreen";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Render-prop fallback that receives the caught error (for showing details). */
  fallbackRender?: (error: Error | null) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  /**
   * Bumped on every "Try again"; keys the children so the crashed subtree
   * REMOUNTS with fresh state instead of re-rendering into the same failure.
   */
  resetCount: number;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, resetCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
    // Anonymous crash report — wrapped so a reporter failure can never break
    // the fallback the user is looking at (reportCrash is also internally safe).
    try { reportCrash(error, info?.componentStack ?? undefined); } catch {}
  }

  handleReset = () => {
    this.setState((s) => ({ hasError: false, error: null, resetCount: s.resetCount + 1 }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallbackRender) return this.props.fallbackRender(this.state.error);
      return (
        this.props.fallback ?? (
          <ErrorScreen
            layout="inline"
            kind="broken"
            title="This part didn't load"
            secondary={{ label: "Try again", onClick: this.handleReset, testId: "button-error-boundary-retry" }}
            testId="error-boundary-fallback"
          />
        )
      );
    }
    // Keyed Fragment: "Try again" bumps the key, so React remounts the subtree
    // (no wrapper DOM node that could disturb the surrounding layout).
    return <Fragment key={this.state.resetCount}>{this.props.children}</Fragment>;
  }
}

/**
 * Full-screen fallback for the onboarding/sign-in surfaces, which mount OUTSIDE
 * the route error boundary — so without this an uncaught render error there blanks
 * the whole app. Shows the error detail (beta users can screenshot it) + Reload.
 */
export function OnboardingErrorFallback({ error }: { error: Error | null }) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-background"
      data-testid="onboarding-error-fallback"
    >
      <ErrorScreen
        kind="broken"
        title="Sign-in hit a snag"
        body="Reloading usually clears it. If it keeps happening, the details below help us fix it."
        primary={{ label: "Reload", onClick: () => window.location.reload() }}
        detail={error?.message || "Unknown error"}
      />
    </div>
  );
}
