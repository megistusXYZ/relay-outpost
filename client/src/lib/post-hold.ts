/**
 * The five-second hold (owner, 2026-10-11): a new post waits before it
 * leaves, with Undo on the Posted toast. No fake edit for posts; a typo is
 * caught here, and after the hold Delete is honest about what it is. Undo
 * means nothing ever left. Nothing is lost either: `flush` sends at once
 * when the page is closing.
 */
export const HOLD_MS = 5000;

export type HoldState = "holding" | "sent" | "undone";

export interface Hold {
  /** Pull the post back. True when it was still held; false once it has left. */
  undo(): boolean;
  /** Send now (the page is closing). No-op after undo or send. */
  flush(): void;
  secondsLeft(): number;
  state(): HoldState;
}

export function createHold(send: () => void, delayMs: number = HOLD_MS): Hold {
  const started = Date.now();
  let state: HoldState = "holding";
  const fire = () => {
    if (state !== "holding") return;
    state = "sent";
    clearTimeout(timer);
    send();
  };
  const timer = setTimeout(fire, delayMs);
  return {
    undo() {
      if (state !== "holding") return false;
      state = "undone";
      clearTimeout(timer);
      return true;
    },
    flush: fire,
    secondsLeft() {
      if (state !== "holding") return 0;
      return Math.max(0, Math.ceil((delayMs - (Date.now() - started)) / 1000));
    },
    state: () => state,
  };
}
