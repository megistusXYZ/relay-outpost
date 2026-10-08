/**
 * Relay Control › Settings › Connection & sign-in.
 *
 * How this app reaches the relay, in one of four plain states (Connected,
 * Retrying, an error said as what's wrong, Offline — this device), how fast
 * it usually answers, when to sign in to it (always, ask first, never), a
 * read-and-write test, and what the relay has told us (its notices).
 *
 * Checks use the app's one shared probe (lib/relay-probe.ts) every 30 s while
 * this screen is open — sooner after a miss, then every minute once it's
 * clearly down.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { pool } from "@/lib/nostr";
import { getSignInPolicy, onAuthChange, setSignInPolicy, signInOnce, type SignInPolicy } from "@/lib/nip42-auth";
import { connectionState, speedLine, TRIES, type ProbeResult } from "@/lib/relay-connection";
import { clearNotices, onRelayRecord, probeHistory, probeRelay, relayNotices, testReadWrite } from "@/lib/relay-probe";
import type { PublishRow } from "@/lib/publisher-model";
import { Button } from "@/components/ui/button";

const TONE = {
  checking: "text-muted-foreground",
  connected: "text-success dark:text-emerald-400",
  retrying: "text-amber-600 dark:text-amber-400",
  error: "text-danger dark:text-red-400",
  offline: "text-muted-foreground",
} as const;

const POLICIES: { id: SignInPolicy; label: string; line: string }[] = [
  { id: "always", label: "Always", line: "Sign in whenever it asks. Members-only posts and managing it need this." },
  { id: "ask", label: "Ask first", line: "Don't sign in on its own — offer a Sign in button when it asks." },
  { id: "never", label: "Never", line: "Never sign in here. It may show you less." },
];

function useDeviceOnline(): boolean {
  return useSyncExternalStore(
    (cb) => { window.addEventListener("online", cb); window.addEventListener("offline", cb); return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); }; },
    () => navigator.onLine,
    () => true,
  );
}

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ConnectionPanel({ relayUrl, relayName }: { relayUrl: string; relayName: string }) {
  const online = useDeviceOnline();
  const [history, setHistory] = useState<ProbeResult[]>(() => probeHistory(relayUrl));
  const [notices, setNotices] = useState(() => relayNotices(relayUrl));
  const [policy, setPolicy] = useState(() => getSignInPolicy(relayUrl));
  const [checking, setChecking] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => onRelayRecord(relayUrl, () => { setHistory(probeHistory(relayUrl)); setNotices(relayNotices(relayUrl)); }), [relayUrl]);
  useEffect(() => onAuthChange(() => setPolicy(getSignInPolicy(relayUrl))), [relayUrl]);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 15_000); return () => clearInterval(t); }, []);

  // Checking on a rhythm: 30 s when all's well, quickly after a miss, every minute once it's down.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const check = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    if (!navigator.onLine) { timer.current = setTimeout(check, 30_000); return; }
    setChecking(true);
    const r = await probeRelay(relayUrl, { record: true });
    setChecking(false);
    const h = probeHistory(relayUrl);
    let misses = 0;
    for (let i = h.length - 1; i >= 0 && !h[i].opened; i--) misses++;
    const next = r.opened ? 30_000 : misses < TRIES ? 3_000 * misses : 60_000;
    timer.current = setTimeout(check, next);
  }, [relayUrl]);
  useEffect(() => { void check(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [check]);

  const state = connectionState(history, online);
  const last = history[history.length - 1];
  const speed = speedLine(history.slice(-20));
  const needsSignIn = online && last?.opened && last.signIn === "needed";

  const choose = (p: SignInPolicy | null) => {
    setSignInPolicy(relayUrl, p);
    setPolicy(getSignInPolicy(relayUrl));
    // The app's own connection starts over under the new rule.
    try { pool.close([relayUrl]); } catch { /* not open */ }
    void check();
  };

  const [test, setTest] = useState<{ busy: boolean; read?: ProbeResult; write?: PublishRow }>({ busy: false });
  const runTest = async () => {
    setTest({ busy: true });
    const r = await testReadWrite(relayUrl);
    setTest({ busy: false, ...r });
  };

  const bars = history.slice(-30);
  const max = Math.max(1, ...bars.map((b) => b.answerMs ?? b.openMs ?? 0));

  return (
    <div className="space-y-8" data-testid="ops-connection">
      {/* Now */}
      <section aria-label="Connection">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className={`text-[20px] font-semibold tracking-tight ${TONE[state.state]}`} data-testid="conn-state" data-state={state.state}>{state.word}</p>
            {state.detail && <p className="mt-0.5 text-[14px] text-muted-foreground" data-testid="conn-detail">{state.detail}</p>}
            {last && <p className="mt-0.5 text-[12px] text-muted-foreground">Checked {ago(last.at)}</p>}
          </div>
          <Button variant="outline" className="h-11 rounded-full px-4 shrink-0" onClick={() => void check()} disabled={checking} data-testid="conn-check">
            {checking ? "Checking…" : "Check now"}
          </Button>
        </div>
        {needsSignIn && (
          <div className="mt-4 border-l-2 border-amber-500 pl-3 py-1" role="status" data-testid="conn-auth-banner">
            <p className="text-[14px] font-medium">Authentication required</p>
            <p className="text-[13px] text-muted-foreground">
              {policy.policy === "never"
                ? `${relayName} asks you to sign in, and you've chosen never to here. It may show you less.`
                : `${relayName} asks you to sign in before it shows everything.`}
            </p>
            {policy.policy !== "never" && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button className="h-11 rounded-full px-4" onClick={() => { signInOnce(relayUrl); try { pool.close([relayUrl]); } catch { /* not open */ } void check(); }} data-testid="conn-sign-in-once">Sign in now</Button>
                <Button variant="ghost" className="h-11 rounded-full px-4" onClick={() => choose("always")} data-testid="conn-sign-in-always">Always sign in here</Button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Sign-in */}
      <section aria-labelledby="conn-policy-h">
        <h3 id="conn-policy-h" className="text-[13px] font-medium text-muted-foreground mb-2">Sign in to {relayName}</h3>
        <div role="radiogroup" aria-labelledby="conn-policy-h" className="divide-y divide-black/[0.06] dark:divide-white/[0.08] border-y border-black/[0.06] dark:border-white/[0.08]">
          {POLICIES.map((p) => {
            const on = policy.policy === p.id;
            return (
              <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => choose(p.id)}
                className="w-full text-left flex items-start gap-3 py-3 min-h-[56px] hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                data-testid={`conn-policy-${p.id}`}>
                <span className={`mt-1 w-4 h-4 rounded-full border shrink-0 ${on ? "border-brand border-[5px]" : "border-black/25 dark:border-white/30"}`} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium">{p.label}</span>
                  <span className="block text-[13px] text-muted-foreground">{p.line}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground" data-testid="conn-policy-why">
          {policy.chosen
            ? <>Your choice. <button type="button" onClick={() => choose(null)} className="min-h-[36px] font-medium text-foreground/80 underline-offset-4 hover:underline" data-testid="conn-policy-default">Use the default</button></>
            : policy.because ? `The default here: ${policy.because.charAt(0).toLowerCase()}${policy.because.slice(1)}.` : "The default for relays you don't run: ask first."}
        </p>
      </section>

      {/* Speed */}
      <section aria-label="Speed">
        <h3 className="text-[13px] font-medium text-muted-foreground mb-2">Speed</h3>
        <p className="text-[14px]" data-testid="conn-speed">{speed ?? "Not enough checks yet."}</p>
        {bars.length > 1 && (
          <div className="mt-3 flex items-end gap-[3px] h-14" aria-hidden="true" data-testid="conn-speed-bars">
            {bars.map((b, i) => (
              <span key={i} className={`flex-1 rounded-sm ${b.opened ? "bg-brand/50" : "bg-red-500/60"}`}
                style={{ height: b.opened ? `${Math.max(6, ((b.answerMs ?? b.openMs ?? 0) / max) * 100)}%` : "100%" }}
                title={b.opened ? `${b.answerMs ?? b.openMs} ms` : "couldn't connect"} />
            ))}
          </div>
        )}
      </section>

      {/* Read & write */}
      <section aria-label="Read and write test">
        <h3 className="text-[13px] font-medium text-muted-foreground mb-2">Can you read and write?</h3>
        <p className="text-[13px] text-muted-foreground">Asks for one post, then sends a short-lived test event signed as you. Relays pass it on and don't keep it.</p>
        <Button variant="outline" className="mt-3 h-11 rounded-full px-4" onClick={runTest} disabled={test.busy} data-testid="conn-test">{test.busy ? "Testing…" : "Test reading and writing"}</Button>
        {test.read && (
          <dl className="mt-3 grid grid-cols-[5rem_1fr] gap-y-1.5 text-[14px]">
            <dt className="text-muted-foreground">Reading</dt>
            <dd data-testid="conn-test-read">{readWords(test.read)}</dd>
            <dt className="text-muted-foreground">Writing</dt>
            <dd data-testid="conn-test-write">{test.write ? writeWords(test.write) : "—"}</dd>
          </dl>
        )}
      </section>

      {/* Notices */}
      <section aria-label="Notices">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-medium text-muted-foreground">What {relayName} has told us</h3>
          {notices.length > 0 && <button type="button" onClick={() => clearNotices(relayUrl)} className="min-h-[44px] px-2 text-[13px] text-muted-foreground hover:text-foreground">Clear</button>}
        </div>
        {notices.length === 0 ? (
          <p className="text-[13px] text-muted-foreground" data-testid="conn-notices-empty">Nothing yet. Relays send notices for things like rate limits and maintenance.</p>
        ) : (
          <ul className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
            {[...notices].reverse().map((n, i) => (
              <li key={i} className="flex items-baseline gap-3 py-2 text-[14px]" data-testid="conn-notice">
                <span className="min-w-0 flex-1">“{n.text}”</span>
                <span className="shrink-0 text-[12px] text-muted-foreground">{ago(n.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function readWords(r: ProbeResult): string {
  if (!r.opened) return `Couldn't connect — ${r.error ?? "no answer"}`;
  if (r.signIn === "refused") return `Sign-in turned down — “${r.error ?? ""}”`;
  if (r.signIn === "needed") return "Wants you to sign in first";
  if (!r.answered) return "Connects, but didn't answer";
  return `Works · ${r.answerMs} ms`;
}

function writeWords(w: PublishRow): string {
  if (w.status === "accepted") return `Works${w.ms !== undefined ? ` · ${w.ms} ms` : ""}`;
  if (w.status === "needs-sign-in") return "Wants you to sign in first";
  if (w.status === "unreached") return `Couldn't connect${w.reason ? ` — ${w.reason}` : ""}`;
  if (w.status === "waiting") return "No answer";
  return `Refused${w.reason ? ` — “${w.reason}”` : ""}`;
}
