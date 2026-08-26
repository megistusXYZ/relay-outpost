import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { signWithTimeout } from "@/lib/signer-timeout";
import { publishEvent } from "@/lib/nostr";
import { Bug, Lightbulb, Sparkles, HelpCircle, Send, Check, Copy, ExternalLink, Inbox, AlertTriangle, Lock, Globe } from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import {
  type FeedbackRecipient,
  type FeedbackType,
  type OpenFeedbackDrawerDetail,
  buildIssueTemplate,
  buildKind1Mirror,
  captureContext,
  discoverAllRecipients,
  tryEncodeNevent,
  sendPrivateTicket,
  KIND_NIP34_ISSUE,
} from "@/lib/nip34-feedback";

// defaultPrivate encodes intent: a bug/question is about *your* problem (private
// support desk); an idea/UX nit is a suggestion others might share (public board).
const TYPE_OPTIONS: { id: FeedbackType; label: string; icon: typeof Bug; defaultContext: boolean; defaultPrivate: boolean }[] = [
  { id: "bug", label: "Bug", icon: Bug, defaultContext: true, defaultPrivate: true },
  { id: "idea", label: "Idea", icon: Lightbulb, defaultContext: false, defaultPrivate: false },
  { id: "ux", label: "UX nit", icon: Sparkles, defaultContext: false, defaultPrivate: false },
  { id: "question", label: "Question", icon: HelpCircle, defaultContext: false, defaultPrivate: true },
];

export function FeedbackDrawer() {
  const { signer, pubkey, loginMethod } = useNostrAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [recipients, setRecipients] = useState<FeedbackRecipient[]>([]);
  const [recipientIdx, setRecipientIdx] = useState(0);
  const [type, setType] = useState<FeedbackType>("bug");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [attachContext, setAttachContext] = useState(true);
  const [publicNoteOptIn, setPublicNoteOptIn] = useState(false);
  const [isPrivate, setIsPrivate] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ nevent: string; relay: string; openIssuesUrl: string | null; isPrivate?: boolean } | null>(null);
  const [loadingRecipients, setLoadingRecipients] = useState(false);

  const signerType = loginMethod === "bunker" ? "nip-46" : loginMethod === "extension" ? "nip-07" : loginMethod === "qr" ? "nip-46-qr" : loginMethod || "local";

  const reset = useCallback(() => {
    setTitle("");
    setBody("");
    setType("bug");
    setAttachContext(true);
    setPublicNoteOptIn(false);
    setIsPrivate(true);
    setSuccess(null);
    setRecipientIdx(0);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OpenFeedbackDrawerDetail>).detail || {};
      setOpen(true);
      setSuccess(null);
      if (detail.initialType) {
        setType(detail.initialType);
        setAttachContext(TYPE_OPTIONS.find((t) => t.id === detail.initialType)?.defaultContext ?? true);
      }
      if (detail.initialTitle) setTitle(detail.initialTitle);
      if (detail.initialRecipient) {
        setRecipients((prev) => {
          const exists = prev.findIndex((r) => r.relay === detail.initialRecipient!.relay);
          if (exists >= 0) {
            setRecipientIdx(exists);
            return prev;
          }
          const next = [detail.initialRecipient!, ...prev];
          setRecipientIdx(0);
          return next;
        });
      }
    };
    window.addEventListener("relay-outpost:open-feedback", handler as EventListener);
    return () => window.removeEventListener("relay-outpost:open-feedback", handler as EventListener);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingRecipients(true);
    discoverAllRecipients()
      .then((list) => {
        if (cancelled) return;
        setRecipients((prev) => {
          if (prev.length === 0) return list;
          const merged = [...list];
          for (const r of prev) {
            if (!merged.find((m) => m.relay === r.relay)) merged.push(r);
          }
          return merged;
        });
      })
      .finally(() => { if (!cancelled) setLoadingRecipients(false); });
    return () => { cancelled = true; };
  }, [open]);

  const recipient = recipients[recipientIdx] || null;

  // Smart delivery routing (Part D):
  //  - canPrivate: we know the operator's key AND our signer can encrypt (NIP-44
  //    gift wrap). Some signers (older extensions, certain bunker/QR) lack nip44,
  //    so without this guard private feedback silently failed for those users —
  //    they now auto-route to the public issue path, which any signer can do.
  //  - canPublicIssue: operator runs a feedback inbox, so a public issue works.
  const canEncrypt = !!(signer && (signer as any).nip44);
  const canPrivate = !!recipient?.operatorPubkey && canEncrypt;
  const canPublicIssue = !!(recipient?.hasInbox && recipient.operatorPubkey && recipient.repoD);

  // Default privacy: if the operator has no public inbox but we can DM them,
  // default to Private (reaches them anywhere, no profile leak). Otherwise fall
  // back to the feedback type's intent default.
  useEffect(() => {
    setPublicNoteOptIn(false);
    if (!canPrivate) setIsPrivate(false);                 // can't DM them → public only
    else if (!canPublicIssue) setIsPrivate(true);          // no public inbox but can DM → private
    else setIsPrivate(TYPE_OPTIONS.find((t) => t.id === type)?.defaultPrivate ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipient?.relay, canPrivate, canPublicIssue]);

  const handleTypeSelect = (t: FeedbackType) => {
    setType(t);
    const opt = TYPE_OPTIONS.find((x) => x.id === t);
    setAttachContext(opt?.defaultContext ?? attachContext);
    // Only let type drive privacy when both options are genuinely available.
    if (canPrivate && canPublicIssue) setIsPrivate(opt?.defaultPrivate ?? false);
  };

  const submit = async () => {
    if (!signer || !pubkey) {
      toast({ title: "Sign in required", description: "Sign in to send feedback.", variant: "destructive" });
      return;
    }
    if (!recipient) {
      toast({ title: "Pick a recipient", variant: "destructive" });
      return;
    }
    if (!title.trim()) {
      toast({ title: "Add a short title", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const ctx = attachContext ? captureContext(signerType) : null;
      const targetRelay = recipient.relay;

      // Private path: gift-wrapped ticket straight to the operator's DM inbox.
      if (isPrivate && recipient.operatorPubkey) {
        const res = await sendPrivateTicket({
          signer,
          myPubkey: pubkey,
          operatorPubkey: recipient.operatorPubkey,
          title: title.trim(),
          body: body.trim(),
          types: [type],
          context: ctx,
        });
        if (!res.success) {
          toast({ title: "Could not send feedback", description: res.error || "Please try again.", variant: "destructive" });
          setSubmitting(false);
          return;
        }
        setSuccess({ nevent: "", relay: targetRelay, openIssuesUrl: null, isPrivate: true });
        toast({ title: "Feedback sent privately", description: "Only the operator can read it." });
        setSubmitting(false);
        return;
      }

      const issueTemplate = buildIssueTemplate({
        recipient,
        title: title.trim(),
        body: body.trim(),
        types: [type],
        context: ctx,
      });

      let nevent = "";
      let openIssuesUrl: string | null = null;
      if (recipient.operatorPubkey) {
        // Public issue (kind 1621). buildIssueTemplate adds the repo `a` tag when the
        // operator has an inbox, otherwise just p-tags them — either way the operator's
        // #p console subscription catches it, and it lands in the reporter's own "Your
        // tickets" via authors:[me]. A 1621 issue is not a kind-1 note, so it never
        // shows on the user's public profile.
        const userOutbox: string[] = [];
        try {
          const { getWriteRelays } = await import("@/lib/outbox");
          const r = getWriteRelays(pubkey, []);
          if (Array.isArray(r)) userOutbox.push(...r.slice(0, 3));
        } catch {}
        const relays = Array.from(new Set([targetRelay, ...userOutbox]));
        const signedIssue = await signWithTimeout(signer, issueTemplate);
        // userSelected=false + targetPubkey=operator also broadcasts to the operator's
        // read relays, guaranteeing their inbox subscription sees it even without a repo.
        const ok = await publishEvent(signedIssue, relays, recipient.operatorPubkey, false);
        if (!ok) {
          toast({ title: "Could not send feedback", description: `Publish failed on all relays (${relays.map((r) => r.replace(/^wss?:\/\//, "")).join(", ")}).`, variant: "destructive" });
          setSubmitting(false);
          return;
        }
        nevent = tryEncodeNevent(signedIssue.id, targetRelay, KIND_NIP34_ISSUE);
        if (recipient.hasInbox && recipient.repoD) {
          const coord = `30617:${recipient.operatorPubkey}:${recipient.repoD}`;
          const filterParam = encodeURIComponent(JSON.stringify({ kinds: [1621, 1111, 1622, 1630, 1631, 1632, 1633], "#a": [coord] }));
          openIssuesUrl = `/console?filter=${filterParam}&relay=${encodeURIComponent(targetRelay)}`;
        }
      } else {
        // No operator key discoverable — a public note is the only way to reach them.
        if (!publicNoteOptIn) {
          toast({ title: "Can't deliver", description: "We couldn't find this operator. Toggle 'Post publicly anyway' to send a public note, or pick another relay.", variant: "destructive" });
          setSubmitting(false);
          return;
        }
        const mirror = buildKind1Mirror({
          recipient,
          title: title.trim(),
          body: body.trim(),
          types: [type],
          context: ctx,
        });
        const signedMirror = await signWithTimeout(signer, mirror);
        // Intentionally do NOT include the user's outbox: a kind-1 note would otherwise
        // appear on the user's public profile/feed. Restrict delivery to the operator's relay.
        const ok = await publishEvent(signedMirror, [targetRelay], undefined, true);
        if (!ok) {
          toast({ title: "Could not send feedback", description: `Publish failed on ${targetRelay.replace(/^wss?:\/\//, "")} (relay may be down or require auth).`, variant: "destructive" });
          setSubmitting(false);
          return;
        }
        nevent = tryEncodeNevent(signedMirror.id, targetRelay, 1);
      }

      setSuccess({ nevent, relay: targetRelay, openIssuesUrl });
      toast({ title: "Feedback sent", description: recipient.operatorPubkey ? "Delivered to the operator." : `Public note sent to ${targetRelay.replace(/^wss?:\/\//, "")}` });
    } catch (err) {
      toast({ title: "Could not send feedback", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const copyNevent = async () => {
    if (!success) return;
    try {
      await navigator.clipboard.writeText(success.nevent);
      toast({ title: "Copied" });
    } catch {}
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        {/* Soft-blend background art (bug-hunter cockpit — same treatment as
            Tools/Help): pinned to the sheet's top, gradient-masked so it fades
            out well before the form fields, opacity low enough that copy stays
            fully readable in both themes. pointer-events-none + aria-hidden —
            pure decoration. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[46%] z-0 bg-cover bg-top"
          style={{
            backgroundImage: "url(/images/feedback-bg.jpg)",
            opacity: 0.09,
            WebkitMaskImage: "linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.7) 45%, transparent 95%)",
            maskImage: "linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.7) 45%, transparent 95%)",
          }}
        />
        <div className="relative z-10">
        <SheetHeader className="text-left">
          <SheetTitle className="font-brand uppercase tracking-widest text-sm flex items-center gap-2">
            <Inbox className="w-4 h-4 text-brand" />
            Send feedback
          </SheetTitle>
        </SheetHeader>

        {success ? (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
              <Check className="w-4 h-4" /> {success.isPrivate ? "Sent privately." : "Feedback sent."}
            </div>
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              {success.isPrivate
                ? "Only the operator can read it. Follow the conversation any time in Your tickets."
                : "It's on its way to the operator. Follow the conversation any time in Your tickets."}
            </p>
            {!success.isPrivate && success.nevent && (
              <details className="text-[11px]">
                <summary className="cursor-pointer text-muted-foreground/60 hover:text-foreground">Advanced details</summary>
                <div className="flex items-center gap-2 mt-2">
                  <Input readOnly value={success.nevent} className="font-mono text-[11px]" data-testid="input-feedback-nevent" />
                  <Button size="icon" variant="outline" onClick={copyNevent} data-testid="button-copy-feedback-nevent"><Copy className="w-3.5 h-3.5" /></Button>
                </div>
              </details>
            )}
            {!success.isPrivate && success.openIssuesUrl && (
              <a
                href={success.openIssuesUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline"
                data-testid="link-feedback-view-open-issues"
              >
                View open issues for this operator <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <Button
              size="sm"
              className="w-full"
              onClick={() => { setOpen(false); setLocation("/tickets"); }}
              data-testid="button-feedback-track-tickets"
            >
              <Inbox className="w-3.5 h-3.5 mr-2" /> Track your tickets
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={reset} data-testid="button-feedback-send-another">Send another</Button>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} data-testid="button-feedback-close">Close</Button>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <div>
              <label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/70">Send to</label>
              {loadingRecipients && recipients.length === 0 ? (
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground/60">
                  <RelayOutpostInlineLoader className="w-3 h-3" /> Discovering recipients…
                </div>
              ) : (
                <select
                  value={recipientIdx}
                  onChange={(e) => setRecipientIdx(Number(e.target.value))}
                  className="mt-1 w-full bg-background border border-border/60 rounded-md px-2 py-2 text-sm"
                  data-testid="select-feedback-recipient"
                >
                  {recipients.map((r, i) => (
                    <option key={r.relay + i} value={i}>{r.label}</option>
                  ))}
                </select>
              )}
              {recipient && !canPrivate && !canPublicIssue && (
                <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-400/90 flex items-start gap-1.5 leading-relaxed">
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                  <span>We couldn't find this operator's details, so feedback can only go out as a public post.</span>
                </p>
              )}
              {/* Public chosen but operator has no inbox: confirm the public-post fallback. */}
              {recipient && !isPrivate && !recipient.operatorPubkey && (
                <div className="mt-2 rounded-md border border-amber-400/30 bg-amber-500/5 px-2.5 py-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p id="feedback-public-note-label" className="text-[11px] font-medium">Post publicly anyway</p>
                    <p id="feedback-public-note-desc" className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
                      This operator has no public feedback box. Your note goes only to their relay, but could still show on your profile. Prefer Private to send it straight to them.
                    </p>
                  </div>
                  <Switch
                    checked={publicNoteOptIn}
                    onCheckedChange={setPublicNoteOptIn}
                    aria-labelledby="feedback-public-note-label"
                    aria-describedby="feedback-public-note-desc"
                    data-testid="switch-feedback-public-note-optin"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/70">Type</label>
              <div className="mt-1 grid grid-cols-4 gap-1.5">
                {TYPE_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const active = type === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleTypeSelect(opt.id)}
                      className={`flex flex-col items-center gap-1 py-2 rounded-md border text-[10px] transition-colors ${
                        active
                          ? "border-brand/60 bg-brand/10 text-brand"
                          : "border-border/40 hover:border-brand/30 text-muted-foreground/70"
                      }`}
                      data-testid={`button-feedback-type-${opt.id}`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/70">Title</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Short summary"
                maxLength={140}
                className="mt-1"
                data-testid="input-feedback-title"
              />
            </div>

            <div>
              <label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/70">Description (optional)</label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What happened, what you expected, anything you want them to know."
                rows={5}
                className="mt-1 text-sm"
                data-testid="textarea-feedback-body"
              />
            </div>

            <div className="flex items-start justify-between gap-3 rounded-md border border-border/40 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-xs font-medium">Attach context</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-relaxed">
                  Adds: route, viewport, signer type, app version. Nothing else.
                </p>
              </div>
              <Switch checked={attachContext} onCheckedChange={setAttachContext} data-testid="switch-feedback-context" />
            </div>

            {/* Privacy choice — plain language, no protocol jargon. */}
            <div>
              <label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/70">Visibility</label>
              <div className="mt-1 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsPrivate(true)}
                  disabled={!canPrivate}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-md border text-[11px] transition-colors disabled:opacity-40 ${
                    isPrivate ? "border-brand/60 bg-brand/10 text-brand" : "border-border/40 hover:border-brand/30 text-muted-foreground/70"
                  }`}
                  data-testid="button-feedback-private"
                >
                  <Lock className="w-3.5 h-3.5" /> Private
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrivate(false)}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-md border text-[11px] transition-colors ${
                    !isPrivate ? "border-brand/60 bg-brand/10 text-brand" : "border-border/40 hover:border-brand/30 text-muted-foreground/70"
                  }`}
                  data-testid="button-feedback-public"
                >
                  <Globe className="w-3.5 h-3.5" /> Public
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-1.5 leading-relaxed">
                {isPrivate
                  ? "Only the operator can read this — sent as a private, encrypted message."
                  : "Others on the relay can see this and add to it, like a public suggestion board."}
              </p>
              {recipient?.operatorPubkey && !canEncrypt && (
                <p className="text-[10px] text-amber-500/80 mt-1.5 leading-relaxed" data-testid="text-feedback-no-encrypt">
                  Private feedback needs a signer that supports encryption (NIP-44). Yours doesn't, so this sends as a public issue to the operator — your feedback still gets through.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                onClick={submit}
                disabled={submitting || !title.trim() || !recipient || (!isPrivate && !recipient?.operatorPubkey && !publicNoteOptIn) || (isPrivate && !canPrivate)}
                data-testid="button-feedback-submit"
              >
                {submitting ? <RelayOutpostInlineLoader className="w-3.5 h-3.5 mr-2" /> : <Send className="w-3.5 h-3.5 mr-2" />}
                Send
              </Button>
            </div>
          </div>
        )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
