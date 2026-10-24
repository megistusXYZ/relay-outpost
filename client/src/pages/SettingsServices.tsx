import { useEffect, useState } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { PageToolbar } from "@/components/PageToolbar";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { getActiveDefaultRelays } from "@/lib/outpost-relays";
import { SEARCH_RELAYS } from "@/lib/relay-constants";
import { PEOPLE_SEARCH_RELAY } from "@/lib/people-search";
import { getBlossomServers, DEFAULT_BLOSSOM_SERVERS } from "@/lib/media-upload";
import { PROFILE_DIRECTORIES } from "@shared/profile-directories";
import { chooseDiscoverLens } from "@/lib/discover-trust";
import type { ServiceHealthBody } from "@/lib/service-health-view";
import { serviceWord, rowsFor as rowsFromCheck, type ServiceWord, type HealthItemWithTarget } from "@/lib/services-page";

/**
 * Relays & services (owner, 2026-10-23): what Relay Outpost connects to on
 * your behalf, and whether each is answering, from the server's health
 * check (/api/service-health). Read-only: Amethyst's openness behind a
 * plain-words door.
 */

const TONE: Record<ServiceWord["tone"], string> = {
  ok: "text-success dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-300",
  bad: "text-danger dark:text-red-400",
  quiet: "text-muted-foreground",
};

function Group({ title, line, rows, testId }: { title: string; line: string; rows: Array<{ name: string; word: ServiceWord }>; testId: string }) {
  return (
    <section className="rounded-lg border border-border/60 bg-card/60 p-4" data-testid={testId}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-0.5 text-[13px] text-muted-foreground">{line}</p>
      <ul className="mt-3 divide-y divide-border/40">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 truncate text-sm">{r.name}</span>
            <span className={`shrink-0 text-[13px] font-medium ${TONE[r.word.tone]}`}>{r.word.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function SettingsServices() {
  useDocumentTitle("Relays & services");
  const { pubkey } = useNostrAuth();
  const { wotEnabled, scores } = useGrapeRankScores();
  const [health, setHealth] = useState<ServiceHealthBody | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/service-health", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (live) setHealth(b as ServiceHealthBody | null); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const items = (health?.items ?? []) as HealthItemWithTarget[];
  const rowsFor = (urls: readonly string[]) => rowsFromCheck(urls, items);

  const uploads = getBlossomServers();
  const lens = chooseDiscoverLens({ wotEnabled: !!pubkey && wotEnabled, ownScores: scores ?? null });
  const outside = (health?.items ?? []).filter((i) => i.group === "Outside services" || i.group === "Primal");

  return (
    <div className="px-3 sm:px-4 py-4 sm:py-6 pb-[calc(7rem+env(safe-area-inset-bottom))]" data-testid="page-settings-services">
      <div className="max-w-2xl mx-auto space-y-4">
        <PageToolbar
          testId="services-intro"
          inStack
          status={<span>What Relay Outpost connects to for you, and whether each is answering right now.</span>}
        />
        {health?.checkedAt == null && (
          <p className="px-1 text-[13px] text-muted-foreground" data-testid="services-not-checked">The first check hasn't run yet, so nothing is marked.</p>
        )}
        <Group
          testId="services-posts"
          title="Where your posts go"
          line={pubkey ? "Your relays: your posts are sent here, and friends on other apps find them here." : "The relays a new account starts with."}
          rows={rowsFor(getActiveDefaultRelays())}
        />
        <Group testId="services-directories" title="Finding people" line="Directories that keep a copy of everyone's profile, so a name and picture show wherever someone posts." rows={rowsFor(PROFILE_DIRECTORIES)} />
        <Group testId="services-search" title="Search" line="Where searches for people and posts are answered." rows={rowsFor([...SEARCH_RELAYS, PEOPLE_SEARCH_RELAY])} />
        <Group
          testId="services-uploads"
          title="Uploads"
          line={uploads.length ? "Your upload servers: where your pictures and videos are kept." : "Where your pictures and videos are kept until you choose your own."}
          rows={rowsFor(uploads.length ? uploads : DEFAULT_BLOSSOM_SERVERS)}
        />
        <Group
          testId="services-trust"
          title="Trust"
          line={lens === "own" ? "Brainstorm ranks people by your own network." : "Brainstorm ranks people by a shared starting view until your own network is big enough."}
          rows={[{ name: "Brainstorm (NosFabrica)", word: rowsFor(["https://brainstormserver.nosfabrica.com"])[0].word }]}
        />
        {outside.length > 0 && (
          <Group testId="services-outside" title="Outside services" line="Services the app asks for speed, translation, podcasts and prices." rows={outside.map((i) => ({ name: i.label, word: serviceWord(i) }))} />
        )}
      </div>
    </div>
  );
}
