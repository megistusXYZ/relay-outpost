// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression for the live profile-page crash (React #300, "Rendered fewer
// hooks than expected. This may be caused by an accidental early return
// statement."): the deployed build at 9ae9cfd had InlineAudio's dead-link
// early return ABOVE the `hasRichCredit` useMemo. A post with a broken audio
// attachment mounted normally (15 hooks), then the <audio> element's onError
// fired setError(true) and the re-render bailed out early — one hook short —
// crashing every post list that rendered the note (Profile, feed, outposts).
// e66e21a hoisted the hooks above the return; today only a NOTE comment guards
// the ordering. This test locks the invariant mechanically.
//
// Harness: node-only, no DOM. React's hook functions are mocked with recorders
// (state/refs/memos still produce usable values), so the REAL component
// function can be invoked directly — once per state of the world — and the
// recorded hook sequences compared. If any hook ever moves behind the
// error/exhausted early return again, the sequences diverge and this fails.

const hookCalls: string[] = [];

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => {
      hookCalls.push("useState");
      return [typeof init === "function" ? (init as () => unknown)() : init, () => {}];
    },
    useRef: (init: unknown) => {
      hookCalls.push("useRef");
      return { current: init };
    },
    useMemo: (factory: () => unknown) => {
      hookCalls.push("useMemo");
      return factory();
    },
    useCallback: (fn: unknown) => {
      hookCalls.push("useCallback");
      return fn;
    },
    useEffect: () => {
      hookCalls.push("useEffect");
      // Effects never run during render — recording the slot is the point.
    },
    useContext: (ctx: unknown) => {
      hookCalls.push("useContext");
      return actual.useContext(ctx as Parameters<typeof actual.useContext>[0]);
    },
  };
});

// Controls the `heal.exhausted` flag InlineAudio's early return keys on
// (`if (error || heal.exhausted) return <a/>`). Flipping it exercises the
// exact branch the broken-audio crash took, without index-coupling to which
// useState holds `error`.
let mockExhausted = false;
vi.mock("@/hooks/use-blossom-heal", () => ({
  useBlossomHeal: (src: string) => ({
    src,
    exhausted: mockExhausted,
    onError: () => {},
  }),
}));

// The real hook is a bare useContext whose default is null — stub the module
// so the component gets working handoff callbacks without a provider tree.
vi.mock("@/contexts/PersistentMediaContext", () => ({
  usePersistentMedia: () => ({
    handoffAudio: () => {},
    claimAudio: () => null,
    handoffVideo: () => {},
    claimVideo: () => null,
  }),
}));

// ArtistCredit drags in ZapDialog and wallet machinery — irrelevant here, and
// never invoked anyway (it only appears as a JSX element type).
vi.mock("@/components/ArtistCredit", () => ({
  ArtistCredit: () => null,
}));

import { InlineAudio, type InlineAudioProps } from "./InlineAudio";

type AnyElement = { type: unknown } | null;

function renderPass(props: InlineAudioProps): { calls: string[]; el: AnyElement } {
  hookCalls.length = 0;
  const el = InlineAudio(props) as AnyElement;
  return { calls: [...hookCalls], el };
}

const PROPS: InlineAudioProps = {
  src: "https://media.example/broken-track.mp3",
  title: "A Track",
  artist: "Somebody",
  credit: { artist: "Somebody" } as InlineAudioProps["credit"],
};

beforeEach(() => {
  mockExhausted = false;
});

describe("InlineAudio hook order across the dead-audio early return (React #300 regression)", () => {
  it("renders the player normally when the source is healthy", () => {
    const { el, calls } = renderPass(PROPS);
    expect(el?.type).toBe("div");
    expect(calls.length).toBeGreaterThan(0);
  });

  it("calls the exact same hook sequence when the dead-link fallback renders", () => {
    const healthy = renderPass(PROPS);
    mockExhausted = true;
    const dead = renderPass(PROPS);
    // Prove the early-return branch actually ran (guards against a vacuous pass).
    expect(dead.el?.type).toBe("a");
    // The crash: the dead render used to skip the trailing useMemo. Hook
    // sequences must be identical no matter which branch returns.
    expect(dead.calls).toEqual(healthy.calls);
  });
});
