import { useState, useEffect, useCallback } from "react";
import { DEFAULT_RELAYS } from "@/lib/nostr";
import { Circle, RefreshCw } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { fetchRelayLists, getRelayListMeta } from "@/lib/outbox";

interface RelayStatus {
  url: string;
  status: "connecting" | "connected" | "error";
}

interface Nip65Entry extends RelayStatus {
  mode: "read" | "write" | "both";
}

type DiscoveryState = "idle" | "loading" | "found" | "empty" | "failed";

async function probeRelay(url: string, timeoutMs = 4000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        try { ws.close(); } catch {}
        resolve(false);
      }, timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve(true);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
    } catch {
      resolve(false);
    }
  });
}

async function probeRelays(urls: string[]): Promise<Map<string, boolean>> {
  const results = await Promise.all(urls.map((u) => probeRelay(u)));
  const map = new Map<string, boolean>();
  urls.forEach((url, i) => map.set(url, results[i]));
  return map;
}

export function RelayPanel() {
  const { pubkey } = useNostrAuth();
  const [relays, setRelays] = useState<RelayStatus[]>(
    DEFAULT_RELAYS.map((url) => ({ url, status: "connecting" as const })),
  );
  const [nip65Entries, setNip65Entries] = useState<Nip65Entry[]>([]);
  const [discovery, setDiscovery] = useState<DiscoveryState>("idle");

  const checkRelayStatus = useCallback(async () => {
    const probes = await probeRelays(DEFAULT_RELAYS);
    setRelays(DEFAULT_RELAYS.map((url) => ({ url, status: probes.get(url) ? "connected" : "error" })));
  }, []);

  const discoverUserRelays = useCallback(async () => {
    if (!pubkey) {
      setNip65Entries([]);
      setDiscovery("idle");
      return;
    }
    setDiscovery("loading");
    const before = getRelayListMeta(pubkey);
    const beforeFp = before.prefs.map((p) => `${p.url}|${p.mode}`).sort().join(",");
    fetchRelayLists([pubkey], { force: true });
    const deadline = Date.now() + 6000;
    let changed = false;
    while (Date.now() < deadline) {
      const now = getRelayListMeta(pubkey);
      const nowFp = now.prefs.map((p) => `${p.url}|${p.mode}`).sort().join(",");
      if (nowFp !== beforeFp || now.ts > before.ts) {
        changed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    const after = getRelayListMeta(pubkey);
    if (changed) {
      if (after.prefs.length === 0) {
        setNip65Entries([]);
        setDiscovery("empty");
        return;
      }
      const initial: Nip65Entry[] = after.prefs.map((p) => ({ url: p.url, mode: p.mode, status: "connecting" as const }));
      setNip65Entries(initial);
      setDiscovery("found");
      const probes = await probeRelays(after.prefs.map((p) => p.url));
      setNip65Entries(after.prefs.map((p) => ({
        url: p.url,
        mode: p.mode,
        status: probes.get(p.url) ? "connected" : "error",
      })));
    } else if (after.prefs.length > 0) {
      const initial: Nip65Entry[] = after.prefs.map((p) => ({ url: p.url, mode: p.mode, status: "connecting" as const }));
      setNip65Entries(initial);
      setDiscovery("found");
      const probes = await probeRelays(after.prefs.map((p) => p.url));
      setNip65Entries(after.prefs.map((p) => ({
        url: p.url,
        mode: p.mode,
        status: probes.get(p.url) ? "connected" : "error",
      })));
    } else {
      setNip65Entries([]);
      setDiscovery("failed");
    }
  }, [pubkey]);

  useEffect(() => {
    checkRelayStatus();
    const interval = setInterval(checkRelayStatus, 30000);
    return () => clearInterval(interval);
  }, [checkRelayStatus]);

  useEffect(() => {
    discoverUserRelays();
  }, [discoverUserRelays]);

  const connectedCount = relays.filter((r) => r.status === "connected").length;

  const renderStatusDot = (status: RelayStatus["status"]) => {
    const color =
      status === "connected"
        ? "text-emerald-500"
        : status === "connecting"
          ? "text-yellow-500 animate-pulse"
          : "text-muted-foreground/60";
    return <Circle className={`w-2 h-2 fill-current shrink-0 ${color}`} />;
  };

  const renderModeBadge = (mode: Nip65Entry["mode"]) => {
    const label = mode === "both" ? "r/w" : mode;
    const tone =
      mode === "write"
        ? "text-brand/80 border-brand/30"
        : mode === "read"
          ? "text-brand/80 border-brand/30"
          : "text-emerald-500/80 border-emerald-500/30";
    return (
      <span
        className={`text-[9px] font-mono uppercase tracking-wider px-1 py-[1px] rounded border ${tone}`}
        data-testid={`nip65-mode-${mode}`}
      >
        {label}
      </span>
    );
  };

  return (
    <div
      className="relative rounded-md border overflow-visible border-brand/12 bg-white/60 backdrop-blur-sm dark:border-brand/15 dark:bg-transparent"
      data-testid="card-relay-panel"
    >
      <div
        className="absolute inset-0 rounded-md pointer-events-none hidden dark:block opacity-25"
        style={{
          background: "linear-gradient(135deg, hsl(240 15% 4%) 0%, hsl(260 20% 7%) 40%, hsl(220 25% 5%) 100%)",
        }}
      />
      <div
        className="absolute inset-0 rounded-md pointer-events-none hidden dark:block opacity-25"
        style={{
          background: "radial-gradient(ellipse at 80% 20%, hsl(220 50% 18% / 0.3) 0%, transparent 60%), radial-gradient(ellipse at 20% 80%, hsl(270 40% 15% / 0.2) 0%, transparent 50%)",
        }}
      />
      <div className="relative p-4 space-y-3">
        <p className="text-xs text-muted-foreground/60" data-testid="text-relay-count">
          {connectedCount} of {relays.length} relays reachable
        </p>
        <div className="space-y-2">
          {relays.map((relay) => (
            <div
              key={`default-${relay.url}`}
              className="flex items-center gap-2 text-xs"
              data-testid={`relay-item-${relay.url.replace(/[^a-zA-Z0-9]/g, "_")}`}
            >
              {renderStatusDot(relay.status)}
              <span className="text-muted-foreground/70 truncate font-mono">
                {relay.url.replace("wss://", "")}
              </span>
            </div>
          ))}
        </div>

        {pubkey && (
          <div className="pt-3 border-t border-brand/15 space-y-2" data-testid="section-user-nip65-relays">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-brand/80 dark:text-brand/70">
                Your Relay List (NIP-65)
              </p>
              <button
                onClick={discoverUserRelays}
                className="rounded-full p-1 hover:bg-brand/10 transition-colors text-muted-foreground/60 hover:text-brand"
                aria-label="Re-discover NIP-65 relays"
                data-testid="button-rediscover-nip65"
              >
                <RefreshCw className={`w-3 h-3 ${discovery === "loading" ? "animate-spin" : ""}`} />
              </button>
            </div>
            {discovery === "loading" && (
              <p className="text-[11px] text-muted-foreground/60" data-testid="text-nip65-loading">
                Discovering your relay list...
              </p>
            )}
            {discovery === "empty" && (
              <p className="text-[11px] text-muted-foreground/60" data-testid="text-nip65-empty">
                No NIP-65 relay list published. Your notes go to the default relays above.
              </p>
            )}
            {discovery === "failed" && (
              <p className="text-[11px] text-amber-500/80" data-testid="text-nip65-failed">
                Could not reach discovery relays. Press refresh to retry.
              </p>
            )}
            {discovery === "found" && nip65Entries.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] text-muted-foreground/50 italic" data-testid="text-nip65-discovered">
                  discovered from network
                </p>
                {nip65Entries.map((entry) => (
                  <div
                    key={`nip65-${entry.url}`}
                    className="flex items-center gap-2 text-xs"
                    data-testid={`nip65-item-${entry.url.replace(/[^a-zA-Z0-9]/g, "_")}`}
                  >
                    {renderStatusDot(entry.status)}
                    <span className="text-muted-foreground/70 truncate font-mono flex-1 min-w-0">
                      {entry.url.replace("wss://", "")}
                    </span>
                    {renderModeBadge(entry.mode)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
