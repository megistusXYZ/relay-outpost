/**
 * Ask to join a group chat through an ask link (concord-join-requests). The
 * group lives in the URL fragment, read here and never sent anywhere. Sending
 * gift-wraps a request to the link's moderator and the owner; if they let you
 * in, a direct invite arrives in Chats.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Link2Off, LogIn, Send, Check, Loader2, DoorOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { useToast } from "@/hooks/use-toast";
import { getCommunity } from "@/lib/concord/concord-keys";
import { parseAskLink, askRecipients } from "@/lib/concord/concord-join-requests";
import { sendConcordJoinRequest } from "@/lib/concord/concord-join-send";
import { useConcordProfile } from "@/components/concord/ConcordIdentity";

export default function ConcordAsk({ npub }: { npub: string }) {
  const { pubkey } = useNostrAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const ask = useMemo(() => parseAskLink(npub, typeof window !== "undefined" ? window.location.hash : ""), [npub]);
  const creator = useConcordProfile(ask?.creator ?? "").name;
  const [held, setHeld] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const groupName = ask?.name?.trim() || "this group chat";

  // Already in it (or it's your own group): the link has nothing to ask for.
  useEffect(() => {
    if (!pubkey || !ask) { setHeld(false); return; }
    let live = true;
    getCommunity(pubkey, ask.communityId).then((r) => { if (live) setHeld(!!r); }).catch(() => {});
    return () => { live = false; };
  }, [pubkey, ask]);

  if (!ask) {
    return <Notice icon={Link2Off} title="This ask link is incomplete" body="Part of the link is missing or damaged. Ask for a new one." testId="ask-broken" />;
  }
  if (!pubkey) {
    return <Notice icon={LogIn} title={`Sign in to ask to join ${groupName}`} body="Then open this link again." testId="ask-signed-out" />;
  }
  if (held || pubkey === ask.owner) {
    return (
      <Notice icon={DoorOpen} title={`You're already in ${groupName}`} body="" testId="ask-already-in">
        <Button onClick={() => setLocation(`/outposts/c/${ask.communityId}`)} className="mt-4">Open it</Button>
      </Notice>
    );
  }
  if (sent) {
    return <Notice icon={Check} title="Request sent" body="If they let you in, the invite will show up in your Chats." testId="ask-sent" />;
  }

  const send = async () => {
    const signer = getGlobalSigner();
    if (!signer || sending) return;
    setSending(true);
    try {
      const reached = await sendConcordJoinRequest(signer, pubkey, askRecipients(ask.creator, ask.owner), ask.communityId, note);
      if (reached > 0) setSent(true);
      else toast({ title: "Couldn't send your request", description: "Your sign-in couldn't encrypt it, or no relay took it. Try again.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto px-4 py-16" data-testid="ask-form">
      <p className="text-[11px] font-medium uppercase tracking-wider text-brand/60 text-center">Ask to join</p>
      <p className="text-lg font-bold mt-2 text-center break-words">{groupName}</p>
      <p className="text-xs text-muted-foreground/70 mt-2 text-center">
        Your request goes privately to {creator} and the group's owner. They decide who gets in.
      </p>
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={280}
        rows={3}
        placeholder="Say who you are or how you know them (optional)"
        className="resize-none text-sm mt-5"
        data-testid="input-ask-note"
      />
      <Button onClick={send} disabled={sending} className="w-full h-11 md:h-9 gap-1.5 mt-3" data-testid="button-send-ask">
        {sending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</> : <><Send className="w-3.5 h-3.5" /> Send request</>}
      </Button>
    </div>
  );
}

function Notice({ icon: Icon, title, body, testId, children }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  testId: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="max-w-sm mx-auto px-4 py-20 text-center" data-testid={testId}>
      <Icon className="w-10 h-10 text-muted-foreground/30 mx-auto" />
      <p className="text-sm font-medium text-foreground/90 mt-3 break-words">{title}</p>
      {body && <p className="text-xs text-muted-foreground/60 mt-1">{body}</p>}
      {children}
    </div>
  );
}
