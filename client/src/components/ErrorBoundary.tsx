import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { reportCrash } from "@/lib/crash-report";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Render-prop fallback that receives the caught error (for showing details). */
  fallbackRender?: (error: Error | null) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
    // Anonymous crash report — wrapped so a reporter failure can never break
    // the fallback the user is looking at (reportCrash is also internally safe).
    try { reportCrash(error, info?.componentStack ?? undefined); } catch {}
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallbackRender) return this.props.fallbackRender(this.state.error);
      return (
        this.props.fallback ?? (
          <div
            className="flex items-center justify-center p-6"
            data-testid="error-boundary-fallback"
          >
            <p className="text-neutral-500 text-sm">
              Something went wrong loading this widget.
            </p>
          </div>
        )
      );
    }
    return this.props.children;
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
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-background p-6 text-center"
      data-testid="onboarding-error-fallback"
    >
      <p className="text-sm font-medium text-foreground">Sign-in hit a snag</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Reloading usually clears it. If it keeps happening, this detail helps us fix it:
      </p>
      <code className="max-w-sm break-words rounded bg-foreground/5 px-2 py-1 text-[10px] text-muted-foreground/80">
        {error?.message || "Unknown error"}
      </code>
      <button
        onClick={() => window.location.reload()}
        className="mt-1 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Reload
      </button>
    </div>
  );
}
