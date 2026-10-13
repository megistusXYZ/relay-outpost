/**
 * The article body, hardened against a DOM altered outside React (crash
 * report 2026-10-13: "insertBefore … not a child of this node" on an article
 * page; browser page translation wraps text nodes in <font>, and a re-render
 * that inserts a node then fails). Two guards, proven in
 * article-body.test.ts:
 *   - the body is keyed by the article version, so a newer version replaces
 *     the whole body instead of diffing a DOM it no longer owns;
 *   - RedrawOnce draws the body again from scratch when a draw throws, and
 *     a second failure reaches the outer boundary's quiet line.
 */
import { Component, type ReactNode } from "react";
import { ArticleMarkdown } from "@/components/ArticleMarkdown";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { reportCrash } from "@/lib/crash-report";

export function ArticleBody({ versionId, content }: { versionId: string; content: string }) {
  return (
    <ErrorBoundary
      key={versionId}
      fallback={
        <div className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3 text-xs text-muted-foreground" data-testid="error-post-fallback">
          This article couldn't be shown. Reload the page to try again.
        </div>
      }
    >
      <RedrawOnce>
        <ArticleMarkdown content={content} />
      </RedrawOnce>
    </ErrorBoundary>
  );
}

/**
 * Draws its children again from a clean DOM the first time a draw throws.
 * If that fresh draw throws too, the error goes on to the boundary above.
 */
export class RedrawOnce extends Component<{ children: ReactNode }, { failed: boolean; redrawn: boolean; error: Error | null }> {
  state = { failed: false, redrawn: false, error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { failed: true, error }; }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    try { reportCrash(error, info?.componentStack ?? undefined); } catch {}
    if (!this.state.redrawn) this.setState({ redrawn: true, failed: false, error: null });
  }
  render() {
    if (this.state.failed && this.state.redrawn && this.state.error) throw this.state.error;
    return <div key={this.state.failed || this.state.redrawn ? "redrawn" : "first"}>{this.props.children}</div>;
  }
}
