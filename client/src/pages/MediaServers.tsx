import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { FolderSync, HardDrive, Plus, Trash2, Satellite, ExternalLink, XCircle, RotateCcw } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { ConfirmAction } from "@/components/ConfirmAction";
import {
  getBlossomServers,
  setBlossomServers,
  fetchBlossomServerList,
  publishBlossomServerList,
  DEFAULT_BLOSSOM_SERVERS,
} from "@/lib/media-upload";
import { normalizeBlossomUrl } from "@/lib/blossom-url";
import {
  enumerateMyMediaUrls,
  runMediaSync,
  clearFailedSyncCheckpoints,
  isMirrorCapableTarget,
  MEDIA_SYNC_EVENT_CAP,
} from "@/lib/media-sync";

// Page-local sync state. Deliberately not module-scope: interrupting a run is
// safe because every blob's outcome is checkpointed (media-sync.ts), so a
// re-run resumes where it left off — the UI just asks the user to stay.
interface SyncUiState {
  server: string;
  phase: "finding" | "running" | "done";
  total: number;
  done: number;
  ok: number;
  failed: number;
  /** Already on the server (previous run or hosted there) — nothing to copy. */
  alreadyDone: number;
  /** Media with no derivable fingerprint — can't be mirrored by hash. */
  skippedNoHash: number;
  capped: boolean;
  current?: string;
  aborted?: boolean;
}

/**
 * Standalone Media Servers (Blossom, kind-10063) manager. Reuses the exact same
 * getters/publishers as the Settings → Media uploads section — no duplicated
 * storage/publish logic, only page chrome + back-to-Tools around them.
 */
export default function MediaServers() {
  useDocumentTitle("Media servers");
  const { pubkey, signer } = useNostrAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [servers, setServers] = useState<string[]>(() => getBlossomServers());
  const [newServer, setNewServer] = useState("");
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  // ── "Sync my media here" (BUD-04 server-to-server mirroring) ──────────────
  const [pendingSync, setPendingSync] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncUiState | null>(null);
  const syncAbortRef = useRef<AbortController | null>(null);
  // Cancel cleanly if the page unmounts mid-run (checkpoints make resume safe).
  useEffect(() => () => syncAbortRef.current?.abort(), []);

  const syncActive = sync !== null && sync.phase !== "done";

  const startSync = async (server: string) => {
    if (!pubkey || !signer || syncActive) return;
    const controller = new AbortController();
    syncAbortRef.current = controller;
    setSync({ server, phase: "finding", total: 0, done: 0, ok: 0, failed: 0, alreadyDone: 0, skippedNoHash: 0, capped: false });

    const found = await enumerateMyMediaUrls(pubkey);
    if (controller.signal.aborted) return;
    if (found.items.length === 0) {
      setSync({ server, phase: "done", total: 0, done: 0, ok: 0, failed: 0, alreadyDone: 0, skippedNoHash: found.skippedNoHash, capped: found.capped });
      return;
    }

    setSync({ server, phase: "running", total: found.items.length, done: 0, ok: 0, failed: 0, alreadyDone: 0, skippedNoHash: found.skippedNoHash, capped: found.capped });
    const result = await runMediaSync({
      items: found.items,
      targetServer: server,
      signer,
      signal: controller.signal,
      onProgress: (p) => {
        setSync((s) => (s && s.server === server ? { ...s, done: p.done, failed: p.failed, alreadyDone: p.alreadyDone, current: p.current } : s));
      },
    });
    setSync((s) =>
      s && s.server === server
        ? { ...s, phase: "done", done: result.total, ok: result.ok, failed: result.failed, alreadyDone: result.alreadyDone, aborted: result.aborted, current: undefined }
        : s,
    );
  };

  const retryFailed = () => {
    if (!sync) return;
    clearFailedSyncCheckpoints(sync.server);
    void startSync(sync.server);
  };

  const hostOf = (url: string) => {
    try { return new URL(url).host; } catch { return url; }
  };

  useEffect(() => {
    if (!pubkey) setLocation("/");
  }, [pubkey, setLocation]);

  useEffect(() => {
    if (!pubkey) return;
    setLoading(true);
    fetchBlossomServerList(pubkey)
      .then((fetched) => {
        if (fetched.length > 0) setServers(fetched);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [pubkey]);

  const addServer = () => {
    const result = normalizeBlossomUrl(newServer);
    if (!result.ok) {
      if (result.reason === "invalid") toast({ title: "Invalid server URL", variant: "destructive" });
      return;
    }
    if (servers.includes(result.url)) {
      toast({ title: "Server already added", variant: "destructive" });
      return;
    }
    const updated = [...servers, result.url];
    setServers(updated);
    setBlossomServers(updated);
    setNewServer("");
  };

  const removeServer = (url: string) => {
    const updated = servers.filter((s) => s !== url);
    setServers(updated);
    setBlossomServers(updated);
  };

  const handlePublish = async () => {
    if (!signer || !pubkey) return;
    setPublishing(true);
    try {
      const ok = await publishBlossomServerList(servers, signer);
      toast(ok ? { title: "Media server list published" } : { title: "Failed to publish server list", variant: "destructive" });
    } catch {
      toast({ title: "Failed to publish server list", variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  };

  if (!pubkey) return null;

  return (
    <div className="max-w-xl mx-auto px-4 py-10 space-y-5" data-testid="page-media-servers">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/15 text-brand">
          <HardDrive className="h-4 w-4" />
        </span>
        <h1 className="text-lg font-brand uppercase tracking-widest">Media servers</h1>
      </div>

      <p className="text-sm text-muted-foreground/70 leading-relaxed">
        Where your images &amp; videos live. Uploads try your servers first, then fall back to the default host.
      </p>

      <Card className="glass-card p-4 sm:p-5 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 py-2">
            <RelayOutpostInlineLoader className="w-3.5 h-3.5 text-brand" />
            <span className="text-xs text-muted-foreground/60">Fetching server list…</span>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <Input
                value={newServer}
                onChange={(e) => setNewServer(e.target.value)}
                placeholder="https://blossom.example.com"
                className="text-xs bg-white/[0.03] border-border dark:border-brand/15 focus-visible:border-brand/40 dark:focus-visible:border-brand/30"
                data-testid="input-blossom-server"
                onKeyDown={(e) => { if (e.key === "Enter") addServer(); }}
              />
              <Button
                size="icon"
                variant="outline"
                onClick={addServer}
                disabled={!newServer.trim()}
                className="border-border dark:border-brand/15 bg-muted"
                data-testid="button-add-blossom-server"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {servers.length === 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-foreground/65 dark:text-muted-foreground/70" data-testid="text-no-blossom-servers">
                  No media servers configured yet. Use the recommended set or add your own.
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setServers(DEFAULT_BLOSSOM_SERVERS);
                    setBlossomServers(DEFAULT_BLOSSOM_SERVERS);
                    toast({ title: "Recommended media servers added" });
                  }}
                  className="w-full text-xs font-brand uppercase tracking-widest border-border dark:border-brand/15 bg-muted"
                  data-testid="button-use-recommended-blossom-servers"
                >
                  <Satellite className="w-3.5 h-3.5 mr-2" />
                  Use Recommended Servers
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5" data-testid="list-blossom-servers">
                {servers.map((server) => (
                  <div
                    key={server}
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-2"
                    style={{ border: "1px solid rgba(140, 100, 220, 0.12)" }}
                    data-testid={`blossom-server-${server.replace(/[^a-z0-9]/gi, "-")}`}
                  >
                    <HardDrive className="w-3.5 h-3.5 text-brand shrink-0" />
                    <span className="flex-1 min-w-0 text-xs font-mono text-foreground/80 truncate">{server}</span>
                    {signer && isMirrorCapableTarget(server) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setPendingSync(server)}
                        disabled={syncActive}
                        className="min-h-11 min-w-11"
                        aria-label={`Sync my media to ${hostOf(server)}`}
                        title="Sync my media here"
                        data-testid={`button-sync-blossom-${server.replace(/[^a-z0-9]/gi, "-")}`}
                      >
                        <FolderSync className="w-3.5 h-3.5 text-muted-foreground/60" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPendingRemove(server)}
                      className="min-h-11 min-w-11"
                      aria-label={`Remove ${hostOf(server)}`}
                      data-testid={`button-remove-blossom-${server.replace(/[^a-z0-9]/gi, "-")}`}
                    >
                      <Trash2 className="w-3 h-3 text-muted-foreground/60" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {servers.length > 0 && signer && (
              <Button
                onClick={handlePublish}
                disabled={publishing}
                variant="outline"
                className="w-full text-xs font-brand uppercase tracking-widest border-border dark:border-brand/15 bg-muted"
                data-testid="button-publish-blossom-servers"
              >
                {publishing ? (
                  <RelayOutpostInlineLoader className="w-3.5 h-3.5 mr-2" />
                ) : (
                  <ExternalLink className="w-3.5 h-3.5 mr-2" />
                )}
                Publish Server List
              </Button>
            )}
          </>
        )}
      </Card>

      {sync && (
        <Card className="glass-card p-4 sm:p-5 space-y-3" data-testid="card-media-sync">
          <div className="flex items-center gap-2">
            <FolderSync className="w-3.5 h-3.5 text-brand shrink-0" />
            <span className="flex-1 min-w-0 text-xs font-brand uppercase tracking-widest truncate">
              {sync.phase === "done" ? "Media sync" : "Syncing media"} · {hostOf(sync.server)}
            </span>
            {sync.phase !== "done" && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => syncAbortRef.current?.abort()}
                className="min-h-11 min-w-11"
                aria-label="Cancel media sync"
                data-testid="button-cancel-media-sync"
              >
                <XCircle className="w-3.5 h-3.5 text-muted-foreground/60" />
              </Button>
            )}
          </div>

          {sync.phase === "finding" && (
            <div className="flex items-center gap-2 py-1">
              <RelayOutpostInlineLoader className="w-3.5 h-3.5 text-brand" />
              <span className="text-xs text-muted-foreground/60">Finding your published media…</span>
            </div>
          )}

          {sync.phase === "running" && (
            <div className="space-y-2">
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${sync.total > 0 ? Math.round((sync.done / sync.total) * 100) : 0}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground/70" data-testid="text-media-sync-progress">
                {sync.done} / {sync.total}
                {sync.failed > 0 && <span className="text-destructive"> · {sync.failed} failed</span>}
              </p>
              {sync.current && (
                <p className="text-[11px] font-mono text-muted-foreground/50 truncate" data-testid="text-media-sync-current">
                  {sync.current}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground/50">
                Stay on this page while syncing. Progress is saved — if you leave, the next sync picks up where this one stopped.
              </p>
            </div>
          )}

          {sync.phase === "done" && (
            <div className="space-y-2">
              <p className="text-xs text-foreground/80" data-testid="text-media-sync-summary">
                {sync.aborted && "Cancelled — "}
                Synced {sync.ok}
                {sync.alreadyDone > 0 && <> · {sync.alreadyDone} already there</>}
                {" · "}{sync.failed} failed
                {" · "}{sync.skippedNoHash} skipped (no fingerprint)
              </p>
              {sync.skippedNoHash > 0 && (
                <p className="text-[11px] text-muted-foreground/50">
                  Skipped files have no content fingerprint — posted before mirroring existed or from another host — so they can't be copied by hash.
                </p>
              )}
              {sync.capped && (
                <p className="text-[11px] text-muted-foreground/50">
                  Scanned your {MEDIA_SYNC_EVENT_CAP} most recent posts — older media may not be covered.
                </p>
              )}
              <div className="flex gap-2">
                {(sync.failed > 0 || sync.aborted) && (
                  <Button
                    variant="outline"
                    onClick={retryFailed}
                    className="flex-1 text-xs font-brand uppercase tracking-widest border-border dark:border-brand/15 bg-muted"
                    data-testid="button-retry-media-sync"
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-2" />
                    {sync.aborted ? "Resume" : "Retry Failed"}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => setSync(null)}
                  className="flex-1 text-xs font-brand uppercase tracking-widest"
                  data-testid="button-dismiss-media-sync"
                >
                  Dismiss
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <ConfirmAction
        open={!!pendingRemove}
        onOpenChange={(o) => { if (!o) setPendingRemove(null); }}
        title={pendingRemove ? `Remove ${hostOf(pendingRemove)}?` : "Remove server?"}
        description="New uploads will no longer be stored here. Existing files already on this server stay where they are. Publish your list afterwards to sync the change to your relays."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => { if (pendingRemove) removeServer(pendingRemove); setPendingRemove(null); }}
      />

      <ConfirmAction
        open={!!pendingSync}
        onOpenChange={(o) => { if (!o) setPendingSync(null); }}
        title={pendingSync ? `Sync your media to ${hostOf(pendingSync)}?` : "Sync your media?"}
        description="Copies your existing media to this server, server-to-server. Your device only coordinates — nothing re-uploads. Keep this page open; progress is saved, so an interrupted sync resumes where it stopped."
        confirmLabel="Start Sync"
        variant="default"
        onConfirm={() => { if (pendingSync) void startSync(pendingSync); setPendingSync(null); }}
      />
    </div>
  );
}
