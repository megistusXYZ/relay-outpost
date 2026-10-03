/**
 * One inspector for any event: what it is and the codes to share it by,
 * whether it's genuine, what it points to and what points back to it, which
 * relays have it — with "Copy to my relay" — and the raw event.
 *
 * Opened from a post in Content, or by pasting an event into Content's
 * search. Anything it points to can be inspected in turn (Back returns).
 * The facts are worked out in inspector-model.ts; this fetches and shows.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Event as NostrEvent, Filter } from "nostr-tools";
import { ArrowLeft, Copy } from "lucide-react";
import { DEFAULT_RELAYS, publishEventDetailed } from "@/lib/nostr";
import { copyNostrId } from "@/lib/clipboard-bridge";
import { kindInfo, plainKindName } from "@/lib/kind-catalog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { pubkeyToNpub, resolveProfileBatch, subscribeWithReach, type ProfileInfo } from "./shared";
import {
  encodings, pointers, referenceCounts, seenOnLine, signatureVerdict,
  type Pointer, type SeenOn, type SeenStatus,
} from "./inspector-model";

/** An event as the inspector holds it: possibly pasted, so possibly unsigned. */
export type InspectedEvent = Omit<NostrEvent, "sig"> & { sig?: string };

const SEALED = new Set([4, 13, 14, 1059, 1060]);
const TABS = [
  { id: "about", label: "About" },
  { id: "points", label: "Points to" },
  { id: "responses", label: "Responses" },
  { id: "seen", label: "Seen on" },
  { id: "raw", label: "Raw" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia("(min-width: 1024px)"); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => true,
  );
}

const unique = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.filter((x) => { const k = x.replace(/\/+$/, "").toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
};

function ago(sec: number): string {
  const d = Math.floor(Date.now() / 1000) - sec;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return `${Math.floor(d / 86400)} d ago`;
}

export function EventInspector({ event, relayUrl, relayName, ownRelay = true, onClose }: {
  /** null = closed. */
  event: InspectedEvent | null;
  relayUrl: string;
  relayName: string;
  /** Is relayUrl one you run? Then "Seen on" calls it yours and offers to copy to it. */
  ownRelay?: boolean;
  onClose: () => void;
}) {
  const wide = useWide();
  const [stack, setStack] = useState<InspectedEvent[]>([]);
  useEffect(() => { setStack(event ? [event] : []); }, [event]);
  const current = stack[stack.length - 1];
  const body = current ? (
    <InspectorBody
      key={current.id}
      event={current}
      relayUrl={relayUrl}
      relayName={relayName}
      ownRelay={ownRelay}
      canGoBack={stack.length > 1}
      onBack={() => setStack((s) => s.slice(0, -1))}
      onInspect={(e) => setStack((s) => [...s, e])}
    />
  ) : null;
  const open = !!event;
  const onOpenChange = (o: boolean) => { if (!o) onClose(); };
  if (wide) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl p-0 gap-0 max-h-[85dvh] overflow-hidden flex flex-col" data-testid="event-inspector">
          <DialogTitle className="sr-only">Inspect event</DialogTitle>
          {body}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[92dvh] p-0 rounded-t-2xl flex flex-col" data-testid="event-inspector">
        <SheetTitle className="sr-only">Inspect event</SheetTitle>
        {body}
      </SheetContent>
    </Sheet>
  );
}

function InspectorBody({ event, relayUrl, relayName, ownRelay, canGoBack, onBack, onInspect }: {
  event: InspectedEvent; relayUrl: string; relayName: string; ownRelay: boolean;
  canGoBack: boolean; onBack: () => void; onInspect: (e: InspectedEvent) => void;
}) {
  const [tab, setTab] = useState<TabId>("about");
  const [profiles, setProfiles] = useState<Map<string, ProfileInfo>>(new Map());
  const verdict = useMemo(() => signatureVerdict(event), [event]);
  const links = useMemo(() => pointers(event), [event]);
  const info = kindInfo(event.kind);

  useEffect(() => {
    const people = [event.pubkey, ...links.filter((p) => p.type === "person").map((p) => p.value)];
    let live = true;
    resolveProfileBatch(people).then((m) => { if (live) setProfiles(new Map(m)); }).catch(() => {});
    return () => { live = false; };
  }, [event, links]);

  const [finding, setFinding] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const inspectPointer = async (p: Pointer) => {
    const filter: Filter | null = p.type === "event"
      ? { ids: [p.value] }
      : p.type === "address"
        ? (() => { const [k, pk, ...d] = p.value.split(":"); return { kinds: [Number(k)], authors: [pk], "#d": [d.join(":")] }; })()
        : null;
    if (!filter) return;
    setFinding(p.value); setNotFound(null);
    const { events } = await subscribeWithReach(unique([relayUrl, ...DEFAULT_RELAYS]), [filter], 6000);
    setFinding(null);
    const found = events.sort((a, b) => b.created_at - a.created_at)[0];
    if (found) onInspect(found);
    else setNotFound(p.value);
  };

  return (
    <>
      <header className="shrink-0 border-b border-black/[0.06] dark:border-white/[0.08] px-4 pt-4">
        <div className="flex items-center gap-2 min-w-0">
          {canGoBack && (
            <button type="button" onClick={onBack} className="-ml-2 inline-flex items-center justify-center w-11 h-11 rounded-full hover:bg-black/[0.04] dark:hover:bg-white/[0.06]" aria-label="Back" data-testid="inspector-back">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-tight truncate" data-testid="inspector-kind">
              {plainKindName(event.kind)}
              <span className="ml-2 text-[13px] font-normal text-muted-foreground">kind {event.kind}{info?.nip ? ` · ${info.nip}` : ""}</span>
            </h2>
            <p className="text-[13px]" data-testid="inspector-verdict" data-verdict={verdict.verdict}>
              {verdict.verdict === "valid" && <><span className="font-medium text-emerald-600 dark:text-emerald-400">Genuine</span><span className="text-muted-foreground"> · signed by its author</span></>}
              {verdict.verdict === "invalid" && <><span className="font-medium text-red-600 dark:text-red-400">Not genuine</span><span className="text-muted-foreground"> · {verdict.reason}</span></>}
              {verdict.verdict === "unsigned" && <><span className="font-medium text-amber-600 dark:text-amber-400">Not signed</span><span className="text-muted-foreground"> · anyone could have written this</span></>}
            </p>
          </div>
        </div>
        <div role="tablist" aria-label="Inspect" className="mt-3 -mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 min-h-[44px] px-3 text-[14px] border-b-2 transition-colors ${tab === t.id ? "border-brand text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              data-testid={`inspector-tab-${t.id}`}
            >
              {t.label}{t.id === "points" && links.length ? ` ${links.length}` : ""}
            </button>
          ))}
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-4" role="tabpanel">
        {tab === "about" && <AboutPanel event={event} relayUrl={relayUrl} profile={profiles.get(event.pubkey)} />}
        {tab === "points" && (
          <PointsPanel links={links} profiles={profiles} finding={finding} notFound={notFound} onInspect={inspectPointer} />
        )}
        {tab === "responses" && <ResponsesPanel event={event} relayUrl={relayUrl} relayName={relayName} onInspect={onInspect} />}
        {tab === "seen" && <SeenOnPanel event={event} relayUrl={relayUrl} relayName={relayName} ownRelay={ownRelay} genuine={verdict.verdict === "valid"} />}
        {tab === "raw" && <RawPanel event={event} />}
      </div>
    </>
  );
}

function CodeRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-black/[0.05] dark:border-white/[0.06] last:border-0" data-testid={testId}>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-muted-foreground">{label}</p>
        <p className="font-mono text-[12.5px] truncate" title={value} data-testid={`${testId}-value`}>{value}</p>
      </div>
      <button type="button" onClick={() => copyNostrId(value)} className="shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-full text-muted-foreground hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06]" aria-label={`Copy ${label.toLowerCase()}`}>
        <Copy className="w-4 h-4" />
      </button>
    </div>
  );
}

function AboutPanel({ event, relayUrl, profile }: { event: InspectedEvent; relayUrl: string; profile?: ProfileInfo }) {
  const codes = useMemo(() => encodings(event, relayUrl), [event, relayUrl]);
  const bytes = new TextEncoder().encode(JSON.stringify(event)).length;
  return (
    <div className="space-y-5" data-testid="inspector-about">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[14px]">
        <dt className="text-muted-foreground">By</dt>
        <dd className="min-w-0 truncate">{profile?.name ?? `${codes.npub.slice(0, 18)}…`}</dd>
        <dt className="text-muted-foreground">Written</dt>
        <dd>{new Date(event.created_at * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} <span className="text-muted-foreground">· {ago(event.created_at)}</span></dd>
        <dt className="text-muted-foreground">Size</dt>
        <dd className="tabular-nums">{bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KB`} · {event.tags.length} tag{event.tags.length === 1 ? "" : "s"}</dd>
      </dl>
      <section>
        <h3 className="text-[13px] font-medium text-muted-foreground mb-1">Codes to share it by</h3>
        <CodeRow label="Event code" value={codes.nevent} testId="inspector-nevent" />
        {codes.naddr && <CodeRow label="Address (follows its latest version)" value={codes.naddr} testId="inspector-naddr" />}
        <CodeRow label="Note code" value={codes.note} testId="inspector-note" />
        <CodeRow label="Author" value={codes.npub} testId="inspector-npub" />
        <CodeRow label="ID" value={event.id} testId="inspector-id" />
      </section>
    </div>
  );
}

const MARKER_WORD: Record<string, string> = { reply: "Replying to", root: "In the thread of", mention: "Mentions" };

function PointsPanel({ links, profiles, finding, notFound, onInspect }: {
  links: Pointer[]; profiles: Map<string, ProfileInfo>; finding: string | null; notFound: string | null;
  onInspect: (p: Pointer) => void;
}) {
  if (!links.length) return <p className="py-8 text-center text-[14px] text-muted-foreground" data-testid="inspector-points-empty">It doesn't point to any other post or person.</p>;
  return (
    <ul className="divide-y divide-black/[0.05] dark:divide-white/[0.06]" data-testid="inspector-points">
      {links.map((p) => {
        const name = p.type === "person" ? profiles.get(p.value)?.name : undefined;
        const word = p.type === "event" ? (p.marker && MARKER_WORD[p.marker]) || "A post" : p.type === "person" ? "Person" : `${plainKindName(Number(p.value.split(":")[0]))} by address`;
        const shown = p.type === "person" ? name ?? `${pubkeyToNpub(p.value).slice(0, 18)}…` : p.type === "event" ? `${p.value.slice(0, 12)}…` : p.value.split(":").slice(2).join(":") || "(no name)";
        return (
          <li key={`${p.type}:${p.value}`} className="flex items-center gap-3 py-2 min-h-[56px]" data-testid="inspector-point" data-type={p.type} data-value={p.value}>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-muted-foreground">{word}</p>
              <p className={`text-[14px] truncate ${p.type === "person" && name ? "" : "font-mono text-[12.5px]"}`}>{shown}</p>
              {notFound === p.value && <p className="text-[12px] text-amber-600 dark:text-amber-400" data-testid="inspector-point-missing">No relay that answered has it.</p>}
            </div>
            {p.type === "person" ? (
              <button type="button" onClick={() => copyNostrId(pubkeyToNpub(p.value))} className="shrink-0 min-h-[44px] px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground">Copy</button>
            ) : (
              <Button variant="ghost" className="shrink-0 h-11 rounded-full px-4 text-[13px]" disabled={finding !== null} onClick={() => onInspect(p)} data-testid="inspector-point-open">
                {finding === p.value ? "Finding…" : "Inspect"}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ResponsesPanel({ event, relayUrl, relayName, onInspect }: { event: InspectedEvent; relayUrl: string; relayName: string; onInspect: (e: InspectedEvent) => void }) {
  const [state, setState] = useState<{ events: NostrEvent[]; reached: boolean; refused?: string } | null>(null);
  useEffect(() => {
    let live = true;
    const addressable = event.kind >= 30000 && event.kind < 40000;
    const coord = `${event.kind}:${event.pubkey}:${event.tags.find((t) => t[0] === "d")?.[1] ?? ""}`;
    Promise.all([
      subscribeWithReach([relayUrl], [{ "#e": [event.id], limit: 500 }], 6000),
      addressable ? subscribeWithReach([relayUrl], [{ "#a": [coord], limit: 500 }], 6000) : Promise.resolve(null),
    ]).then(([byId, byAddr]) => {
      if (!live) return;
      const all = new Map<string, NostrEvent>();
      for (const e of [...byId.events, ...(byAddr?.events ?? [])]) all.set(e.id, e);
      setState({ events: [...all.values()].sort((a, b) => b.created_at - a.created_at), reached: byId.reached, refused: byId.refused });
    });
    return () => { live = false; };
  }, [event, relayUrl]);

  if (!state) return <p className="py-8 text-center text-[14px] text-muted-foreground" role="status">Asking {relayName}…</p>;
  if (!state.reached) return <p className="py-8 text-center text-[14px] text-muted-foreground" data-testid="inspector-responses-unreached">Couldn't reach {relayName} to ask.</p>;
  if (state.refused) return <p className="py-8 text-center text-[14px] text-muted-foreground" data-testid="inspector-responses-refused">{relayName} only answers signed-in readers.</p>;
  const c = referenceCounts(state.events);
  const parts = [
    c.replies && `${c.replies} repl${c.replies === 1 ? "y" : "ies"}`,
    c.reactions && `${c.reactions} reaction${c.reactions === 1 ? "" : "s"}`,
    c.reposts && `${c.reposts} repost${c.reposts === 1 ? "" : "s"}`,
    c.thanks && `${c.thanks} thanks`,
    c.other && `${c.other} other`,
  ].filter(Boolean);
  return (
    <div data-testid="inspector-responses">
      <p className="text-[14px] mb-2" data-testid="inspector-responses-line">
        {parts.length ? `${parts.join(" · ")} on ${relayName}` : `Nothing on ${relayName} points to it yet.`}
      </p>
      <ul className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
        {state.events.slice(0, 50).map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => onInspect(e)} className="w-full text-left flex items-baseline gap-3 py-2.5 min-h-[44px] hover:bg-black/[0.02] dark:hover:bg-white/[0.03]" data-testid="inspector-response">
              <span className="shrink-0 w-24 text-[13px] text-muted-foreground">{plainKindName(e.kind)}</span>
              <span className="min-w-0 flex-1 truncate text-[14px]">{SEALED.has(e.kind) ? "(sealed)" : e.kind === 7 ? (e.content === "+" || !e.content ? "Liked it" : e.content) : e.content || "—"}</span>
              <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">{ago(e.created_at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATUS_WORD: Record<SeenStatus, { word: string; cls: string }> = {
  has: { word: "Has it", cls: "text-emerald-600 dark:text-emerald-400" },
  missing: { word: "Doesn't have it", cls: "text-muted-foreground" },
  unreached: { word: "Couldn't reach", cls: "text-amber-600 dark:text-amber-400" },
};

function SeenOnPanel({ event, relayUrl, relayName, ownRelay, genuine }: { event: InspectedEvent; relayUrl: string; relayName: string; ownRelay: boolean; genuine: boolean }) {
  const relays = useMemo(() => unique([relayUrl, ...DEFAULT_RELAYS]), [relayUrl]);
  const [rows, setRows] = useState<Record<string, SeenStatus | undefined>>({});
  const [copy, setCopy] = useState<{ busy: boolean; done?: boolean; refused?: string }>({ busy: false });

  const ask = (relay: string) =>
    subscribeWithReach([relay], [{ ids: [event.id] }], 6000).then((r): SeenStatus =>
      !r.reached || r.refused ? "unreached" : r.events.some((e) => e.id === event.id) ? "has" : "missing");

  useEffect(() => {
    let live = true;
    setRows({});
    for (const r of relays) ask(r).then((s) => { if (live) setRows((m) => ({ ...m, [r]: s })); });
    return () => { live = false; };
  }, [event.id, relays]);

  const done = relays.every((r) => rows[r]);
  const summary: SeenOn[] = relays.flatMap((r) => (rows[r] ? [{ relay: r, status: rows[r]! }] : []));
  const mine = rows[relays[0]];

  const copyToMine = async () => {
    setCopy({ busy: true });
    try {
      const { ok, rejections } = await publishEventDetailed(event, [relayUrl], undefined, true, false, true);
      if (ok) {
        setCopy({ busy: false, done: true });
        setRows((m) => ({ ...m, [relays[0]]: undefined }));
        ask(relays[0]).then((s) => setRows((m) => ({ ...m, [relays[0]]: s })));
      } else {
        setCopy({ busy: false, refused: rejections[0]?.message.replace(/^[a-z-]+:\s*/i, "") || "no reason given" });
      }
    } catch (err) {
      setCopy({ busy: false, refused: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="space-y-3" data-testid="inspector-seen">
      <p className="text-[14px]" data-testid="inspector-seen-line">{done ? seenOnLine(summary) : "Asking relays…"}</p>
      <ul className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
        {relays.map((r, i) => {
          const s = rows[r];
          return (
            <li key={r} className="flex items-center gap-3 py-2.5 min-h-[44px]" data-testid="inspector-seen-row" data-relay={r} data-status={s ?? "asking"}>
              <span className="min-w-0 flex-1 truncate text-[14px]">{i === 0 ? <><span className="font-medium">{relayName}</span>{ownRelay && <span className="text-muted-foreground"> (yours)</span>}</> : r.replace(/^wss:\/\//, "")}</span>
              <span className={`shrink-0 text-[13px] ${s ? STATUS_WORD[s].cls : "text-muted-foreground"}`}>{s ? STATUS_WORD[s].word : "Asking…"}</span>
            </li>
          );
        })}
      </ul>
      {ownRelay && mine === "missing" && (
        genuine ? (
          <Button onClick={copyToMine} disabled={copy.busy} className="w-full h-11 rounded-full" data-testid="inspector-copy-to-mine">
            {copy.busy ? "Copying…" : `Copy to ${relayName}`}
          </Button>
        ) : (
          <p className="text-[13px] text-muted-foreground" data-testid="inspector-copy-blocked">Only a genuine, signed event can be copied to {relayName}.</p>
        )
      )}
      {copy.done && mine === "has" && <p className="text-[13px] text-emerald-600 dark:text-emerald-400" data-testid="inspector-copied">Copied — {relayName} has it now.</p>}
      {copy.refused && <p className="text-[13px] text-red-600 dark:text-red-400" data-testid="inspector-copy-refused">{relayName} turned it down: “{copy.refused}”</p>}
    </div>
  );
}

function RawPanel({ event }: { event: InspectedEvent }) {
  const json = JSON.stringify(event, null, 2);
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2" data-testid="inspector-raw">
      <div className="flex justify-end">
        <button type="button" className="min-h-[44px] px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground" onClick={() => { navigator.clipboard?.writeText(json).then(() => setCopied(true), () => {}); }}>
          {copied ? "Copied" : "Copy JSON"}
        </button>
      </div>
      <pre className="overflow-auto rounded-lg border border-border bg-muted p-3 text-[11.5px] leading-relaxed font-mono whitespace-pre-wrap break-all" data-testid="inspector-raw-json">{json}</pre>
    </div>
  );
}
