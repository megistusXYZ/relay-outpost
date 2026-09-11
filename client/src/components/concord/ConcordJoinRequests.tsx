/**
 * People waiting to join a group chat through an ask link
 * (concord-join-requests), in Manage. "Let in" sends them a direct invite;
 * "Decline" just clears the request. The ask link to share sits on top.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { nip19 } from "nostr-tools";
import { Check, Copy, Loader2, UserPlus, X } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { publishEvent } from "@/lib/nostr";
import { useToast } from "@/hooks/use-toast";
import { sendDirectInvite } from "@/lib/concord/concord-invites";
import { askLink, listJoinRequests, resolveJoinRequest, JOIN_REQUESTS_CHANGED_EVENT, type JoinRequest } from "@/lib/concord/concord-join-requests";
import type { StoredCommunity } from "@/lib/concord/concord-keys";
import { useConcordProfile } from "./ConcordIdentity";
import { formatCompactTime } from "@/lib/time";

/** This viewer's waiting requests for a group, kept current. */
export function useJoinRequests(communityId: string): JoinRequest[] {
  const { pubkey } = useNostrAuth();
  const [requests, setRequests] = useState<JoinRequest[]>(() => (pubkey ? listJoinRequests(pubkey, communityId) : []));
  useEffect(() => {
    const update = () => setRequests(pubkey ? listJoinRequests(pubkey, communityId) : []);
    update();
    window.addEventListener(JOIN_REQUESTS_CHANGED_EVENT, update);
    return () => window.removeEventListener(JOIN_REQUESTS_CHANGED_EVENT, update);
  }, [pubkey, communityId]);
  return requests;
}

export function ConcordJoinRequests({ community }: { community: StoredCommunity }) {
  const { pubkey } = useNostrAuth();
  const requests = useJoinRequests(community.community_id);
  const [copied, setCopied] = useState(false);
  const link = pubkey
    ? askLink(window.location.origin, pubkey, { communityId: community.community_id, owner: community.owner, name: community.name })
    : "";
  const copy = () => {
    navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground/70">
          Anyone with an ask link can ask to join. Requests come to you and the owner, and you decide who gets in.
        </p>
        <button onClick={copy} disabled={!link} className="flex items-center gap-1.5 text-[11px] text-primary hover:underline disabled:opacity-50" data-testid="copy-ask-link">
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? "Copied" : "Copy ask link"}
        </button>
      </div>
      {requests.length === 0
        ? <p className="text-[11px] text-muted-foreground/60">Nobody is waiting.</p>
        : requests.map((r) => <RequestRow key={r.id} request={r} community={community} />)}
    </div>
  );
}

function RequestRow({ request, community }: { request: JoinRequest; community: StoredCommunity }) {
  const { pubkey } = useNostrAuth();
  const { toast } = useToast();
  const { name } = useConcordProfile(request.requester);
  const [busy, setBusy] = useState(false);
  const npub = (() => { try { return nip19.npubEncode(request.requester); } catch { return ""; } })();

  const letIn = async () => {
    const signer = getGlobalSigner();
    if (!pubkey || !signer || busy) return;
    setBusy(true);
    try {
      const ok = await sendDirectInvite(signer, pubkey, request.requester, community, (e, r) => publishEvent(e, r));
      if (ok) {
        resolveJoinRequest(pubkey, request.id);
        toast({ title: `Invite sent to ${name}`, description: "They'll find it in their Chats." });
      } else {
        toast({ title: "Couldn't send the invite", description: "Your sign-in couldn't encrypt it. Try again.", variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  };
  const decline = () => { if (pubkey) resolveJoinRequest(pubkey, request.id); };

  return (
    <div className="rounded-lg border border-border/30 p-2.5 space-y-1.5" data-testid={`join-request-${request.id.slice(0, 8)}`}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 min-w-0">
        {npub
          ? <Link href={`/profile/${npub}`} className="font-medium text-foreground/85 truncate hover:underline">{name}</Link>
          : <span className="font-medium text-foreground/85 truncate">{name}</span>}
        <span className="ml-auto shrink-0 tabular-nums">{formatCompactTime(request.at)}</span>
      </div>
      {request.note && <p className="text-xs text-foreground/80 break-words [overflow-wrap:anywhere]">“{request.note}”</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={letIn}
          disabled={busy}
          className="flex items-center gap-1 h-9 md:h-7 px-3 rounded-full text-[11px] font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-60 transition-opacity"
          data-testid={`join-let-in-${request.id.slice(0, 8)}`}
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />} Let in
        </button>
        <button
          onClick={decline}
          disabled={busy}
          className="flex items-center gap-1 h-9 md:h-7 px-3 rounded-full text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
          data-testid={`join-decline-${request.id.slice(0, 8)}`}
        >
          <X className="w-3 h-3" /> Decline
        </button>
      </div>
    </div>
  );
}
