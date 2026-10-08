/**
 * The console: ask any relay anything, and see exactly what it says back.
 *
 * A query is a filter (built in Simple, or typed as JSON with times like
 * "now-3h"), sent to one relay or several on the console's own sockets. Three
 * views of the answer: the events (each opens in the inspector), what each
 * relay said in order (end of results, refusals with the relay's words,
 * notices, sign-in requests, timings), and — with several relays — how they
 * compare. Queries can be counted, kept listening, shared as a link,
 * rerun from Recent, and exported.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Event as NostrEvent } from "nostr-tools";
import { Download, Link2, Plus, Square, X } from "lucide-react";
import { DEFAULT_RELAYS } from "@/lib/nostr";
import { getGlobalSigner, getSignInPolicy, shouldAutoAuth } from "@/lib/nip42-auth";
import { normalizeRelayAddress } from "@/lib/relay-address";
import { useOperatedRelays } from "@/lib/operated-relays";
import { findKinds, plainKindName } from "@/lib/kind-catalog";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EventInspector, type InspectedEvent } from "./EventInspector";
import { Publisher } from "./Publisher";
import { signatureVerdict } from "./inspector-model";
import { resolveProfileBatch, type ProfileInfo } from "./shared";
import { consoleLink, resolveFilters } from "./console-query";
import { openWire, type WireSession } from "@/lib/wire-client";
import { compareRelays, describeFilter, relayOutcomes, relayWords, transcript, type TranscriptLine, type WireFrame } from "@/lib/wire-transcript";

const HISTORY_KEY = "ro_console_history";
interface HistoryEntry { relays: string[]; text: string; at: number }
const readHistory = (): HistoryEntry[] => { try { const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
const writeHistory = (h: HistoryEntry[]) => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 20))); } catch { /* private mode */ } };

export const host = (u: string) => u.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
const sameRelay = (a: string, b: string) => host(a).toLowerCase() === host(b).toLowerCase();
const pretty = (o: unknown) => JSON.stringify(o, null, 2);
const DEFAULT_TEXT = pretty({ kinds: [1], since: "now-24h", limit: 50 });
const TONE: Record<TranscriptLine["tone"], string> = {
  plain: "text-foreground/90",
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
};

function offset(msN: number): string {
  return msN < 1000 ? `+${Math.max(0, Math.round(msN))} ms` : `+${(msN / 1000).toFixed(1)} s`;
}
function ago(sec: number): string {
  const d = Math.floor(Date.now() / 1000) - sec;
  if (d < 60) return "now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 30 * 86400) return `${Math.floor(d / 86400)}d`;
  return new Date(sec * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" });
}
function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

type View = "results" | "said" | "compare";

export function WireConsole({ initialRelays, initialText, initialTool = "ask", initialEvent = null }: {
  initialRelays: string[]; initialText: string | null;
  /** Open on Publish, e.g. from the inspector's "Edit in publisher". */
  initialTool?: "ask" | "publish"; initialEvent?: string | null;
}) {
  const [tool, setTool] = useState<"ask" | "publish">(initialTool);
  const { toast } = useToast();
  const operated = useOperatedRelays();
  const [relays, setRelays] = useState<string[]>(() => {
    if (initialRelays.length) return initialRelays;
    return operated.length ? [operated[0].url] : [DEFAULT_RELAYS[0]];
  });
  const [text, setText] = useState(() => {
    if (!initialText) return DEFAULT_TEXT;
    try { return pretty(JSON.parse(initialText)); } catch { return initialText; }
  });
  const [mode, setMode] = useState<"simple" | "json">("simple");
  const [live, setLive] = useState(false);
  const [frames, setFrames] = useState<WireFrame[]>([]);
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<View>("results");
  const [inspecting, setInspecting] = useState<{ event: InspectedEvent; relay: string } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(readHistory);
  const [signedIn, setSignedIn] = useState<Set<string>>(new Set());
  const [profiles, setProfiles] = useState<Map<string, ProfileInfo>>(new Map());
  const [runStart, setRunStart] = useState(0);

  // The run in flight: its sockets, its frames, and what to resend after a sign-in.
  const sessions = useRef(new Map<string, WireSession>());
  const framesRef = useRef<WireFrame[]>([]);
  const lastReq = useRef(new Map<string, unknown[]>());
  const waitingForSignIn = useRef(new Set<string>());
  const challenges = useRef(new Map<string, string>());
  const authIds = useRef(new Set<string>());
  const finished = useRef(new Set<string>());
  const liveRef = useRef(live);
  liveRef.current = live;
  const flush = useRef<number | null>(null);

  const nowSec = Math.floor(Date.now() / 1000);
  const resolved = useMemo(() => resolveFilters(text, nowSec), [text, nowSec]);
  const single = useMemo(() => { try { const v = JSON.parse(text); return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null; } catch { return null; } }, [text]);

  const stopAll = useCallback((sendClose: boolean) => {
    for (const [relay, s] of sessions.current) {
      const req = lastReq.current.get(relay);
      if (sendClose && req && !finished.current.has(relay)) s.send(["CLOSE", req[1]]);
      s.close();
    }
    sessions.current.clear();
    setRunning(false);
  }, []);
  useEffect(() => () => stopAll(false), [stopAll]);

  const markDone = (relay: string, closeSocket: boolean) => {
    finished.current.add(relay);
    if (closeSocket) { sessions.current.get(relay)?.close(); }
    if ([...sessions.current.keys()].every((r) => finished.current.has(r))) setRunning(false);
  };

  const signIn = useCallback(async (relay: string) => {
    const signer = getGlobalSigner();
    const challenge = challenges.current.get(relay);
    const s = sessions.current.get(relay);
    if (!signer || !challenge || !s) {
      if (!signer) toast({ title: "Sign in to Relay Outpost first", description: "Signing in to a relay uses your key." });
      return;
    }
    try {
      const signed = await signer.signEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [["relay", relay], ["challenge", challenge]], content: "" } as never) as { id: string };
      authIds.current.add(signed.id);
      setSignedIn((x) => new Set(x).add(relay));
      s.send(["AUTH", signed]);
    } catch (err) {
      toast({ title: "Couldn't sign the sign-in", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  }, [toast]);

  const onFrame = useCallback((f: WireFrame) => {
    framesRef.current.push(f);
    if (flush.current === null) flush.current = window.setTimeout(() => { flush.current = null; setFrames([...framesRef.current]); }, 60);
    if (f.dir === "conn") {
      if (f.state === "error" || f.state === "closed") markDone(f.relay, false);
      return;
    }
    if (f.dir !== "in") return;
    const [verb, a, b] = f.msg as [string, unknown, unknown];
    if (verb === "AUTH" && typeof a === "string") {
      challenges.current.set(f.relay, a);
      if (shouldAutoAuth(f.relay)) void signIn(f.relay);
    } else if (verb === "OK" && authIds.current.has(String(a))) {
      if (b === true && waitingForSignIn.current.has(f.relay)) {
        // Signed in after the relay refused: ask again, on the same socket.
        waitingForSignIn.current.delete(f.relay);
        finished.current.delete(f.relay);
        const req = lastReq.current.get(f.relay);
        if (req) { sessions.current.get(f.relay)?.send(req); setRunning(true); }
      }
    } else if (verb === "CLOSED") {
      if (/^auth-required/i.test(String(b ?? ""))) { waitingForSignIn.current.add(f.relay); markDone(f.relay, false); }
      else markDone(f.relay, true);
    } else if (verb === "EOSE" || verb === "COUNT") {
      if (verb === "COUNT" || !liveRef.current) markDone(f.relay, true);
    }
  }, [signIn]);

  const run = (verb: "REQ" | "COUNT") => {
    const r = resolveFilters(text, Math.floor(Date.now() / 1000));
    if (!r.ok || !relays.length) return;
    stopAll(true);
    framesRef.current = [];
    setFrames([]);
    lastReq.current.clear(); waitingForSignIn.current.clear(); challenges.current.clear(); finished.current.clear();
    setSignedIn(new Set());
    const id = `ro${Math.random().toString(36).slice(2, 8)}`;
    setRunStart(Date.now());
    for (const relay of relays) {
      const s = openWire(relay, onFrame);
      sessions.current.set(relay, s);
      const msg = [verb, id, ...r.filters];
      lastReq.current.set(relay, msg);
      s.send(msg);
    }
    setRunning(true);
    setView(verb === "COUNT" ? "said" : "results");
    const entry = { relays, text, at: Date.now() };
    const next = [entry, ...history.filter((h) => !(h.text === text && h.relays.join() === relays.join()))];
    setHistory(next); writeHistory(next);
  };

  // ---- what came back ----
  const lines = useMemo(() => transcript(frames), [frames]);
  const outcomes = useMemo(() => relayOutcomes(frames), [frames]);
  const results = useMemo(() => {
    const byId = new Map<string, { event: NostrEvent; relays: string[] }>();
    for (const f of frames) {
      if (f.dir !== "in" || f.msg[0] !== "EVENT") continue;
      const e = f.msg[2] as NostrEvent;
      if (!e || typeof e.id !== "string") continue;
      const row = byId.get(e.id);
      if (row) { if (!row.relays.includes(f.relay)) row.relays.push(f.relay); }
      else byId.set(e.id, { event: e, relays: [f.relay] });
    }
    return [...byId.values()].sort((a, b) => b.event.created_at - a.event.created_at);
  }, [frames]);
  const verdicts = useRef(new Map<string, boolean>());
  const genuine = (e: NostrEvent) => {
    let v = verdicts.current.get(e.id);
    if (v === undefined) { v = signatureVerdict(e).verdict === "valid"; verdicts.current.set(e.id, v); }
    return v;
  };
  const compare = useMemo(() => {
    const answered = relays.filter((r) => outcomes.get(r)?.status === "answered");
    const ids: Record<string, string[]> = {};
    for (const r of answered) ids[r] = [];
    for (const row of results) for (const r of row.relays) if (ids[r]) ids[r].push(row.event.id);
    return compareRelays(ids);
  }, [relays, outcomes, results]);

  useEffect(() => {
    const want = [...new Set(results.slice(0, 100).map((r) => r.event.pubkey))].filter((pk) => !profiles.has(pk));
    if (!want.length) return;
    let live2 = true;
    resolveProfileBatch(want).then((m) => { if (live2) setProfiles((p) => new Map([...p, ...m])); }).catch(() => {});
    return () => { live2 = false; };
  }, [results, profiles]);

  // ---- editing ----
  const setField = (key: string, value: unknown) => {
    const base = single ?? {};
    const next: Record<string, unknown> = { ...base };
    const empty = value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
    if (empty) delete next[key]; else next[key] = value;
    setText(pretty(next));
  };
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).join("\n") : "");
  const splitList = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

  const [relayInput, setRelayInput] = useState("");
  const addRelay = (input: string) => {
    const url = normalizeRelayAddress(input);
    if (!url) { toast({ title: "That isn't a relay address", description: "Try something like relay.example.com" }); return; }
    setRelays((rs) => (rs.some((r) => sameRelay(r, url)) ? rs : [...rs, url]));
    setRelayInput("");
  };
  const suggestions = [...operated.map((r) => r.url), ...DEFAULT_RELAYS].filter((u, i, a) => a.findIndex((x) => sameRelay(x, u)) === i && !relays.some((r) => sameRelay(r, u))).slice(0, 4);

  const share = async () => {
    const link = `${window.location.origin}${consoleLink(relays, text)}`;
    try { await navigator.clipboard.writeText(link); toast({ title: "Link copied", description: "It opens this query on these relays." }); }
    catch { toast({ title: "Couldn't copy the link", description: link }); }
  };
  const exportAs = (fmtX: "json" | "csv") => {
    const evs = results.map((r) => r.event);
    if (fmtX === "json") download(JSON.stringify(evs, null, 2), "events.json", "application/json");
    else download(["id,kind,pubkey,created_at,content", ...evs.map((e) => [e.id, String(e.kind), e.pubkey, String(e.created_at), csvCell(e.content)].join(","))].join("\n"), "events.csv", "text/csv");
  };

  const multi = relays.length > 1;
  const tabs: { id: View; label: string }[] = [
    { id: "results", label: `Events${results.length ? ` ${results.length.toLocaleString("en-US")}` : ""}` },
    { id: "said", label: "What relays said" },
    ...(multi ? [{ id: "compare" as View, label: "Compare" }] : []),
  ];

  return (
    <div className="space-y-5" data-testid="wire-console">
      {/* Ask relays, or publish to them */}
      <div role="tablist" aria-label="Console tool" className="flex gap-1 border-b border-black/[0.06] dark:border-white/[0.08]">
        {(["ask", "publish"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tool === t} onClick={() => setTool(t)}
            className={`min-h-[44px] px-3 text-[15px] border-b-2 -mb-px ${tool === t ? "border-brand text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            data-testid={`console-tool-${t}`}>
            {t === "ask" ? "Ask" : "Publish"}
          </button>
        ))}
      </div>

      {/* Which relays */}
      <section aria-label="Relays">
        <h2 className="text-[13px] font-medium text-muted-foreground mb-2">{tool === "ask" ? "Ask" : "Publish to"}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {relays.map((r) => (
            <span key={r} className="inline-flex items-center gap-1 rounded-full border border-black/[0.1] dark:border-white/[0.12] pl-3 text-[13px] min-h-[36px]" data-testid="console-relay" data-relay={r}>
              {host(r)}
              <button type="button" onClick={() => setRelays((rs) => rs.filter((x) => x !== r))} className="inline-flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-foreground" aria-label={`Remove ${host(r)}`}>
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
          <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (relayInput.trim()) addRelay(relayInput); }}>
            <Input value={relayInput} onChange={(e) => setRelayInput(e.target.value)} placeholder="Add a relay" aria-label="Add a relay" className="h-9 w-44 rounded-full text-[13px]" data-testid="console-relay-input" />
            <Button type="submit" variant="ghost" size="icon" className="h-11 w-11 rounded-full" aria-label="Add relay" data-testid="console-relay-add"><Plus className="w-4 h-4" /></Button>
          </form>
        </div>
        {suggestions.length > 0 && (
          <p className="mt-1.5 text-[12px] text-muted-foreground flex flex-wrap items-center gap-x-1">
            Add:
            {suggestions.map((u) => (
              <button key={u} type="button" onClick={() => addRelay(u)} className="min-h-[32px] px-1.5 font-medium text-foreground/80 hover:text-brand underline-offset-4 hover:underline" data-testid="console-relay-suggestion">{host(u)}</button>
            ))}
          </p>
        )}
      </section>

      {tool === "publish" ? (
        <Publisher relays={relays} initialText={initialEvent} />
      ) : (<>
      {/* What to ask */}
      <section aria-label="Query" className="rounded-xl border border-black/[0.08] dark:border-white/[0.08]">
        <div role="tablist" aria-label="Query editor" className="flex gap-1 px-3 border-b border-black/[0.06] dark:border-white/[0.08]">
          {(["simple", "json"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} disabled={m === "simple" && !single}
              onClick={() => setMode(m)}
              className={`min-h-[44px] px-3 text-[14px] border-b-2 -mb-px disabled:opacity-40 ${mode === m ? "border-brand text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              data-testid={`console-mode-${m}`}>
              {m === "simple" ? "Simple" : "JSON"}
            </button>
          ))}
        </div>
        <div className="p-3 sm:p-4 space-y-3">
          {mode === "simple" && single ? (
            <SimpleEditor raw={single} setField={setField} list={list} splitList={splitList} />
          ) : (
            <Textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={8}
              className="font-mono text-[12.5px] leading-relaxed" aria-label="Filter as JSON" data-testid="console-json" />
          )}
          <p className={`text-[13px] ${resolved.ok ? "text-muted-foreground" : "text-danger dark:text-red-400"}`} data-testid="console-query-line">
            {resolved.ok ? `Asks for ${resolved.filters.map((f) => describeFilter(f, nowSec)).join("; or ")}` : resolved.error}
          </p>
          {mode === "json" && <p className="text-[12px] text-muted-foreground">Times can be relative — <code>"since": "now-3h"</code>, <code>"2d"</code> — and people and posts can be npub or note codes.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-t border-black/[0.06] dark:border-white/[0.08]">
          {running ? (
            <Button onClick={() => stopAll(true)} variant="outline" className="h-11 rounded-full px-5" data-testid="console-stop"><Square className="w-3.5 h-3.5 mr-2" />Stop</Button>
          ) : (
            <Button onClick={() => run("REQ")} disabled={!resolved.ok || !relays.length} className="h-11 rounded-full px-6" data-testid="console-run">Run</Button>
          )}
          <Button onClick={() => run("COUNT")} disabled={!resolved.ok || !relays.length || running} variant="ghost" className="h-11 rounded-full px-4" data-testid="console-count">Count</Button>
          <label className="inline-flex items-center gap-2 min-h-[44px] px-2 text-[14px]">
            <Switch checked={live} onCheckedChange={setLive} data-testid="console-live" />Keep listening
          </label>
          <Button onClick={share} variant="ghost" className="ml-auto h-11 rounded-full px-4" data-testid="console-share"><Link2 className="w-4 h-4 mr-2" />Share</Button>
        </div>
      </section>

      {/* What came back */}
      {(frames.length > 0 || running) && (
        <section aria-label="Answer">
          <div role="tablist" aria-label="Answer" className="flex gap-1 overflow-x-auto [scrollbar-width:none] border-b border-black/[0.06] dark:border-white/[0.08]">
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={view === t.id} onClick={() => setView(t.id)}
                className={`shrink-0 min-h-[44px] px-3 text-[14px] border-b-2 -mb-px ${view === t.id ? "border-brand text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                data-testid={`console-view-${t.id}`}>
                {t.label}
              </button>
            ))}
            {running && <span className="ml-auto self-center pr-2 text-[13px] text-muted-foreground" role="status">{live ? "Listening…" : "Asking…"}</span>}
          </div>

          {view === "results" && (
            <div data-testid="console-results">
              {results.length === 0 ? (
                <p className="py-8 text-center text-[14px] text-muted-foreground" data-testid="console-results-empty">
                  {running ? "Waiting for events…" : [...outcomes.values()].some((o) => o.status === "answered") ? "No events matched." : "No relay answered — see What relays said."}
                </p>
              ) : (
                <>
                  <ul className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
                    {results.slice(0, 500).map(({ event: e, relays: on }) => (
                      <li key={e.id}>
                        <button type="button" onClick={() => setInspecting({ event: e, relay: on[0] })}
                          className="w-full text-left grid grid-cols-[3.5rem_1fr_auto] sm:grid-cols-[3.5rem_7rem_9rem_1fr_auto] gap-x-3 gap-y-0.5 items-baseline py-2.5 px-1 min-h-[44px] hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                          data-testid="console-row" data-event-id={e.id}>
                          <span className="text-[12px] text-muted-foreground tabular-nums">{ago(e.created_at)}</span>
                          <span className="text-[13px] text-muted-foreground truncate">{plainKindName(e.kind)}</span>
                          <span className="hidden sm:block text-[13px] truncate">{profiles.get(e.pubkey)?.name ?? `${e.pubkey.slice(0, 8)}…`}</span>
                          <span className="col-span-2 sm:col-span-1 row-start-2 sm:row-start-auto col-start-2 sm:col-start-auto text-[14px] truncate">{e.content.replace(/\s+/g, " ").slice(0, 160) || "—"}</span>
                          <span className="row-start-1 col-start-3 sm:col-start-auto text-[12px] text-right whitespace-nowrap">
                            {!genuine(e) && <span className="text-red-600 dark:text-red-400 font-medium mr-2" data-testid="console-row-forged">Not genuine</span>}
                            {multi && <span className="text-muted-foreground">{on.length} of {relays.length}</span>}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between gap-2 pt-2">
                    <span className="text-[12px] text-muted-foreground">{results.length > 500 ? `Showing the newest 500 of ${results.length.toLocaleString("en-US")}` : ""}</span>
                    <span className="flex gap-1">
                      <Button variant="ghost" className="h-11 rounded-full px-3 text-[13px]" onClick={() => exportAs("json")} data-testid="console-export-json"><Download className="w-4 h-4 mr-1.5" />JSON</Button>
                      <Button variant="ghost" className="h-11 rounded-full px-3 text-[13px]" onClick={() => exportAs("csv")}><Download className="w-4 h-4 mr-1.5" />CSV</Button>
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {view === "said" && (
            <TranscriptList lines={lines} start={runStart} multi={multi} canSignIn={(r) => !signedIn.has(r) && sessions.current.has(r) && getSignInPolicy(r).policy !== "never"} onSignIn={signIn} />
          )}

          {view === "compare" && (
            <div className="overflow-x-auto" data-testid="console-compare">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="text-left text-[12px] text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Relay</th><th className="py-2 pr-3 font-medium">Answer</th>
                    <th className="py-2 pr-3 font-medium text-right">Events</th><th className="py-2 pr-3 font-medium text-right">Only here</th>
                    <th className="py-2 pr-3 font-medium text-right">Missing</th><th className="py-2 font-medium text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
                  {relays.map((r) => {
                    const o = outcomes.get(r);
                    const c = compare.find((x) => x.relay === r);
                    const word = !o || o.status === "waiting" ? <span className="text-muted-foreground">Still waiting</span>
                      : o.status === "answered" ? <span className="text-success dark:text-emerald-400">Answered</span>
                      : o.status === "refused" ? <span className="text-warning dark:text-amber-400">Refused — “{relayWords(o.reason ?? "")}”</span>
                      : <span className="text-danger dark:text-red-400">Couldn't reach</span>;
                    return (
                      <tr key={r} data-testid="console-compare-row" data-relay={r} data-status={o?.status ?? "waiting"}>
                        <td className="py-2.5 pr-3 truncate max-w-[12rem]">{host(r)}</td>
                        <td className="py-2.5 pr-3">{word}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{c ? c.total : "—"}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums" data-testid="console-compare-only">{c ? c.onlyHere : "—"}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums" data-testid="console-compare-missing">{c ? c.missing : "—"}</td>
                        <td className="py-2.5 text-right tabular-nums text-muted-foreground">{o?.endMs !== undefined ? offset(o.endMs).slice(1) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-[12px] text-muted-foreground">Only relays that answered are compared. A relay that refused or couldn't be reached isn't counted as missing anything.</p>
            </div>
          )}
        </section>
      )}

      {/* Recent */}
      {history.length > 0 && (
        <details className="group" data-testid="console-history">
          <summary className="cursor-pointer min-h-[44px] flex items-center text-[13px] font-medium text-muted-foreground hover:text-foreground">Recent queries · {history.length}</summary>
          <ul className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
            {history.map((h) => {
              const r = resolveFilters(h.text, nowSec);
              return (
                <li key={`${h.at}`}>
                  <button type="button" onClick={() => { setRelays(h.relays); setText(h.text); setMode("json"); }} className="w-full text-left py-2.5 min-h-[44px] hover:bg-black/[0.02] dark:hover:bg-white/[0.03]" data-testid="console-history-item">
                    <span className="block text-[14px] truncate">{r.ok ? r.filters.map((f) => describeFilter(f, nowSec)).join("; or ") : h.text.slice(0, 80)}</span>
                    <span className="block text-[12px] text-muted-foreground truncate">{h.relays.map(host).join(", ")} · {ago(Math.floor(h.at / 1000))}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={() => { setHistory([]); writeHistory([]); }} className="min-h-[44px] text-[13px] text-muted-foreground hover:text-foreground">Clear recent</button>
        </details>
      )}
      </>)}

      <EventInspector
        event={inspecting?.event ?? null}
        relayUrl={inspecting?.relay ?? ""}
        relayName={inspecting ? host(inspecting.relay) : ""}
        ownRelay={!!inspecting && operated.some((o) => sameRelay(o.url, inspecting.relay))}
        onClose={() => setInspecting(null)}
      />
    </div>
  );
}

/** What relays said, line by line, timed from the start. Shared by Ask and Publish. */
export function TranscriptList({ lines, start, multi, canSignIn, onSignIn }: {
  lines: TranscriptLine[]; start: number; multi: boolean;
  canSignIn: (relay: string) => boolean; onSignIn: (relay: string) => void;
}) {
  return (
    <ol className="py-2" data-testid="console-transcript">
      {lines.map((l, i) => (
        <li key={i} className="grid grid-cols-[4.5rem_1fr] sm:grid-cols-[4.5rem_11rem_1fr] gap-x-3 items-baseline py-1.5 min-h-[32px] text-[13.5px]" data-testid="console-line" data-what={l.what} data-relay={l.relay}>
          <span className="font-mono text-[12px] text-muted-foreground tabular-nums">{offset(l.at - start)}</span>
          <span className="hidden sm:block truncate text-[12.5px] text-muted-foreground">{host(l.relay)}</span>
          <span className={TONE[l.tone]}>
            <span className="sm:hidden text-muted-foreground">{multi ? `${host(l.relay)} · ` : ""}</span>
            {l.text}
            {l.what === "auth-asked" && canSignIn(l.relay) && (
              <button type="button" onClick={() => onSignIn(l.relay)} className="ml-3 min-h-[36px] px-3 rounded-full border border-current/30 text-[13px] font-medium text-brand" data-testid="console-sign-in">Sign in</button>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

function SimpleEditor({ raw, setField, list, splitList }: {
  raw: Record<string, unknown>;
  setField: (k: string, v: unknown) => void;
  list: (v: unknown) => string;
  splitList: (s: string) => string[];
}) {
  const kinds = Array.isArray(raw.kinds) ? (raw.kinds as number[]) : [];
  const [kindQ, setKindQ] = useState("");
  const matches = kindQ ? findKinds(kindQ, 8).filter((k) => !kinds.includes(k.kind)) : [];
  const str = (k: string) => (raw[k] === undefined ? "" : String(raw[k]));
  const field = "grid gap-1 sm:grid-cols-[7rem_1fr] sm:items-center sm:gap-3";
  const label = "text-[13px] text-muted-foreground";
  return (
    <div className="space-y-3" data-testid="console-simple">
      <div className={field}>
        <span className={label}>Kinds</span>
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            {kinds.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 rounded-full border border-black/[0.1] dark:border-white/[0.12] pl-2.5 text-[13px] min-h-[32px]" data-testid="console-kind-chip">
                {plainKindName(k)} <span className="text-muted-foreground">{k}</span>
                <button type="button" onClick={() => setField("kinds", kinds.filter((x) => x !== k))} className="inline-flex items-center justify-center w-8 h-8 rounded-full text-muted-foreground hover:text-foreground" aria-label={`Remove ${plainKindName(k)}`}><X className="w-3 h-3" /></button>
              </span>
            ))}
            <Input value={kindQ} onChange={(e) => setKindQ(e.target.value)} placeholder={kinds.length ? "Add a kind" : "Any kind — search by name or number"} className="h-9 flex-1 min-w-[10rem] text-[13px]" aria-label="Find a kind" data-testid="console-kind-search"
              onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) { e.preventDefault(); setField("kinds", [...kinds, matches[0].kind]); setKindQ(""); } }} />
          </div>
          {matches.length > 0 && (
            <ul className="mt-1 rounded-lg border border-black/[0.08] dark:border-white/[0.1] divide-y divide-black/[0.05] dark:divide-white/[0.06]" data-testid="console-kind-matches">
              {matches.map((k) => (
                <li key={k.kind}>
                  <button type="button" onClick={() => { setField("kinds", [...kinds, k.kind]); setKindQ(""); }} className="w-full text-left flex items-baseline gap-3 px-3 py-2 min-h-[40px] hover:bg-black/[0.03] dark:hover:bg-white/[0.04]" data-testid="console-kind-match">
                    <span className="w-14 shrink-0 font-mono text-[12px] text-muted-foreground">{k.kind}</span>
                    <span className="text-[13.5px] flex-1">{k.label}</span>
                    {k.nip && <span className="text-[12px] text-muted-foreground">{k.nip}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <label className={field}>
        <span className={label}>From</span>
        <Textarea value={list(raw.authors)} onChange={(e) => setField("authors", splitList(e.target.value))} rows={1} placeholder="npub or key — one or more" className="min-h-[40px] text-[13px] font-mono" data-testid="console-authors" />
      </label>
      <label className={field}>
        <span className={label}>Words</span>
        <Input value={str("search")} onChange={(e) => setField("search", e.target.value)} placeholder="Only relays that support search use this" className="h-10 text-[13px]" data-testid="console-search" />
      </label>
      <label className={field}>
        <span className={label}>Hashtags</span>
        <Input value={Array.isArray(raw["#t"]) ? (raw["#t"] as string[]).join(", ") : ""} onChange={(e) => setField("#t", splitList(e.target.value.replace(/#/g, "")))} placeholder="bitcoin, nostr" className="h-10 text-[13px]" data-testid="console-hashtags" />
      </label>
      <div className={field}>
        <span className={label}>When</span>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={str("since")} onChange={(e) => setField("since", e.target.value)} placeholder="Since — 3h, 2d, a date" className="h-10 w-40 text-[13px]" aria-label="Since" data-testid="console-since" />
          <Input value={str("until")} onChange={(e) => setField("until", e.target.value)} placeholder="Until — now" className="h-10 w-36 text-[13px]" aria-label="Until" data-testid="console-until" />
          {["now-1h", "now-24h", "now-7d"].map((t) => (
            <button key={t} type="button" onClick={() => setField("since", t)} className={`min-h-[36px] px-2 text-[13px] ${raw.since === t ? "text-brand font-medium" : "text-muted-foreground hover:text-foreground"}`}>
              {t === "now-1h" ? "1 hour" : t === "now-24h" ? "24 hours" : "7 days"}
            </button>
          ))}
        </div>
      </div>
      <label className={field}>
        <span className={label}>Up to</span>
        <Input type="number" min={1} value={str("limit")} onChange={(e) => setField("limit", e.target.value ? Math.max(0, Math.floor(Number(e.target.value))) : undefined)} className="h-10 w-28 text-[13px]" data-testid="console-limit" />
      </label>
      <details>
        <summary className="cursor-pointer min-h-[40px] flex items-center text-[13px] text-muted-foreground hover:text-foreground">More — by id, mentions, replies</summary>
        <div className="space-y-3 pt-2">
          <label className={field}><span className={label}>Event ids</span><Textarea value={list(raw.ids)} onChange={(e) => setField("ids", splitList(e.target.value))} rows={1} placeholder="note1… or hex" className="min-h-[40px] text-[13px] font-mono" data-testid="console-ids" /></label>
          <label className={field}><span className={label}>Mentioning</span><Textarea value={list(raw["#p"])} onChange={(e) => setField("#p", splitList(e.target.value))} rows={1} placeholder="npub…" className="min-h-[40px] text-[13px] font-mono" /></label>
          <label className={field}><span className={label}>About posts</span><Textarea value={list(raw["#e"])} onChange={(e) => setField("#e", splitList(e.target.value))} rows={1} placeholder="note1… or hex" className="min-h-[40px] text-[13px] font-mono" /></label>
        </div>
      </details>
    </div>
  );
}
