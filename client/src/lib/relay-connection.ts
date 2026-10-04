/**
 * How the app's connection to a relay stands, in four plain states:
 * Connected, Retrying, an error (said as what's wrong), or Offline — where
 * Offline is about this device, never a guess about the relay.
 *
 * A probe is one short visit on its own socket: open it, sign in if your
 * setting allows, ask for one event, note how long each step took and any
 * notice the relay sent. `probeOutcome` reads that visit from the frames
 * (the same frames the console records); `connectionState` turns a run of
 * probes into the state. Pure.
 */
import { relayWords, type WireFrame } from "@/lib/wire-transcript";

export interface ProbeResult {
  at: number;
  opened: boolean;
  /** Time to open the socket. */
  openMs?: number;
  /** It answered the question (results, or a refusal — an answer either way). */
  answered: boolean;
  /** Time from asking to the answer. */
  answerMs?: number;
  signIn: "not-asked" | "needed" | "signed-in" | "refused";
  error?: string;
  notices: string[];
}

export function probeOutcome(frames: WireFrame[], startedAt: number): ProbeResult {
  let connectingAt = startedAt;
  let openAt: number | undefined;
  let error: string | undefined;
  let askedAt: number | undefined;
  let answerAt: number | undefined;
  let challenged = false;
  let refusedForAuth = false;
  let signIn: ProbeResult["signIn"] = "not-asked";
  const authIds = new Set<string>();
  const notices: string[] = [];
  for (const f of frames) {
    if (f.dir === "conn") {
      if (f.state === "connecting") connectingAt = f.at;
      else if (f.state === "open") openAt = f.at;
      else if (f.state === "error" && openAt === undefined) error = f.detail ?? "couldn't connect";
      continue;
    }
    const [verb, a, b, c] = f.msg as [string, unknown, unknown, unknown];
    if (f.dir === "out") {
      if (verb === "REQ") { askedAt = f.at; answerAt = undefined; }
      else if (verb === "AUTH") { const id = (a as { id?: string } | undefined)?.id; if (id) authIds.add(id); }
      continue;
    }
    if (verb === "NOTICE") notices.push(String(a ?? ""));
    else if (verb === "AUTH") challenged = true;
    else if (verb === "OK" && authIds.has(String(a))) {
      if (b === true) signIn = "signed-in";
      else { signIn = "refused"; error = relayWords(String(c ?? "")) || "sign-in turned down"; }
    } else if ((verb === "EOSE" || verb === "CLOSED") && askedAt !== undefined && answerAt === undefined) {
      answerAt = f.at;
      if (verb === "CLOSED" && /^auth-required/i.test(String(b ?? ""))) refusedForAuth = true;
    }
  }
  if (signIn === "not-asked" && (challenged || refusedForAuth)) signIn = "needed";
  const r: ProbeResult = { at: startedAt, opened: openAt !== undefined, answered: answerAt !== undefined, signIn, notices };
  if (openAt !== undefined) r.openMs = openAt - connectingAt;
  if (answerAt !== undefined && askedAt !== undefined) r.answerMs = answerAt - askedAt;
  if (error) r.error = error;
  return r;
}

export type ConnState = "checking" | "connected" | "retrying" | "error" | "offline";
export interface ConnectionState { state: ConnState; word: string; detail?: string }

/** How many misses in a row before "Retrying" becomes an error. */
export const TRIES = 3;

export function connectionState(history: ProbeResult[], deviceOnline: boolean): ConnectionState {
  if (!deviceOnline) return { state: "offline", word: "Offline", detail: "This device isn't connected — the relay may be fine" };
  const last = history[history.length - 1];
  if (!last) return { state: "checking", word: "Checking…" };
  if (!last.opened) {
    let misses = 0;
    for (let i = history.length - 1; i >= 0 && !history[i].opened; i--) misses++;
    const why = last.error ?? "couldn't connect";
    if (misses < TRIES) return { state: "retrying", word: "Retrying", detail: `Couldn't connect — ${why} · try ${misses + 1} of ${TRIES}` };
    return { state: "error", word: "Can't connect", detail: `${misses} tries in a row — ${why}` };
  }
  if (last.signIn === "refused") return { state: "error", word: "Won't let you in", detail: `Sign-in turned down — “${last.error ?? ""}”` };
  if (!last.answered) return { state: "error", word: "Not answering", detail: "It connects, but didn't answer a simple question" };
  const speed = `Answers in ${last.answerMs ?? last.openMs ?? 0} ms`;
  const sign = last.signIn === "signed-in" ? " · signed in" : last.signIn === "needed" ? " · wants you to sign in" : "";
  return { state: "connected", word: "Connected", detail: speed + sign };
}

/** "Usually answers in 110 ms · slowest 340 ms", from the probes that got an answer. */
export function speedLine(history: ProbeResult[]): string | null {
  const ms = history.filter((h) => h.answered && h.answerMs !== undefined).map((h) => h.answerMs!).sort((a, b) => a - b);
  if (!ms.length) return null;
  const mid = Math.floor(ms.length / 2);
  const median = ms.length % 2 ? ms[mid] : Math.round((ms[mid - 1] + ms[mid]) / 2);
  return `Usually answers in ${median} ms · slowest ${ms[ms.length - 1]} ms`;
}
