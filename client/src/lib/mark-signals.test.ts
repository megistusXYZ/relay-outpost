/**
 * What Relay's face shows, and why (owner grill, 2026-11-18): the mark moves
 * only for a reason, and when several things are true at once, problems come
 * first: connection lost > a call ringing > something new arriving >
 * sending/loading > the finished smile > idle. The New-post button's mark
 * speaks only about your post, and never smiles for one that didn't go.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logoMood, postMood, setPostStatus, getPostStatus, subscribePostStatus, followSend, holdSend, watchConnection, getConnectionLost } from "./mark-signals";

const calm = { awake: true, lost: false, ringing: false, arrived: false, attention: false, working: false, justDone: false, hover: false };

describe("the logo's face", () => {
  it("is calm when nothing is happening, and dozes when the person is away", () => {
    expect(logoMood(calm)).toBe("here");
    expect(logoMood({ ...calm, awake: false })).toBe("rest");
  });

  it("puts problems first: a lost connection beats everything else", () => {
    expect(logoMood({ ...calm, lost: true, ringing: true, arrived: true, attention: true, working: true, justDone: true, hover: true })).toBe("worry");
    // …even while the person is away: they should see it the moment they look.
    expect(logoMood({ ...calm, lost: true, awake: false })).toBe("worry");
  });

  it("then a ringing call, then something that just arrived", () => {
    expect(logoMood({ ...calm, ringing: true, arrived: true, working: true, justDone: true })).toBe("ask");
    expect(logoMood({ ...calm, arrived: true, working: true, justDone: true })).toBe("ask");
  });

  it("then loading, then the finished smile, then what is still waiting", () => {
    expect(logoMood({ ...calm, working: true, justDone: true, attention: true })).toBe("work");
    expect(logoMood({ ...calm, justDone: true, attention: true })).toBe("done");
    expect(logoMood({ ...calm, hover: true, attention: true })).toBe("done");
    expect(logoMood({ ...calm, attention: true })).toBe("ask");
  });
});

describe("the New-post button's face", () => {
  it("speaks only about your post", () => {
    expect(postMood({ awake: true, status: "idle", hover: false })).toBe("here");
    expect(postMood({ awake: true, status: "waiting", hover: false })).toBe("wait");
    expect(postMood({ awake: true, status: "sending", hover: false })).toBe("work");
    expect(postMood({ awake: true, status: "sent", hover: false })).toBe("done");
    expect(postMood({ awake: true, status: "failed", hover: false })).toBe("worry");
  });

  it("never smiles for a post that didn't go, even under the pointer", () => {
    expect(postMood({ awake: true, status: "failed", hover: true })).toBe("worry");
    expect(postMood({ awake: true, status: "waiting", hover: true })).toBe("wait");
    expect(postMood({ awake: true, status: "sending", hover: true })).toBe("work");
  });

  it("smiles under the pointer when idle, and dozes when the person is away", () => {
    expect(postMood({ awake: true, status: "idle", hover: true })).toBe("done");
    expect(postMood({ awake: false, status: "idle", hover: false })).toBe("rest");
    // A post in flight keeps its face even if the person looks away.
    expect(postMood({ awake: false, status: "sending", hover: false })).toBe("work");
  });
});

describe("the post status", () => {
  beforeEach(() => { vi.useFakeTimers(); setPostStatus("idle"); });
  afterEach(() => { vi.useRealTimers(); });

  it("tells its listeners, and only when it changes", () => {
    const heard = vi.fn();
    const off = subscribePostStatus(heard);
    setPostStatus("waiting"); setPostStatus("waiting"); setPostStatus("sending");
    expect(heard).toHaveBeenCalledTimes(2);
    off();
  });

  it("lets the smile pass after a moment", () => {
    setPostStatus("sent");
    expect(getPostStatus()).toBe("sent");
    vi.advanceTimersByTime(1600);
    expect(getPostStatus()).toBe("idle");
  });

  it("keeps the concern until a retry, or lets it go after a while", () => {
    setPostStatus("failed");
    vi.advanceTimersByTime(5000);
    expect(getPostStatus()).toBe("failed");
    setPostStatus("sending"); // a retry
    expect(getPostStatus()).toBe("sending");
    setPostStatus("failed");
    vi.advanceTimersByTime(16000);
    expect(getPostStatus()).toBe("idle");
  });
});

describe("following one real send", () => {
  beforeEach(() => { vi.useFakeTimers(); setPostStatus("idle"); });
  afterEach(() => { vi.useRealTimers(); });
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

  it("thinks while the post is out, and smiles only once a relay took it", async () => {
    let answer!: (ok: boolean) => void;
    followSend(new Promise<boolean>((r) => { answer = r; }));
    expect(getPostStatus()).toBe("sending");
    answer(true); await settle();
    expect(getPostStatus()).toBe("sent");
  });

  it("shows concern when no relay took it", async () => {
    followSend(Promise.resolve(false)); await settle();
    expect(getPostStatus()).toBe("failed");
  });

  it("shows concern when the send threw, and hands the same promise back", async () => {
    const sending = Promise.reject(new Error("no relays"));
    const back = followSend(sending);
    expect(back).toBe(sending);
    await back.catch(() => {}); await settle();
    expect(getPostStatus()).toBe("failed");
  });

  it("waits out the Undo time, and Undo ends the wait", () => {
    const undo = holdSend();
    expect(getPostStatus()).toBe("waiting");
    undo();
    expect(getPostStatus()).toBe("idle");
  });

  it("an older send finishing never speaks over a newer post", async () => {
    let first!: (ok: boolean) => void;
    followSend(new Promise<boolean>((r) => { first = r; }));
    const undoSecond = holdSend(); // a second post, now waiting
    first(true); await settle();
    expect(getPostStatus()).toBe("waiting");
    // and an Undo from the older post does nothing to the newer one
    const undoFirst = holdSend(); holdSend();
    undoFirst();
    expect(getPostStatus()).toBe("waiting");
    undoSecond();
    expect(getPostStatus()).toBe("waiting");
  });
});

describe("the connection", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const up = (...urls: string[]) => new Map(urls.map((u) => [u, true] as [string, boolean]));
  const none = () => new Map<string, boolean>();
  const tick = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); };
  function watch(over: { reach?: (urls: string[]) => Promise<boolean> } = {}) {
    const net = new EventTarget();
    let now: Map<string, boolean> = none();
    const reach = vi.fn(over.reach ?? (async () => false));
    const stop = watchConnection({ statuses: () => now, canReachAny: reach, everyMs: 5000, target: net, startsOffline: false });
    return { net, reach, stop, set: (m: Map<string, boolean>) => { now = m; } };
  }

  it("the browser saying it is offline is a lost connection, at once, and online brings it back", () => {
    const w = watch();
    expect(getConnectionLost()).toBe(false);
    w.net.dispatchEvent(new Event("offline"));
    expect(getConnectionLost()).toBe(true);
    w.net.dispatchEvent(new Event("online"));
    expect(getConnectionLost()).toBe(false);
    w.stop();
  });

  it("a quiet start is not a loss: nothing was ever connected, so nothing is asked", async () => {
    const w = watch();
    await tick(60_000);
    expect(getConnectionLost()).toBe(false);
    expect(w.reach).not.toHaveBeenCalled();
    w.stop();
  });

  it("relays that drop and cannot be reached again are a lost connection", async () => {
    const w = watch({ reach: async () => false });
    w.set(up("wss://one.example", "wss://two.example")); await tick(5000);
    w.set(none()); await tick(5000);
    expect(getConnectionLost()).toBe(false); // one quiet check is not enough
    await tick(5000);
    expect(w.reach).toHaveBeenCalledWith(["wss://one.example", "wss://two.example"]);
    expect(getConnectionLost()).toBe(true);
    w.stop();
  });

  it("relays the app closed on purpose are not a loss: they still answer, and are asked only once", async () => {
    const w = watch({ reach: async () => true });
    w.set(up("wss://one.example")); await tick(5000);
    w.set(none()); await tick(120_000);
    expect(getConnectionLost()).toBe(false);
    expect(w.reach).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it("comes back as soon as a relay is connected again", async () => {
    const w = watch({ reach: async () => false });
    w.set(up("wss://one.example")); await tick(5000);
    w.set(none()); await tick(10_000);
    expect(getConnectionLost()).toBe(true);
    w.set(up("wss://one.example")); await tick(5000);
    expect(getConnectionLost()).toBe(false);
    w.stop();
  });

  it("while lost it asks again now and then, and comes back when a relay answers", async () => {
    let answers = false;
    const w = watch({ reach: async () => answers });
    w.set(up("wss://one.example")); await tick(5000);
    w.set(none()); await tick(10_000);
    expect(getConnectionLost()).toBe(true);
    answers = true; await tick(20_000);
    expect(getConnectionLost()).toBe(false);
    expect(w.reach.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(w.reach.mock.calls.length).toBeLessThanOrEqual(3);
    w.stop();
  });

  it("a relay check that throws counts as not reached, never as fine", async () => {
    const w = watch({ reach: async () => { throw new Error("boom"); } });
    w.set(up("wss://one.example")); await tick(5000);
    w.set(none()); await tick(10_000);
    expect(getConnectionLost()).toBe(true);
    w.stop();
    expect(getConnectionLost()).toBe(false); // stopping the watch clears what it claimed
  });
});
