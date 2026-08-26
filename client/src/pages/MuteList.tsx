import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { nip19 } from "nostr-tools";
import { VolumeX, X, Hash, UserX } from "lucide-react";
import { use$ } from "applesauce-react/hooks";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useNostrMuteList } from "@/hooks/use-nostr-mute-list";
import { eventStore, getCachedProfile, fetchProfilesCached } from "@/lib/nostr";
import { KIND_METADATA, getDisplayName, getAvatarUrl, shortenNpub } from "@/lib/nostr-helpers";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { ConfirmAction } from "@/components/ConfirmAction";

function MutedUserRow({ pubkey, onUnmute }: { pubkey: string; onUnmute: (pk: string, name: string) => void }) {
  const npub = useMemo(() => {
    try { return nip19.npubEncode(pubkey); } catch { return null; }
  }, [pubkey]);

  const storeEvent = use$(
    () => eventStore.replaceable(KIND_METADATA, pubkey),
    [pubkey],
  );

  useEffect(() => { fetchProfilesCached([pubkey]); }, [pubkey]);

  const { name, avatar, href } = useMemo(() => {
    const event = storeEvent ?? getCachedProfile(pubkey);
    const resolved = event ? getDisplayName(event) : undefined;
    const av = event ? getAvatarUrl(event) : undefined;
    const fallback = npub ? shortenNpub(npub) : pubkey.slice(0, 8) + "…";
    return {
      name: resolved && resolved.trim() ? resolved : fallback,
      avatar: av || "",
      href: npub ? `/profile/${npub}` : "#",
    };
  }, [pubkey, npub, storeEvent]);

  return (
    <div
      className="flex items-center gap-3 rounded-md px-2.5 py-2"
      style={{ border: "1px solid rgba(140, 100, 220, 0.12)" }}
      data-testid={`muted-pubkey-${pubkey.slice(0, 12)}`}
    >
      <Link href={href} className="shrink-0">
        <Avatar className="h-8 w-8">
          <AvatarImage src={avatar} alt={name} />
          <AvatarFallback className="text-[10px]">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      </Link>
      <Link href={href} className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-foreground/85 truncate hover:text-foreground transition-colors">{name}</span>
        <span className="block text-[11px] text-muted-foreground/50 font-mono truncate">{npub ? shortenNpub(npub) : ""}</span>
      </Link>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onUnmute(pubkey, name)}
        className="shrink-0 text-xs min-h-11 border-border dark:border-brand/15 bg-muted"
        data-testid={`button-unmute-${pubkey.slice(0, 12)}`}
      >
        Unmute
      </Button>
    </div>
  );
}

/**
 * Muted list manager (kind-10000). Lists muted people (resolved to profiles)
 * and muted keywords, reusing the useNostrMuteList hook's mutate/publish path —
 * no duplicated mute storage or publishing logic here.
 */
export default function MuteList() {
  useDocumentTitle("Muted");
  const { pubkey } = useNostrAuth();
  const [, setLocation] = useLocation();
  const { mutedPubkeys, mutedKeywords, isLoading, unmutePubkey, removeKeyword } = useNostrMuteList();
  const [confirm, setConfirm] = useState<
    | { title: string; description: string; confirmLabel: string; onConfirm: () => void }
    | null
  >(null);

  useEffect(() => {
    if (!pubkey) setLocation("/");
  }, [pubkey, setLocation]);

  if (!pubkey) return null;

  const requestUnmute = (pk: string, name: string) => {
    setConfirm({
      title: `Unmute ${name}?`,
      description: "Their posts will start showing up in your feeds again. This updates your mute list on your relays.",
      confirmLabel: "Unmute",
      onConfirm: () => { void unmutePubkey(pk); },
    });
  };

  const requestRemoveKeyword = (kw: string) => {
    setConfirm({
      title: `Remove “${kw}”?`,
      description: "Posts containing this word will no longer be hidden. This updates your mute list on your relays.",
      confirmLabel: "Remove",
      onConfirm: () => { void removeKeyword(kw); },
    });
  };

  const hasNothing = !isLoading && mutedPubkeys.length === 0 && mutedKeywords.length === 0;

  return (
    <div className="max-w-xl mx-auto px-4 py-10 space-y-5" data-testid="page-muted">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/15 text-brand">
          <VolumeX className="h-4 w-4" />
        </span>
        <h1 className="text-lg font-brand uppercase tracking-widest">Muted</h1>
      </div>

      <p className="text-sm text-muted-foreground/70 leading-relaxed">
        People and words you've hidden. Unmuting republishes your mute list to relays.
      </p>

      {isLoading ? (
        <Card className="glass-card p-8 flex items-center justify-center gap-2">
          <RelayOutpostInlineLoader className="w-4 h-4 text-brand" />
          <span className="text-xs text-muted-foreground/60">Loading your mute list…</span>
        </Card>
      ) : hasNothing ? (
        <Card className="glass-card p-8 text-center space-y-2">
          <VolumeX className="h-6 w-6 mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground/70">You haven't muted anyone or any words yet.</p>
        </Card>
      ) : (
        <>
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground/60">
              <UserX className="h-3.5 w-3.5" />
              People <span className="text-muted-foreground/40">· {mutedPubkeys.length}</span>
            </div>
            {mutedPubkeys.length === 0 ? (
              <p className="text-xs text-muted-foreground/50 px-1">No muted people.</p>
            ) : (
              <div className="space-y-1.5" data-testid="list-muted-pubkeys">
                {mutedPubkeys.map((pk) => (
                  <MutedUserRow key={pk} pubkey={pk} onUnmute={requestUnmute} />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground/60">
              <Hash className="h-3.5 w-3.5" />
              Words <span className="text-muted-foreground/40">· {mutedKeywords.length}</span>
            </div>
            {mutedKeywords.length === 0 ? (
              <p className="text-xs text-muted-foreground/50 px-1">No muted words.</p>
            ) : (
              <div className="flex flex-wrap gap-2" data-testid="list-muted-keywords">
                {mutedKeywords.map((kw) => (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1.5 rounded-full pl-3 pr-1.5 py-1 text-xs text-foreground/80"
                    style={{ border: "1px solid rgba(140, 100, 220, 0.18)", background: "rgba(140, 100, 220, 0.06)" }}
                    data-testid={`muted-keyword-${kw.replace(/[^a-z0-9]/gi, "-")}`}
                  >
                    {kw}
                    <button
                      onClick={() => requestRemoveKeyword(kw)}
                      className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-brand/20 transition-colors"
                      aria-label={`Remove muted word ${kw}`}
                      data-testid={`button-remove-keyword-${kw.replace(/[^a-z0-9]/gi, "-")}`}
                    >
                      <X className="h-3 w-3 text-muted-foreground/70" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <ConfirmAction
        open={!!confirm}
        onOpenChange={(o) => { if (!o) setConfirm(null); }}
        title={confirm?.title ?? ""}
        description={confirm?.description ?? ""}
        confirmLabel={confirm?.confirmLabel ?? "Confirm"}
        variant="default"
        onConfirm={() => { confirm?.onConfirm(); setConfirm(null); }}
      />
    </div>
  );
}
