/**
 * Relays › Console — ask any relay anything, and see what it says back.
 * Replaces the old /console (its links redirect here with their query).
 */
import { useMemo } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { parseConsoleQueryParams } from "@/lib/console-query-params";
import { WireConsole } from "./relay-ops/WireConsole";

export default function RelayConsole() {
  useDocumentTitle("Console");
  const params = useMemo(() => parseConsoleQueryParams(window.location.search), []);
  return (
    <div className="max-w-5xl mx-auto px-4 pt-5 pb-24 sm:pt-8" data-testid="page-relay-console">
      <WireConsole initialRelays={params.relays} initialText={params.filterText} />
    </div>
  );
}
