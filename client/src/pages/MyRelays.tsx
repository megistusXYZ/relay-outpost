/**
 * Relays — the home of the server-stack destination (owner, 2026-10-03).
 *
 * If you run a relay, it opens straight on the one you managed last (the
 * console, lib/operated-relays.ts). If you don't, it's the front door: connect
 * a relay you already run, or get one from a host. We never host relays and
 * never stand between you and the host — the host rows are plain links, and
 * the operator has the last word on their relay.
 */
import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { ArrowUpRight, ChevronRight, Link2 } from "lucide-react";
import { ServerStackIcon } from "@/components/icons/ServerStackIcon";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { getLastUsedRelay, pickHomeRelay, useOperatedRelays } from "@/lib/operated-relays";

/** Where to get a relay, best fit for this console first. Plain links: no referral, no cut. */
export const RELAY_HOSTS = [
  {
    id: "relay-tools",
    name: "relay.tools",
    url: "https://feeds.relay.tools",
    line: "Hosted for you. Everything in Relays works with it.",
  },
  {
    id: "self-host",
    name: "Run it yourself",
    url: "https://github.com/fiatjaf/pyramid",
    line: "Free software like pyramid or haven on your own server. Everything in Relays works with it.",
  },
  {
    id: "nostr1",
    name: "nostr1.com",
    url: "https://nostr1.com",
    line: "Hosted for you. The basics work here: bans, removing posts, name and picture.",
  },
] as const;

const ROW =
  "w-full flex items-center gap-3 min-h-[64px] px-4 py-3 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

export function RelaysWelcome() {
  return (
    <div className="max-w-2xl mx-auto px-4 pt-8 pb-12 sm:pt-12" data-testid="relays-welcome">
      <div className="flex flex-col items-center text-center gap-3">
        <span className="w-14 h-14 rounded-2xl bg-brand/10 text-brand inline-flex items-center justify-center" aria-hidden="true">
          <ServerStackIcon className="w-8 h-8" />
        </span>
        <h1 className="text-[24px] sm:text-[28px] font-semibold leading-tight tracking-tight [font-family:var(--font-display)] [text-wrap:balance]">
          Run your own corner of Nostr
        </h1>
        <p className="max-w-[44ch] text-[15px] leading-relaxed text-muted-foreground">
          A relay is where your community's posts live. You run it with a host you choose, and manage everything about it from here.
        </p>
      </div>

      <div className="mt-8 rounded-xl border border-black/[0.08] dark:border-white/[0.08] overflow-hidden">
        <Link href="/my-relays/connect" className={ROW} data-testid="relays-connect">
          <span className="w-9 h-9 rounded-lg bg-brand text-background inline-flex items-center justify-center shrink-0" aria-hidden="true">
            <Link2 className="w-4 h-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium leading-snug">Connect a relay I run</span>
            <span className="block text-[13px] text-muted-foreground leading-snug">We check it's yours, then show what you can manage.</span>
          </span>
          <ChevronRight className="w-4 h-4 text-muted-foreground/60 shrink-0" aria-hidden="true" />
        </Link>
      </div>

      <h2 className="mt-8 mb-2 px-1 text-[13px] font-medium text-muted-foreground">Get a relay</h2>
      <div className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] divide-y divide-black/[0.06] dark:divide-white/[0.06] overflow-hidden" data-testid="relays-hosts">
        {RELAY_HOSTS.map((h) => (
          <a key={h.id} href={h.url} target="_blank" rel="noopener noreferrer" className={ROW} data-testid={`relays-host-${h.id}`}>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium leading-snug">{h.name}</span>
              <span className="block text-[13px] text-muted-foreground leading-snug">{h.line}</span>
            </span>
            <ArrowUpRight className="w-4 h-4 text-muted-foreground/60 shrink-0" aria-hidden="true" />
          </a>
        ))}
      </div>
      <p className="mt-3 px-1 text-[12px] leading-relaxed text-muted-foreground">
        Relay Outpost doesn't host relays or take a cut. You pay the host directly, and your relay answers to you.
      </p>
    </div>
  );
}

export default function MyRelays() {
  useDocumentTitle("Relays");
  const operated = useOperatedRelays();
  const [, navigate] = useLocation();
  const home = pickHomeRelay(operated, getLastUsedRelay());
  useEffect(() => {
    if (home) navigate(`/relay-ops-center/${encodeURIComponent(home)}`, { replace: true });
  }, [home, navigate]);
  if (home) return null;
  return <RelaysWelcome />;
}
