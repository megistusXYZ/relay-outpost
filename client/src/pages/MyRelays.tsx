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
import { useLocation } from "wouter";
import { RelaysWelcome } from "@/components/relays/RelaysWelcome";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { getLastUsedRelay, pickHomeRelay, useOperatedRelays } from "@/lib/operated-relays";

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
