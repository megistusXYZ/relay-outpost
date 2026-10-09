/**
 * Community › Media: every picture, video and file people uploaded to this
 * relay (newlay's Blossom store — lib/relay-media.ts). How much there is, who
 * uploads most, and the files themselves; removing one removes it for
 * everyone, so each removal asks first and lands in the moderation log.
 */
import { useCallback, useEffect, useState } from "react";
import { Film, FileText, Music, Trash2 } from "lucide-react";
import { nip86Call } from "@/lib/nip86";
import { describeMediaStats, mediaIsOff, readMediaPage, type MediaFile, type MediaStatsView } from "@/lib/relay-media";
import { managedAt } from "@/lib/relay-capabilities";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { OpsCard, OpsSectionHeader, ManagedAtNote } from "./ops-ui";
import { addModLogEntry, pubkeyToNpub, resolveProfileBatch, type ProfileInfo } from "./shared";

const PAGE = 48;
type Pending = { kind: "file"; file: MediaFile } | { kind: "person"; pubkey: string; name: string };

export function MediaScreen({ relayUrl }: { relayUrl: string }) {
  const { toast } = useToast();
  const [stats, setStats] = useState<MediaStatsView | null>(null);
  const [off, setOff] = useState(false);
  const [failed, setFailed] = useState(false);
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [profiles, setProfiles] = useState<Map<string, ProfileInfo>>(new Map());
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const nameOf = (pk: string) => profiles.get(pk)?.name || `${pubkeyToNpub(pk).slice(0, 14)}…`;

  const load = useCallback(async () => {
    setFailed(false);
    const [s, page] = await Promise.all([
      nip86Call(relayUrl, "getblobstats", []),
      nip86Call(relayUrl, "listblobs", [{ limit: PAGE }]),
    ]);
    if (mediaIsOff(s.error) || mediaIsOff(page.error)) { setOff(true); return; }
    const view = describeMediaStats(s.result);
    const p = readMediaPage(page.result);
    if (!view || !p) { setFailed(true); return; }
    setStats(view); setFiles(p.files); setNext(p.next);
  }, [relayUrl]);

  useEffect(() => { setStats(null); setFiles([]); setOff(false); load(); }, [load]);

  useEffect(() => {
    const pks = [...new Set([...(stats?.top.map((t) => t.pubkey) ?? []), ...files.flatMap((f) => f.owners)])].filter((pk) => !profiles.has(pk));
    if (!pks.length) return;
    resolveProfileBatch(pks).then((m) => { if (m.size) setProfiles((prev) => new Map([...prev, ...m])); }).catch(() => {});
  }, [stats, files]); // eslint-disable-line react-hooks/exhaustive-deps

  const more = async () => {
    if (!next) return;
    setLoadingMore(true);
    const r = await nip86Call(relayUrl, "listblobs", [{ limit: PAGE, cursor: next }]);
    const p = readMediaPage(r.result);
    if (p) { setFiles((f) => [...f, ...p.files]); setNext(p.next); }
    setLoadingMore(false);
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    if (pending.kind === "file") {
      const r = await nip86Call(relayUrl, "deleteblob", [pending.file.sha256]);
      if (r.error) toast({ title: "Couldn't remove the file", description: r.error, variant: "destructive" });
      else { addModLogEntry(relayUrl, { action: "delete_media" }); toast({ title: "File removed" }); }
    } else {
      const r = await nip86Call<{ deleted: number }>(relayUrl, "deleteblobsbyowner", [pending.pubkey]);
      if (r.error) toast({ title: "Couldn't remove their files", description: r.error, variant: "destructive" });
      else {
        const n = typeof r.result?.deleted === "number" ? r.result.deleted : undefined;
        addModLogEntry(relayUrl, { action: "delete_media_by_owner", targetPubkey: pending.pubkey, count: n });
        toast({ title: n === undefined ? "Their files were removed" : `Removed ${n} file${n === 1 ? "" : "s"}` });
      }
    }
    setPending(null); setBusy(false);
    await load();
  };

  if (off) {
    return (
      <OpsCard data-testid="ops-media-off">
        <p className="text-[15px] font-medium">Your host hasn't switched on media storage here.</p>
        <ManagedAtNote where={managedAt(relayUrl)} lead="Ask them, or" verb="change it" testId="ops-media-host" />
      </OpsCard>
    );
  }
  if (failed) return <OpsCard data-testid="ops-media-failed"><p className="text-[15px]">We couldn't read the media here right now.</p></OpsCard>;
  if (!stats) return null;

  return (
    <div className="space-y-4" data-testid="ops-media">
      <OpsCard>
        <p className="text-[15px] font-medium" data-testid="ops-media-summary">{stats.summary}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">Pictures, videos and files people uploaded here. Removing one removes it for everyone.</p>
      </OpsCard>

      {stats.top.length > 0 && (
        <OpsCard>
          <OpsSectionHeader label="Who uploads most" className="mb-2" />
          <ul className="divide-y divide-black/[0.06] dark:divide-white/[0.06]" data-testid="ops-media-top">
            {stats.top.slice(0, 10).map((t) => {
              const prof = profiles.get(t.pubkey);
              const name = nameOf(t.pubkey);
              return (
                <li key={t.pubkey} className="flex items-center gap-3 py-2 min-h-[56px]">
                  <Avatar className="w-9 h-9 shrink-0">{prof?.picture && <AvatarImage src={prof.picture} alt="" />}<AvatarFallback className="bg-muted">{name.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium truncate">{name}</span>
                    <span className="block text-[13px] text-muted-foreground">{t.line}</span>
                  </span>
                  <Button variant="outline" className="h-11 rounded-full shrink-0" onClick={() => setPending({ kind: "person", pubkey: t.pubkey, name })} data-testid="ops-media-remove-person">
                    Remove all
                  </Button>
                </li>
              );
            })}
          </ul>
        </OpsCard>
      )}

      {files.length > 0 && (
        <OpsCard>
          <OpsSectionHeader label="Files" className="mb-3" />
          <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="ops-media-files">
            {files.map((f) => (
              <li key={f.sha256} className="min-w-0 rounded-lg border border-black/[0.08] dark:border-white/[0.08] overflow-hidden" data-testid="ops-media-file">
                <div className="aspect-square bg-muted flex items-center justify-center">
                  {f.kind === "image" && f.url
                    ? <img src={f.url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                    : f.kind === "video" ? <Film className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
                    : f.kind === "audio" ? <Music className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
                    : <FileText className="w-8 h-8 text-muted-foreground" aria-hidden="true" />}
                </div>
                <div className="flex items-center gap-1 pl-2">
                  <span className="min-w-0 flex-1 text-[12px] text-muted-foreground truncate">{f.size}{f.owners[0] ? ` · ${nameOf(f.owners[0])}` : ""}</span>
                  <button type="button" onClick={() => setPending({ kind: "file", file: f })} className="w-11 h-11 shrink-0 inline-flex items-center justify-center text-muted-foreground hover:text-danger dark:hover:text-red-400" aria-label="Remove this file" data-testid="ops-media-remove-file">
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {next && (
            <Button variant="outline" className="mt-3 h-11 rounded-full w-full sm:w-auto" onClick={more} disabled={loadingMore} data-testid="ops-media-more">
              {loadingMore ? "Loading…" : "Show more"}
            </Button>
          )}
        </OpsCard>
      )}

      <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o && !busy) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.kind === "person" ? `Remove everything ${pending.name} uploaded?` : "Remove this file?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "person"
                ? "Their files go for everyone. A file someone else also uploaded stays for them. This can't be undone."
                : "It goes for everyone who uploaded it, and posts that show it will show a broken picture. This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirm(); }} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="ops-media-confirm">
              {busy ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
