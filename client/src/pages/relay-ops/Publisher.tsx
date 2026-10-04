/**
 * Console › Publish: write an event (or paste a signed one), check it, send
 * it to the chosen relays, and see what each said — "Accepted by 3 of 5",
 * with every relay's own reason.
 *
 * Nothing is sent until Publish is pressed. Events that replace something
 * (a profile, a follow list, a relay list) or delete things say so and ask
 * first. A relay that wants you signed in gets a Sign in button; once you
 * are, the event is sent to it again.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGlobalSigner, getSignInPolicy, shouldAutoAuth } from "@/lib/nip42-auth";
import { plainKindName } from "@/lib/kind-catalog";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { signatureVerdict } from "./inspector-model";
import { publishResults, readDraft, riskOf, type PublishStatus } from "@/lib/publisher-model";
import { openWire, type WireSession } from "@/lib/wire-client";
import { transcript, type WireFrame } from "@/lib/wire-transcript";
import { host, TranscriptList } from "./WireConsole";

const pretty = (o: unknown) => JSON.stringify(o, null, 2);
const TEMPLATES: { label: string; value: object }[] = [
  { label: "Note", value: { kind: 1, content: "", tags: [] } },
  { label: "Reaction", value: { kind: 7, content: "+", tags: [["e", ""], ["p", ""]] } },
  { label: "Article", value: { kind: 30023, content: "", tags: [["d", ""], ["title", ""]] } },
];

const STATUS: Record<PublishStatus, { word: string; cls: string }> = {
  accepted: { word: "Accepted", cls: "text-emerald-600 dark:text-emerald-400" },
  refused: { word: "Refused", cls: "text-red-600 dark:text-red-400" },
  "needs-sign-in": { word: "Wants you to sign in", cls: "text-amber-600 dark:text-amber-400" },
  unreached: { word: "Couldn't reach", cls: "text-red-600 dark:text-red-400" },
  waiting: { word: "No answer yet", cls: "text-muted-foreground" },
};

type Signed = { id: string; pubkey: string; sig: string; kind: number; created_at: number; tags: string[][]; content: string };

export function Publisher({ relays, initialText }: { relays: string[]; initialText: string | null }) {
  const { toast } = useToast();
  const { pubkey: me } = useNostrAuth();
  const [text, setText] = useState(() => {
    if (initialText) { try { return pretty(JSON.parse(initialText)); } catch { return initialText; } }
    return pretty(TEMPLATES[0].value);
  });
  const read = useMemo(() => readDraft(text), [text]);
  const verdict = read.ok && read.signed ? signatureVerdict(read.draft as Signed) : null;
  const genuine = verdict?.verdict === "valid";
  const kind = read.ok ? read.draft.kind : null;
  const risk = kind === null ? null : riskOf(kind);
  const [understood, setUnderstood] = useState(false);
  useEffect(() => { setUnderstood(false); }, [kind]);

  // One send: its sockets, frames, and who's waiting to be signed in to.
  const [sent, setSent] = useState<{ event: Signed; relays: string[]; start: number } | null>(null);
  const [frames, setFrames] = useState<WireFrame[]>([]);
  const framesRef = useRef<WireFrame[]>([]);
  const sessions = useRef(new Map<string, WireSession>());
  const challenges = useRef(new Map<string, string>());
  const authIds = useRef(new Set<string>());
  const needsSignIn = useRef(new Set<string>());
  const sentRef = useRef(sent);
  sentRef.current = sent;
  const [signingIn, setSigningIn] = useState<Set<string>>(new Set());
  useEffect(() => () => { for (const s of sessions.current.values()) s.close(); }, []);

  const signIn = useCallback(async (relay: string) => {
    const signer = getGlobalSigner();
    const challenge = challenges.current.get(relay);
    const s = sessions.current.get(relay);
    if (!signer) { toast({ title: "Sign in to Relay Outpost first", description: "Signing in to a relay uses your key." }); return; }
    if (!challenge || !s) return;
    setSigningIn((x) => new Set(x).add(relay));
    try {
      const auth = await signer.signEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [["relay", relay], ["challenge", challenge]], content: "" } as never) as { id: string };
      authIds.current.add(auth.id);
      s.send(["AUTH", auth]);
    } catch (err) {
      toast({ title: "Couldn't sign the sign-in", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  }, [toast]);

  const onFrame = useCallback((f: WireFrame) => {
    framesRef.current.push(f);
    setFrames([...framesRef.current]);
    if (f.dir !== "in") return;
    const [verb, a, ok, message] = f.msg as [string, unknown, unknown, unknown];
    if (verb === "AUTH" && typeof a === "string") {
      challenges.current.set(f.relay, a);
      if (shouldAutoAuth(f.relay)) void signIn(f.relay);
    } else if (verb === "OK" && authIds.current.has(String(a))) {
      if (ok === true && needsSignIn.current.has(f.relay) && sentRef.current) {
        needsSignIn.current.delete(f.relay);
        sessions.current.get(f.relay)?.send(["EVENT", sentRef.current.event]);
      }
    } else if (verb === "OK" && a === sentRef.current?.event.id) {
      if (ok !== true && /^auth-required/i.test(String(message ?? ""))) {
        needsSignIn.current.add(f.relay);
        if (challenges.current.has(f.relay) && shouldAutoAuth(f.relay)) void signIn(f.relay);
      } else {
        // A final answer: this relay is done.
        sessions.current.get(f.relay)?.close();
        sessions.current.delete(f.relay);
      }
    }
  }, [signIn]);

  const signAsMe = async () => {
    if (!read.ok) return;
    const signer = getGlobalSigner();
    if (!signer) { toast({ title: "Sign in to Relay Outpost first", description: "Publishing signs with your key." }); return; }
    const d = read.draft;
    // A fresh time unless a template asked for one: a replacement only wins if it's newer.
    const created_at = !read.signed && d.created_at ? d.created_at : Math.floor(Date.now() / 1000);
    try {
      const signed = await signer.signEvent({ kind: d.kind, content: d.content, tags: d.tags, created_at } as never);
      setText(pretty(signed));
    } catch (err) {
      toast({ title: "Couldn't sign it", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const publish = () => {
    if (!read.ok || !genuine) return;
    for (const s of sessions.current.values()) s.close();
    sessions.current.clear(); challenges.current.clear(); needsSignIn.current.clear(); authIds.current.clear();
    framesRef.current = [];
    setFrames([]);
    setSigningIn(new Set());
    const event = read.draft as Signed;
    setSent({ event, relays: [...relays], start: Date.now() });
    sentRef.current = { event, relays: [...relays], start: Date.now() };
    for (const relay of relays) {
      const s = openWire(relay, onFrame);
      sessions.current.set(relay, s);
      s.send(["EVENT", event]);
    }
  };

  const results = sent ? publishResults(sent.relays, sent.event.id, frames) : null;
  const lines = useMemo(() => transcript(frames), [frames]);
  const mine = read.ok && read.signed && me && read.draft.pubkey === me;
  const blocked = !relays.length || !genuine || (risk?.level === "serious" && !understood);

  return (
    <div className="space-y-5" data-testid="publisher">
      <section aria-label="Event" className="rounded-xl border border-black/[0.08] dark:border-white/[0.08]">
        <div className="flex flex-wrap items-center gap-x-1 px-3 pt-2 text-[13px] text-muted-foreground">
          Start from:
          {TEMPLATES.map((t) => (
            <button key={t.label} type="button" onClick={() => setText(pretty(t.value))} className="min-h-[40px] px-2 font-medium text-foreground/80 hover:text-brand" data-testid="publisher-template">{t.label}</button>
          ))}
        </div>
        <div className="p-3 sm:p-4 pt-1 space-y-3">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={10}
            className="font-mono text-[12.5px] leading-relaxed" aria-label="Event as JSON" data-testid="publisher-json" />
          <p className="text-[13px]" data-testid="publisher-check" data-verdict={!read.ok ? "error" : verdict?.verdict ?? "unsigned"}>
            {!read.ok ? <span className="text-red-600 dark:text-red-400">{read.error}</span> : (
              <>
                <span className="text-muted-foreground">{plainKindName(read.draft.kind)} · kind {read.draft.kind} · </span>
                {!verdict && <span className="text-muted-foreground">Not signed yet</span>}
                {verdict?.verdict === "valid" && (mine
                  ? <span className="text-emerald-600 dark:text-emerald-400">Genuine · signed by you</span>
                  : <><span className="text-emerald-600 dark:text-emerald-400">Genuine</span><span className="text-muted-foreground"> · signed by someone else — it will be sent exactly as it is</span></>)}
                {verdict?.verdict === "invalid" && <><span className="text-red-600 dark:text-red-400">Not genuine</span><span className="text-muted-foreground"> · {verdict.reason}. Sign it as you to send your own version.</span></>}
              </>
            )}
          </p>
          {risk && (
            risk.level === "serious" ? (
              <label className="flex items-start gap-3 min-h-[44px] text-[13.5px] text-amber-700 dark:text-amber-400" data-testid="publisher-risk">
                <Checkbox checked={understood} onCheckedChange={(v) => setUnderstood(v === true)} className="mt-0.5" data-testid="publisher-understood" />
                <span>{risk.text} <span className="text-muted-foreground">I understand.</span></span>
              </label>
            ) : (
              <p className="text-[13px] text-muted-foreground" data-testid="publisher-risk">{risk.text}</p>
            )
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-t border-black/[0.06] dark:border-white/[0.08]">
          {read.ok && !genuine && (
            <Button onClick={signAsMe} variant="outline" className="h-11 rounded-full px-5" data-testid="publisher-sign">Sign as you</Button>
          )}
          <Button onClick={publish} disabled={blocked} className="h-11 rounded-full px-6" data-testid="publisher-publish">
            Publish to {relays.length} relay{relays.length === 1 ? "" : "s"}
          </Button>
          {!relays.length && <span className="text-[13px] text-muted-foreground">Add a relay above first.</span>}
        </div>
      </section>

      {sent && results && (
        <section aria-label="What happened" data-testid="publisher-results">
          <p className="text-[15px] font-medium" data-testid="publisher-line">{results.line}</p>
          <ul className="mt-2 divide-y divide-black/[0.05] dark:divide-white/[0.06]">
            {results.rows.map((r) => (
              <li key={r.relay} className="grid grid-cols-[1fr_auto] sm:grid-cols-[14rem_10rem_1fr_auto] gap-x-3 gap-y-0.5 items-baseline py-2.5 min-h-[44px] text-[14px]" data-testid="publisher-row" data-relay={r.relay} data-status={r.status}>
                <span className="truncate">{host(r.relay)}</span>
                <span className={`text-right sm:text-left ${STATUS[r.status].cls}`}>{STATUS[r.status].word}</span>
                <span className="col-span-2 sm:col-span-1 text-[13px] text-muted-foreground" data-testid="publisher-reason">
                  {r.reason ? (r.status === "accepted" ? r.reason : `“${r.reason}”`) : ""}
                  {r.status === "needs-sign-in" && challenges.current.has(r.relay) && !signingIn.has(r.relay) && getSignInPolicy(r.relay).policy !== "never" && (
                    <button type="button" onClick={() => signIn(r.relay)} className="ml-3 min-h-[36px] px-3 rounded-full border border-current/30 text-[13px] font-medium text-brand" data-testid="publisher-sign-in">Sign in</button>
                  )}
                </span>
                <span className="hidden sm:block text-right text-[12px] text-muted-foreground tabular-nums">{r.ms !== undefined ? `${r.ms} ms` : ""}</span>
              </li>
            ))}
          </ul>
          <details className="mt-2">
            <summary className="cursor-pointer min-h-[44px] flex items-center text-[13px] text-muted-foreground hover:text-foreground">Everything the relays said</summary>
            <TranscriptList lines={lines} start={sent.start} multi={sent.relays.length > 1} canSignIn={(r) => challenges.current.has(r) && !signingIn.has(r) && sessions.current.has(r) && getSignInPolicy(r).policy !== "never"} onSignIn={signIn} />
          </details>
        </section>
      )}
    </div>
  );
}
