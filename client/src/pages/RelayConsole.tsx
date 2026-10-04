/**
 * Relays › Console — ask any relay anything, and see what it says back.
 * Replaces the old /console (its links redirect here with their query).
 */
import { useMemo } from "react";
import { useSearch } from "wouter";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { parseConsoleQueryParams } from "@/lib/console-query-params";
import { WireConsole } from "./relay-ops/WireConsole";

export default function RelayConsole() {
  useDocumentTitle("Console");
  // A link into the console (e.g. the inspector's "Edit in publisher") opens it afresh.
  const search = useSearch();
  const params = useMemo(() => {
    const p = parseConsoleQueryParams(search);
    const sp = new URLSearchParams(search);
    return { ...p, tool: sp.get("tool") === "publish" ? "publish" as const : "ask" as const, eventText: sp.get("event") };
  }, [search]);
  return (
    <div className="max-w-5xl mx-auto px-4 pt-5 pb-24 sm:pt-8" data-testid="page-relay-console">
      <WireConsole
        key={search}
        initialRelays={params.relays}
        initialText={params.filterText}
        initialTool={params.tool}
        initialEvent={params.eventText}
      />
    </div>
  );
}
