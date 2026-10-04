/**
 * The console's own connection to a relay: a plain WebSocket, so every frame
 * the relay sends — end of results, refusals, notices, sign-in requests — can
 * be shown. (The app's shared pool answers "results or nothing" and hides the
 * rest; that's right for the app and wrong for a console.)
 *
 * Every frame in and out is reported with the wall-clock time; what they mean
 * is wire-transcript.ts's job.
 */
import type { WireFrame } from "./wire-transcript";

export interface WireSession {
  relay: string;
  send(msg: unknown[]): void;
  /** Close quietly: we chose to, so it isn't news for the transcript. */
  close(): void;
}

export function openWire(relay: string, onFrame: (f: WireFrame) => void, connectTimeoutMs = 8000): WireSession {
  let ws: WebSocket | null = null;
  let opened = false;
  let done = false;
  const queue: unknown[][] = [];
  const emit = (f: WireFrame) => { if (!done) onFrame(f); };
  const write = (msg: unknown[]) => {
    try { ws!.send(JSON.stringify(msg)); emit({ relay, at: Date.now(), dir: "out", msg }); } catch { /* socket went away; its close is reported */ }
  };

  emit({ relay, at: Date.now(), dir: "conn", state: "connecting" });
  const fail = (detail: string) => {
    if (done || opened) return;
    emit({ relay, at: Date.now(), dir: "conn", state: "error", detail });
    done = true;
    try { ws?.close(); } catch { /* already closed */ }
  };
  const timer = setTimeout(() => fail(`no answer in ${Math.round(connectTimeoutMs / 1000)} s`), connectTimeoutMs);
  try {
    ws = new WebSocket(relay);
  } catch {
    clearTimeout(timer);
    fail("that isn't a relay address");
    return { relay, send() {}, close() {} };
  }
  ws.onopen = () => {
    clearTimeout(timer);
    opened = true;
    emit({ relay, at: Date.now(), dir: "conn", state: "open" });
    for (const m of queue.splice(0)) write(m);
  };
  ws.onerror = () => { clearTimeout(timer); fail("connection failed"); };
  ws.onclose = (e) => {
    clearTimeout(timer);
    if (!opened) { fail("connection failed"); return; }
    emit({ relay, at: Date.now(), dir: "conn", state: "closed", detail: e.reason || undefined });
    done = true;
  };
  ws.onmessage = (e) => {
    let msg: unknown;
    try { msg = JSON.parse(typeof e.data === "string" ? e.data : ""); } catch { return; }
    if (Array.isArray(msg)) emit({ relay, at: Date.now(), dir: "in", msg });
  };
  return {
    relay,
    send(msg) {
      if (done) return;
      if (opened) write(msg);
      else queue.push(msg);
    },
    close() {
      clearTimeout(timer);
      done = true;
      try { ws?.close(); } catch { /* already closed */ }
    },
  };
}
