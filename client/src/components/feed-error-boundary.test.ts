import { describe, it, expect, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { FeedErrorBoundary, FEED_BOUNDARY_LOG_PREFIX } from "./FeedErrorBoundary";

// The vitest environment is node (no DOM), so these tests exercise the
// boundary's logic surface directly — derived state, logging contract, and the
// element trees render() returns — without mounting. The remount-on-reset and
// containment behavior are additionally verified in-browser (dev QA).

function makeBoundary(state?: Partial<{ error: Error | null; resetCount: number }>) {
  const b = new FeedErrorBoundary({ children: "feed-children", label: "home" });
  if (state) b.state = { ...b.state, ...state };
  return b;
}

/** Depth-first search of a React element tree for a predicate match. */
function findElement(node: unknown, pred: (el: ReactElement) => boolean): ReactElement | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findElement(child, pred);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (pred(node)) return node;
  return findElement((node.props as { children?: unknown }).children, pred);
}

describe("FeedErrorBoundary", () => {
  it("getDerivedStateFromError captures the error (this is what triggers the fallback)", () => {
    const err = new Error("corrupted transform");
    expect(FeedErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err });
  });

  it("componentDidCatch logs with the distinctive prefix and the surface label", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const b = makeBoundary();
      const err = new Error("boom");
      b.componentDidCatch(err, { componentStack: "\n at NostrPost" } as never);
      expect(spy).toHaveBeenCalledTimes(1);
      const [msg, loggedErr] = spy.mock.calls[0];
      expect(String(msg)).toContain(FEED_BOUNDARY_LOG_PREFIX);
      expect(String(msg)).toContain("home");
      expect(loggedErr).toBe(err);
    } finally {
      spy.mockRestore();
    }
  });

  it("renders children (keyed by resetCount) when there is no error", () => {
    const b = makeBoundary();
    const out = b.render() as ReactElement;
    expect(isValidElement(out)).toBe(true);
    expect((out.props as { children?: unknown }).children).toBe("feed-children");
    expect(out.key).toBe("0");
  });

  it("a reset bumps the key so the crashed subtree REMOUNTS (fresh state)", () => {
    const b = makeBoundary({ resetCount: 3 });
    const out = b.render() as ReactElement;
    expect(out.key).toBe("3");
  });

  it("renders the compact fallback card — not the children — when an error is held", () => {
    const b = makeBoundary({ error: new Error("stale translateY") });
    const out = b.render();
    const card = findElement(out, (el) => (el.props as Record<string, unknown>)["data-testid"] === "feed-error-boundary");
    expect(card).not.toBeNull();
    // the crashed children must NOT be in the tree (containment)
    expect(findElement(out, (el) => (el.props as { children?: unknown }).children === "feed-children")).toBeNull();
    // the error detail is surfaced for screenshots
    expect(findElement(out, (el) => (el.props as { children?: unknown }).children === "stale translateY")).not.toBeNull();
  });

  it("the fallback's reset button is wired to the boundary's reset handler", () => {
    const b = makeBoundary({ error: new Error("boom") });
    const out = b.render();
    const button = findElement(
      out,
      (el) => (el.props as Record<string, unknown>)["data-testid"] === "button-feed-boundary-reset"
    );
    expect(button).not.toBeNull();
    expect((button!.props as { onClick?: unknown }).onClick).toBe(b.handleReset);
  });

  it("handleReset clears the error and increments resetCount", () => {
    const b = makeBoundary({ error: new Error("boom"), resetCount: 1 });
    // Drive the state transition without a React updater (node env): apply the
    // functional setState updater directly.
    let nextState: unknown;
    (b as unknown as { setState: (fn: unknown) => void }).setState = (fn: unknown) => {
      nextState = (fn as (s: typeof b.state) => unknown)(b.state);
    };
    b.handleReset();
    expect(nextState).toEqual({ error: null, resetCount: 2 });
  });
});
