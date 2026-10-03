/**
 * Connect a relay you run (owner, 2026-10-03).
 *
 *   1. paste its address;
 *   2. we read its public info and ask it, signed, what you may manage;
 *   3. it's yours if it names your key or accepts your request
 *      (lib/relay-ownership.ts) — the relay decides, not us;
 *   4. you see, in plain words, what you can do here and what happens at
 *      your host, before anything is saved.
 *
 * "We couldn't reach it" is never reported as "it isn't yours".
 */
import { useCallback, useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Check, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ErrorScreen } from "@/components/ErrorScreen";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { fetchNip11, supportsNip, type Nip11Document } from "@/lib/nip11";
import { probeRelayManagement } from "@/lib/nip86";
import { decideOwnership, describeManagement, type Ownership, type ManagementSummary } from "@/lib/relay-ownership";
import { managedAt } from "@/lib/relay-capabilities";
import { connectOperatedRelay, setLastUsedRelay } from "@/lib/operated-relays";
import { normalizeRelayAddress } from "@/lib/relay-address";

type Result = {
  url: string;
  nip11: Nip11Document | null;
  ownership: Ownership;
  summary: ManagementSummary;
};

export default function ConnectRelay() {
  useDocumentTitle("Connect a relay");
  const { pubkey } = useNostrAuth();
  const [, navigate] = useLocation();
  const search = useSearch();
  const [address, setAddress] = useState(() => new URLSearchParams(search).get("url") ?? "");
  const [invalid, setInvalid] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const check = useCallback(async (raw: string) => {
    const url = normalizeRelayAddress(raw);
    if (!url) { setInvalid(true); return; }
    if (!pubkey) return;
    setInvalid(false);
    setResult(null);
    setChecking(true);
    const [nip11, probe] = await Promise.all([
      fetchNip11(url).catch(() => null),
      probeRelayManagement(url, { fresh: true }),
    ]);
    const ownership = decideOwnership({ pubkey, nip11, caps: probe.caps, managementReached: probe.reached });
    const summary = describeManagement(probe.caps, { speaks86: !!nip11 && supportsNip(nip11, 86) });
    setResult({ url, nip11, ownership, summary });
    setChecking(false);
  }, [pubkey]);

  // A link that already carries the address checks it straight away.
  useEffect(() => {
    const preset = new URLSearchParams(search).get("url");
    if (preset && pubkey) void check(preset);
    // Runs once a signer is known; `check` and `search` are read at that moment on purpose.
  }, [pubkey]);

  if (!pubkey) {
    return (
      <ErrorScreen
        kind="denied"
        title="Sign in to connect your relay"
        body="Connecting proves the relay is yours with your key, so you need to be signed in."
        primary={{ label: "Sign in", href: "/login" }}
        testId="connect-relay-signed-out"
      />
    );
  }

  const open = () => {
    if (!result) return;
    const label = result.nip11?.name?.trim() || result.url.replace(/^wss?:\/\//, "");
    connectOperatedRelay(result.url, label);
    setLastUsedRelay(result.url);
    navigate(`/relay-ops-center/${encodeURIComponent(result.url)}`);
  };

  return (
    <div className="max-w-xl mx-auto px-4 pt-6 pb-12 sm:pt-10" data-testid="connect-relay">
      <p className="text-[15px] leading-relaxed text-muted-foreground" data-testid="connect-relay-lead">
        Paste the address of a relay you run. We'll ask the relay whether your key runs it, then show what you can manage here.
      </p>

      <form
        className="mt-5 flex flex-col sm:flex-row gap-2"
        onSubmit={(e) => { e.preventDefault(); void check(address); }}
      >
        <label htmlFor="connect-relay-address" className="sr-only">Relay address</label>
        <Input
          id="connect-relay-address"
          value={address}
          onChange={(e) => { setAddress(e.target.value); setInvalid(false); }}
          placeholder="wss://your-relay.example.com"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="h-11 min-h-[44px] text-[15px] sm:flex-1"
          aria-invalid={invalid}
          aria-describedby={invalid ? "connect-relay-invalid" : undefined}
          data-testid="connect-relay-input"
        />
        <Button type="submit" disabled={checking || !address.trim()} className="h-11 rounded-full px-6 text-[15px]" data-testid="connect-relay-check">
          {checking ? <RelayOutpostInlineLoader className="w-4 h-4 mr-2" /> : null}
          {checking ? "Checking" : "Check"}
        </Button>
      </form>
      {invalid && (
        <p id="connect-relay-invalid" className="mt-2 text-[13px] text-destructive" data-testid="connect-relay-invalid">
          That doesn't look like a relay address. It usually starts with wss://
        </p>
      )}
      {checking && (
        <p className="mt-4 text-[13px] text-muted-foreground" role="status" data-testid="connect-relay-checking">
          Asking the relay who runs it and what it lets you manage…
        </p>
      )}

      {result && !checking && <Verdict result={result} onOpen={open} onRetry={() => void check(result.url)} />}
    </div>
  );
}

function Verdict({ result, onOpen, onRetry }: { result: Result; onOpen: () => void; onRetry: () => void }) {
  const { url, nip11, ownership, summary } = result;
  const host = url.replace(/^wss?:\/\//, "");
  const where = managedAt(url);

  if (ownership.kind === "unreachable") {
    return (
      <ErrorScreen
        layout="inline"
        kind="unreachable"
        title="We couldn't reach this relay"
        body="Check the address, or try again once it's back online. Nothing was saved."
        primary={{ label: "Try again", onClick: onRetry, testId: "connect-relay-retry" }}
        className="mt-6"
        testId="connect-relay-unreachable"
      />
    );
  }
  if (ownership.kind === "not-yours") {
    return (
      <ErrorScreen
        layout="inline"
        kind="denied"
        title="This relay is run by someone else"
        body={`It doesn't list your key as its owner or a moderator, and it didn't accept your management request. If it is yours, add your key as its owner in ${where.url ? `its settings at ${where.name}` : where.name}, then check again.`}
        primary={{ label: "Check again", onClick: onRetry, testId: "connect-relay-retry" }}
        className="mt-6"
        testId="connect-relay-not-yours"
      />
    );
  }
  if (ownership.kind === "cannot-tell") {
    return (
      <ErrorScreen
        layout="inline"
        kind="link"
        title="We can't tell who runs this relay"
        body={`It doesn't name an owner and doesn't accept management requests. Add your key as its owner (the "pubkey" in its settings, in ${where.name}), then check again.`}
        primary={{ label: "Check again", onClick: onRetry, testId: "connect-relay-retry" }}
        className="mt-6"
        testId="connect-relay-cannot-tell"
      />
    );
  }

  const name = nip11?.name?.trim() || host;
  return (
    <section className="mt-6 rounded-2xl border border-black/[0.08] dark:border-white/[0.08] p-4 sm:p-5" data-testid="connect-relay-yours">
      <div className="flex items-center gap-3">
        <Avatar className="w-12 h-12 rounded-xl shrink-0 border border-black/[0.06] dark:border-white/[0.08]">
          {nip11?.icon && <AvatarImage src={nip11.icon} alt="" className="object-cover" />}
          <AvatarFallback className="rounded-xl bg-brand/10 text-brand font-semibold">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold leading-tight truncate">{name}</h2>
          <p className="text-[13px] text-muted-foreground truncate">{host}</p>
        </div>
      </div>
      <p className="mt-4 text-[15px] font-medium text-brand" data-testid="connect-relay-verdict">
        {ownership.via === "named" ? "This relay lists you as its operator." : "This relay confirmed you manage it."}
      </p>

      {summary.can.length > 0 && (
        <>
          <h3 className="mt-4 text-[13px] font-medium text-muted-foreground">From here you can</h3>
          <ul className="mt-1.5 space-y-1.5" data-testid="connect-relay-can">
            {summary.can.map((line) => (
              <li key={line} className="flex items-start gap-2 text-[15px] leading-snug">
                <Check className="w-4 h-4 mt-0.5 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />{line}
              </li>
            ))}
          </ul>
        </>
      )}
      {summary.elsewhere.length > 0 && (
        <>
          <h3 className="mt-4 text-[13px] font-medium text-muted-foreground">
            Changed {where.url ? <>at <a href={where.url} target="_blank" rel="noopener noreferrer" className="text-brand underline-offset-4 hover:underline">{where.name}<ArrowUpRight className="inline w-3 h-3 ml-0.5" aria-hidden="true" /></a></> : <>in {where.name}</>}
          </h3>
          <ul className="mt-1.5 space-y-1" data-testid="connect-relay-elsewhere">
            {summary.elsewhere.map((line) => (
              <li key={line} className="text-[15px] leading-snug text-muted-foreground">{line}</li>
            ))}
          </ul>
        </>
      )}
      {summary.note && <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground" data-testid="connect-relay-note">{summary.note}</p>}

      <Button onClick={onOpen} className="mt-5 w-full sm:w-auto h-11 rounded-full px-6 text-[15px]" data-testid="connect-relay-open">
        Manage {name}
      </Button>
    </section>
  );
}
