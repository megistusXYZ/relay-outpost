/**
 * One check per kind of dependency, for the service health check
 * (server/service-health.ts). Each answers up / empty / down, never just
 * yes or no: "answered with nothing" is its own state.
 */
import WebSocket from "ws";
import type { CheckResult } from "./service-health";

const DEFAULT_TIMEOUT_MS = 8_000;

/** Open, ask one small question, and settle on the first answer (or none). */
function ask(
  url: string,
  filter: Record<string, unknown>,
  timeoutMs: number,
  onEvent: (event: any) => void,
): Promise<{ opened: boolean; answered: boolean; ms: number; error?: string }> {
  return new Promise((done) => {
    const t0 = Date.now();
    let opened = false;
    let settled = false;
    let ws: WebSocket;
    const finish = (answered: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      done({ opened, answered, ms: Date.now() - t0, ...(error ? { error } : {}) });
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      ws = new WebSocket(url, { handshakeTimeout: timeoutMs });
    } catch (e) {
      finish(false, String((e as Error).message || e));
      return;
    }
    ws.on("open", () => {
      opened = true;
      ws.send(JSON.stringify(["REQ", "health", filter]));
    });
    ws.on("message", (raw) => {
      let m: unknown;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (!Array.isArray(m)) return;
      if (m[0] === "EVENT") { onEvent(m[2]); return; }
      // EOSE, CLOSED (a relay declining is an answer), NOTICE: it answered.
      finish(true);
    });
    ws.on("error", (e) => finish(false, String(e.message || e)));
    ws.on("close", () => finish(false));
  });
}

/** A relay is up when it connects AND answers a small question. */
export async function probeRelay(url: string, opts: { timeoutMs?: number } = {}): Promise<CheckResult> {
  let events = 0;
  const r = await ask(url, { kinds: [1], limit: 1 }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => { events++; });
  if (r.answered || events > 0) return { state: "up", ms: r.ms };
  return { state: "down", ms: r.ms, detail: r.opened ? "no answer" : r.error ? "can't connect" : "no connection" };
}

/**
 * A profile directory is up when it holds at least half of a few profiles
 * known to exist. Fewer is EMPTY: it answers, with nothing to find.
 *
 * One profile per question: asked for six at once, purplepag.es sent six old
 * copies of one or two profiles (measured 2026-10-23), so a batch undercounts
 * a directory that holds them all.
 */
export function probeDirectory(url: string, knownPubkeys: readonly string[], opts: { timeoutMs?: number } = {}): Promise<CheckResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((done) => {
    const t0 = Date.now();
    const found = new Set<string>();
    let opened = false;
    let answers = 0;
    let settled = false;
    let ws: WebSocket;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      const ms = Date.now() - t0;
      if (answers === 0 && found.size === 0) {
        done({ state: "down", ms, detail: opened ? "no answer" : "can't connect" });
      } else if (found.size * 2 < knownPubkeys.length) {
        done({ state: "empty", ms, detail: `held ${found.size} of ${knownPubkeys.length} well-known profiles` });
      } else {
        done({ state: "up", ms });
      }
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      ws = new WebSocket(url, { handshakeTimeout: timeoutMs });
    } catch {
      finish();
      return;
    }
    ws.on("open", () => {
      opened = true;
      knownPubkeys.forEach((pk, i) => ws.send(JSON.stringify(["REQ", `p${i}`, { kinds: [0], authors: [pk], limit: 1 }])));
    });
    ws.on("message", (raw) => {
      let m: unknown;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (!Array.isArray(m)) return;
      if (m[0] === "EVENT") {
        const e = m[2] as { pubkey?: unknown } | undefined;
        if (e && typeof e.pubkey === "string" && knownPubkeys.includes(e.pubkey)) found.add(e.pubkey);
        return;
      }
      if (m[0] === "EOSE" || m[0] === "CLOSED") {
        answers++;
        if (answers >= knownPubkeys.length) finish();
      }
    });
    ws.on("error", finish);
    ws.on("close", finish);
  });
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * An HTTP service is up when it answers 2xx with JSON (and, given a check,
 * JSON that holds something). A web page where JSON should be is EMPTY:
 * that is how brainstorm.world's search API failed.
 */
export async function probeHttp(
  url: string,
  opts: { timeoutMs?: number; fetcher?: Fetcher; init?: RequestInit; check?: (json: unknown) => boolean } = {},
): Promise<CheckResult> {
  const fetcher: Fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetcher(url, { ...opts.init, signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
  } catch {
    return { state: "down", ms: Date.now() - t0, detail: "no answer" };
  }
  const ms = Date.now() - t0;
  if (!res.ok) return { state: "down", ms, detail: `HTTP ${res.status}` };
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json")) return { state: "empty", ms, detail: `answered ${type.split(";")[0] || "no content type"}, not JSON` };
  let json: unknown;
  try { json = await res.json(); } catch { return { state: "empty", ms, detail: "answered broken JSON" }; }
  if (opts.check && !opts.check(json)) return { state: "empty", ms, detail: "answered, with nothing in it" };
  return { state: "up", ms };
}
