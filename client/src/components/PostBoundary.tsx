/**
 * One broken post never takes a page down (owner, 2026-10-07;
 * post-boundary.test.ts). A post that fails to draw becomes one quiet line,
 * the crash is reported as any other, and the posts around it stay.
 * Every list of posts draws each one inside this.
 */
import type { ReactNode } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export function PostBoundary({ id, children }: { id: string; children: ReactNode }) {
  return (
    <ErrorBoundary
      key={id}
      fallback={
        <div className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3 text-xs text-muted-foreground" data-testid="error-post-fallback">
          This post couldn't be shown
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
