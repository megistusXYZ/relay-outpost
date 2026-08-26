/**
 * Mint + manage invite links for a Concord community (CORD-05). Create a
 * revocable link, copy it, show it as a scannable QR (fresh links show one
 * immediately; Active links re-derive theirs via rebuildInviteLink), or revoke
 * a live one. The QR sits on a white card in both themes — scanners want
 * dark-on-light. "Invite a person" (direct gift-wrapped 3313) uses the app's
 * people search — find someone by name, handle, or npub, not just a raw key.
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Link2, Copy, Check, Trash2, Loader2, QrCode, Send, X, RotateCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ProfileSearchInput } from "@/components/ProfileSearchInput";
import type { SelectedRecipient } from "@/components/ProfileSearchInput";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { publishEvent } from "@/lib/nostr";
import { useToast } from "@/hooks/use-toast";
import { formatNpub } from "@/lib/nostr-helpers";
import { formatCompactTime } from "@/lib/time";
import { mintInviteLink, rebuildInviteLink, revokeInviteLink, sendDirectInvite } from "@/lib/concord/concord-invites";
import { getInviteSigners, putInviteSigner, type StoredCommunity, type StoredInviteSigner } from "@/lib/concord/concord-keys";
import { listSentInvites, recordSentInvite, removeSentInvite, isInGroup, type SentInvite } from "@/lib/concord/concord-sent-invites";

export function ConcordInviteDialog({ open, onOpenChange, community, memberPubkeys }: {
  open: boolean; onOpenChange: (o: boolean) => void; community: StoredCommunity;
  /** Live member pubkeys — used to show whether a sent invite's recipient has since joined. */
  memberPubkeys?: string[];
}) {
  const { pubkey } = useNostrAuth();
  const { toast } = useToast();
  const [links, setLinks] = useState<StoredInviteSigner[]>([]);
  const [sent, setSent] = useState<SentInvite[]>([]);
  const [minting, setMinting] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [inviteRecipient, setInviteRecipient] = useState<SelectedRecipient | null>(null);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [reinviting, setReinviting] = useState<string | null>(null);

  const memberSet = useMemo(() => new Set(memberPubkeys ?? []), [memberPubkeys]);

  const reloadSent = useCallback(() => {
    if (pubkey) setSent(listSentInvites(pubkey, community.community_id));
  }, [pubkey, community.community_id]);
  const reload = useCallback(() => {
    if (pubkey) getInviteSigners(pubkey, community.community_id).then(setLinks);
    reloadSent();
  }, [pubkey, community.community_id, reloadSent]);
  useEffect(() => { if (open) reload(); }, [open, reload]);

  const mint = useCallback(async () => {
    if (!pubkey) return;
    setMinting(true);
    try {
      const base = window.location.origin;
      const url = await mintInviteLink(pubkey, community, base, (e, r) => publishEvent(e, r), { creatorNpub: formatNpub(pubkey) });
      setLastLink(url);
      await navigator.clipboard?.writeText(url).catch(() => {});
      setCopied(true); setTimeout(() => setCopied(false), 1500);
      toast({ title: "Invite link created & copied" });
      reload();
    } catch (err) {
      toast({ title: "Couldn't create invite", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally { setMinting(false); }
  }, [pubkey, community, reload, toast]);

  const revoke = useCallback(async (link: StoredInviteSigner) => {
    if (!pubkey) return;
    await revokeInviteLink(link.linkSignerSecret, community.relays, (e, r) => publishEvent(e, r));
    await putInviteSigner(pubkey, { ...link, revoked: true });
    // Don't keep showing a QR/copy row for a link that just died.
    setLastLink((cur) => (cur && cur === rebuildInviteLink(link, community, window.location.origin) ? null : cur));
    toast({ title: "Invite revoked" });
    reload();
  }, [pubkey, community, reload, toast]);

  const invitePerson = useCallback(async () => {
    const signer = getGlobalSigner();
    const hex = inviteRecipient?.pubkey;
    if (!hex || !pubkey || !signer) return;
    setSendingInvite(true);
    try {
      const ok = await sendDirectInvite(signer, pubkey, hex, community, (e, r) => publishEvent(e, r));
      toast({ title: ok ? `Invite sent to ${inviteRecipient?.displayName || "them"}` : "Couldn't send invite", variant: ok ? undefined : "destructive" });
      if (ok) {
        // Local, per-device audit log (no bundle secrets) — powers "Sent invites".
        recordSentInvite(pubkey, community.community_id, { recipient: hex, at: Date.now(), name: inviteRecipient?.displayName });
        reloadSent();
        setInviteRecipient(null);
      }
    } finally {
      setSendingInvite(false);
    }
  }, [inviteRecipient, pubkey, community, toast, reloadSent]);

  const reinvite = useCallback(async (recipient: string, name?: string) => {
    const signer = getGlobalSigner();
    if (!pubkey || !signer) return;
    setReinviting(recipient);
    try {
      const ok = await sendDirectInvite(signer, pubkey, recipient, community, (e, r) => publishEvent(e, r));
      if (ok) {
        recordSentInvite(pubkey, community.community_id, { recipient, at: Date.now(), name });
        reloadSent();
      }
      toast({ title: ok ? `Invite re-sent to ${name || "them"}` : "Couldn't send invite", variant: ok ? undefined : "destructive" });
    } finally {
      setReinviting(null);
    }
  }, [pubkey, community, toast, reloadSent]);

  const forgetSent = useCallback((recipient: string) => {
    if (!pubkey) return;
    removeSentInvite(pubkey, community.community_id, recipient);
    reloadSent();
  }, [pubkey, community.community_id, reloadSent]);

  const copyLink = useCallback((l: StoredInviteSigner) => {
    const url = rebuildInviteLink(l, community, window.location.origin);
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedLink(l.linkSignerPubkey);
    setTimeout(() => setCopiedLink((c) => (c === l.linkSignerPubkey ? null : c)), 1500);
  }, [community]);

  const activeLinks = links.filter((l) => !l.revoked);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* grid-cols-[minmax(0,1fr)]: DialogContent is a grid with an implicit
          auto column, which sizes to the TITLE'S nowrap min-content — a long
          group name silently widened every row past the dialog border (the
          "title under the ✕" bug). Pinning the track lets truncate work. */}
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[85dvh] overflow-y-auto grid-cols-[minmax(0,1fr)]">
        {/* pr-8 reserves the ✕ close-button gutter so a long group name
            truncates instead of running underneath it. */}
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2 text-base min-w-0">
            <Link2 className="w-4 h-4 text-brand shrink-0" /> <span className="truncate min-w-0">Invite to {community.name}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 min-w-0">
          <Button onClick={mint} disabled={minting} className="w-full h-11 md:h-9" data-testid="button-mint-invite">
            {minting ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Creating…</> : <><Link2 className="w-4 h-4 mr-1.5" /> Create invite link</>}
          </Button>

          {lastLink && (
            <div className="space-y-2">
              {/* Always black-on-white — QR contrast must not follow the theme.
                  p-3 white padding + marginSize give the scanner its quiet zone.
                  Card capped at ~220px so it doesn't dominate the dialog. */}
              <div className="mx-auto w-fit rounded-xl bg-white p-3" data-testid="concord-invite-qr">
                <QRCodeSVG value={lastLink} size={196} marginSize={2} bgColor="#ffffff" fgColor="#000000" />
              </div>
              <p className="text-[11px] text-center text-muted-foreground/60">Scan to join, or copy the link below</p>
              <button
                onClick={() => { navigator.clipboard?.writeText(lastLink); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                className="w-full flex items-center gap-2 min-h-11 md:min-h-9 px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-left min-w-0"
                data-testid="concord-last-link"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />}
                <span className="text-[10px] font-mono text-muted-foreground/70 truncate min-w-0 flex-1">{lastLink}</span>
              </button>
            </div>
          )}

          {activeLinks.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-muted-foreground/70">Active links</p>
              {activeLinks.map((l) => (
                <div key={l.linkSignerPubkey} className="flex items-center gap-1 pl-3 pr-1 py-1 rounded-lg border border-border/20 min-w-0">
                  <Link2 className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-mono text-muted-foreground/60 truncate">{l.linkSignerPubkey.slice(0, 16)}…</div>
                    {l.createdAt > 0 && <div className="text-[10px] text-muted-foreground/40">created {formatCompactTime(Math.floor(l.createdAt / 1000))}</div>}
                  </div>
                  <button
                    onClick={() => copyLink(l)}
                    className="flex items-center justify-center h-11 w-11 md:h-9 md:w-9 shrink-0 rounded-lg hover:bg-muted/40 text-muted-foreground/50 hover:text-foreground transition-colors"
                    title="Copy link"
                    data-testid={`button-copy-${l.linkSignerPubkey.slice(0, 8)}`}
                  >
                    {copiedLink === l.linkSignerPubkey ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => setLastLink(rebuildInviteLink(l, community, window.location.origin))}
                    className="flex items-center justify-center h-11 w-11 md:h-9 md:w-9 shrink-0 rounded-lg hover:bg-muted/40 text-muted-foreground/50 hover:text-foreground transition-colors"
                    title="Show QR code"
                    data-testid={`button-qr-${l.linkSignerPubkey.slice(0, 8)}`}
                  >
                    <QrCode className="w-4 h-4" />
                  </button>
                  <button onClick={() => revoke(l)} className="flex items-center justify-center h-11 w-11 md:h-9 md:w-9 shrink-0 rounded-lg hover:bg-destructive/10 text-muted-foreground/50 hover:text-destructive transition-colors" title="Revoke (deletes the link everywhere)" data-testid={`button-revoke-${l.linkSignerPubkey.slice(0, 8)}`}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-border/20 space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground/70">Invite a person</p>
            <p className="text-[11px] text-muted-foreground/50">Sends a private invite straight to them. Unlike a link, it can't be revoked.</p>
            <ProfileSearchInput onSelect={setInviteRecipient} selected={inviteRecipient} placeholder="Search a name, handle, or npub…" />
            <Button onClick={invitePerson} disabled={!inviteRecipient?.pubkey || sendingInvite} className="w-full h-11 md:h-9 gap-1.5" data-testid="button-invite-npub">
              {sendingInvite ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</> : <><Send className="w-3.5 h-3.5" /> Send invite</>}
            </Button>
          </div>

          {/* Sent invites — a LOCAL, this-device record of the direct invites
              you've sent. "In the group" checks the live member roster; it can't
              prove they used your invite, only that they're a member now. */}
          {sent.length > 0 && (
            <div className="pt-3 border-t border-border/20 space-y-1.5" data-testid="concord-sent-invites">
              <p className="text-[11px] font-medium text-muted-foreground/70">Sent invites <span className="text-muted-foreground/40">· this device</span></p>
              {sent.map((s) => {
                const joined = isInGroup(s.recipient, memberSet);
                const label = s.name?.trim() || `${formatNpub(s.recipient).slice(0, 12)}…`;
                return (
                  <div key={s.recipient} className="flex items-center gap-2 pl-1 pr-1 py-1 rounded-lg min-w-0" data-testid={`sent-invite-${s.recipient.slice(0, 8)}`}>
                    <Avatar className="w-6 h-6 shrink-0"><AvatarFallback className="text-[9px] bg-muted text-muted-foreground">{label.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-foreground/90 truncate">{label}</div>
                      <div className="text-[10px] text-muted-foreground/50">Invited {formatCompactTime(Math.floor(s.at / 1000))}</div>
                    </div>
                    {joined ? (
                      <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-500 shrink-0 pr-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> In the group
                      </span>
                    ) : (
                      <>
                        <span className="text-[10px] text-muted-foreground/50 shrink-0">Not yet</span>
                        <button
                          onClick={() => reinvite(s.recipient, s.name)}
                          disabled={reinviting === s.recipient}
                          className="flex items-center justify-center h-9 w-9 shrink-0 rounded-lg hover:bg-muted/40 text-muted-foreground/50 hover:text-foreground transition-colors disabled:opacity-50"
                          title="Re-invite"
                          data-testid={`button-reinvite-${s.recipient.slice(0, 8)}`}
                        >
                          {reinviting === s.recipient ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => forgetSent(s.recipient)}
                      className="flex items-center justify-center h-9 w-9 shrink-0 rounded-lg hover:bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                      title="Remove from list"
                      data-testid={`button-forget-sent-${s.recipient.slice(0, 8)}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
