import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { ResponsiveFormPanel } from "@/components/ui/responsive-form-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { useToast } from "@/hooks/use-toast";
import {
  getChannelCapability,
  listChannelCapableJoinedOutposts,
  CHANNEL_FRIENDLY_RELAYS,
  SELF_HOST_CHANNEL_RELAYS,
  type ChannelCapableOutpost,
} from "@/lib/channel-relays";
import { joinOutpostWithEnrichment } from "@/lib/outpost-relays";
import {
  Plus, Globe, Eye, Lock, ImagePlus, X, ArrowLeft, Server,
  ExternalLink, Check, Hash, MessagesSquare,
} from "lucide-react";

export type ChannelType = "open" | "restricted" | "private";

export interface CreateChannelOpts {
  name: string;
  about: string;
  isPrivate: boolean;
  isClosed: boolean;
  picture: File | null;
  autoOpenAddMember?: boolean;
}

const TYPE_OPTIONS: { id: ChannelType; label: string; desc: string; icon: typeof Globe; flags: { isPrivate: boolean; isClosed: boolean } }[] = [
  { id: "open", label: "Open", desc: "Anyone can read and join freely.", icon: Globe, flags: { isPrivate: false, isClosed: false } },
  { id: "restricted", label: "Restricted", desc: "Anyone can read, but joins need approval.", icon: Eye, flags: { isPrivate: false, isClosed: true } },
  { id: "private", label: "Private", desc: "Members only — hidden from public discovery.", icon: Lock, flags: { isPrivate: true, isClosed: true } },
];

type Step = "where" | "details" | "type";

export function CreateChannelWizard({
  open,
  onOpenChange,
  currentRelayUrl,
  currentRelayLabel,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentRelayUrl: string;
  currentRelayLabel: string;
  onCreate: (opts: CreateChannelOpts) => Promise<boolean>;
}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [capLoading, setCapLoading] = useState(true);
  const [currentCapable, setCurrentCapable] = useState(false);
  const [otherCapable, setOtherCapable] = useState<ChannelCapableOutpost[]>([]);
  const [joiningUrl, setJoiningUrl] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("where");
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [type, setType] = useState<ChannelType>("open");
  const [picture, setPicture] = useState<File | null>(null);
  const [picturePreview, setPicturePreview] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const picInputRef = useRef<HTMLInputElement>(null);

  const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();

  // Detect capability whenever the wizard opens. Check the CURRENT relay fast
  // (one cached NIP-11) so a capable outpost jumps straight to details — no
  // reason to make the user pick a home they're already in (Cooper: no excise).
  // The full joined-relay scan (for the picker) loads in the background.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCapLoading(true);
    getChannelCapability(currentRelayUrl).then((cur) => {
      if (cancelled) return;
      setCurrentCapable(cur.supportsNip29);
      setStep(cur.supportsNip29 ? "details" : "where");
      setCapLoading(false);
    });
    listChannelCapableJoinedOutposts().then((capable) => {
      if (cancelled) return;
      setOtherCapable(capable.filter((o) => norm(o.url) !== norm(currentRelayUrl)));
    });
    return () => { cancelled = true; };
  }, [open, currentRelayUrl]);

  const reset = useCallback(() => {
    setName(""); setAbout(""); setType("open"); setPicture(null);
    if (picturePreview) URL.revokeObjectURL(picturePreview);
    setPicturePreview(null);
    setCreating(false);
  }, [picturePreview]);

  const close = useCallback(() => { reset(); onOpenChange(false); }, [reset, onOpenChange]);

  const goToOutpost = useCallback((url: string) => {
    close();
    setLocation(`/outposts/${encodeURIComponent(url)}?tab=chat`);
  }, [close, setLocation]);

  const joinAndGo = useCallback(async (url: string) => {
    setJoiningUrl(url);
    try {
      await joinOutpostWithEnrichment(url);
      toast({ title: "Joined", description: "Opening its chat — tap “New room” to create one." });
      goToOutpost(url);
    } catch {
      toast({ title: "Couldn't join", description: "That relay was unreachable. Try another.", variant: "destructive" });
    } finally {
      setJoiningUrl(null);
    }
  }, [goToOutpost, toast]);

  const handleCreate = useCallback(async () => {
    if (!name.trim()) return;
    setCreating(true);
    const opt = TYPE_OPTIONS.find((t) => t.id === type)!;
    const ok = await onCreate({
      name, about,
      isPrivate: opt.flags.isPrivate,
      isClosed: opt.flags.isClosed,
      picture,
      autoOpenAddMember: type === "private",
    });
    setCreating(false);
    if (ok) close();
  }, [name, about, type, picture, onCreate, close]);

  // ---- Step content ---------------------------------------------------------

  const whereStep = (
    <div className="space-y-3 py-1">
      {capLoading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground/60">
          <RelayOutpostInlineLoader className="w-4 h-4" /> Checking which relays can host rooms…
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground/70 leading-relaxed">
            Chat channels live on a relay that hosts them. <strong>{currentRelayLabel}</strong> doesn’t,
            so pick a home for your channel:
          </p>

          {otherCapable.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-mono uppercase tracking-wider text-brand/60">Your room's relays</p>
              {otherCapable.map((o) => (
                <button
                  key={o.url}
                  onClick={() => goToOutpost(o.url)}
                  className="w-full flex items-center gap-2.5 rounded-lg border border-brand/20 bg-brand/[0.04] hover:bg-brand/[0.1] px-3 py-2 text-left transition-colors"
                  data-testid={`wizard-capable-${norm(o.url).slice(0, 20)}`}
                >
                  <MessagesSquare className="w-4 h-4 text-brand/70 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-medium truncate">{o.label}</span>
                    {o.software && <span className="block text-[10px] text-muted-foreground/50 truncate">{o.software}</span>}
                  </span>
                  <ArrowLeft className="w-3.5 h-3.5 text-muted-foreground/40 rotate-180 shrink-0" />
                </button>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50">
              {otherCapable.length > 0 ? "Or join another" : "Join a relay that hosts rooms"}
            </p>
            {CHANNEL_FRIENDLY_RELAYS.map((r) => (
              <button
                key={r.url}
                onClick={() => joinAndGo(r.url)}
                disabled={joiningUrl !== null}
                className="w-full flex items-center gap-2.5 rounded-lg border border-border/30 bg-muted/10 hover:bg-muted/20 px-3 py-2 text-left transition-colors disabled:opacity-50"
                data-testid={`wizard-join-${norm(r.url).slice(0, 20)}`}
              >
                {joiningUrl === r.url
                  ? <RelayOutpostInlineLoader className="w-4 h-4 shrink-0" />
                  : <Hash className="w-4 h-4 text-muted-foreground/40 shrink-0" />}
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-medium truncate">{r.label}</span>
                  <span className="block text-[10px] text-muted-foreground/50 truncate">{r.note}</span>
                </span>
                <Plus className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
              </button>
            ))}
          </div>

          <details className="rounded-lg border border-border/20 bg-muted/5 px-3 py-2">
            <summary className="text-[11px] text-muted-foreground/60 cursor-pointer flex items-center gap-1.5">
              <Server className="w-3 h-3" /> Run your own relay
            </summary>
            <div className="mt-2 space-y-2">
              {SELF_HOST_CHANNEL_RELAYS.map((s) => (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-md bg-muted/10 hover:bg-muted/20 px-2.5 py-1.5 transition-colors"
                >
                  <span className="text-[11px] font-medium text-brand inline-flex items-center gap-1">
                    {s.name} <ExternalLink className="w-2.5 h-2.5" />
                  </span>
                  <span className="block text-[10px] text-muted-foreground/55 leading-snug">{s.blurb}</span>
                </a>
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  );

  const detailsStep = (
    <div className="space-y-4 py-1">
      {(currentCapable || otherCapable.length > 0) && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
          <Check className="w-3 h-3 text-emerald-500" />
          Creating in <strong className="text-foreground/80">{currentRelayLabel}</strong>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="wiz-channel-name" className="text-xs font-medium text-muted-foreground/80">Room name</Label>
        <Input
          id="wiz-channel-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="general-chat"
          className="h-9 text-base sm:text-sm bg-muted/20 border-border/30"
          maxLength={80}
          autoFocus
          data-testid="wizard-channel-name"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="wiz-channel-about" className="text-xs font-medium text-muted-foreground/80">
          Description <span className="text-muted-foreground/40">(optional)</span>
        </Label>
        <Textarea
          id="wiz-channel-about"
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          placeholder="What's this room about?"
          className="min-h-[60px] text-base sm:text-sm bg-muted/20 border-border/30 resize-none"
          maxLength={300}
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground/80">
          Channel image <span className="text-muted-foreground/40">(optional)</span>
        </Label>
        <input
          ref={picInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) { setPicture(file); setPicturePreview(URL.createObjectURL(file)); }
            e.target.value = "";
          }}
        />
        {picturePreview ? (
          <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-border/30 bg-muted/20 group">
            <img src={picturePreview} alt="Room" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => { setPicture(null); URL.revokeObjectURL(picturePreview); setPicturePreview(null); }}
              className="absolute inset-0 flex items-center justify-center bg-black/50 reveal-on-hover"
              aria-label="Remove this picture"
              title="Remove picture"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => picInputRef.current?.click()}
            className="w-16 h-16 rounded-lg border-2 border-dashed border-border/30 bg-muted/10 flex flex-col items-center justify-center gap-1 hover:bg-muted/20 hover:border-brand/30 transition-colors"
          >
            <ImagePlus className="w-4 h-4 text-muted-foreground/40" />
            <span className="text-[8px] text-muted-foreground/40">Upload</span>
          </button>
        )}
      </div>
    </div>
  );

  const typeStep = (
    <div className="space-y-2 py-1">
      <p className="text-xs text-muted-foreground/70">Who can join and contribute?</p>
      {TYPE_OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = type === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => setType(opt.id)}
            className={`w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
              active
                ? "border-brand/40 bg-brand/[0.08]"
                : "border-border/30 bg-muted/10 hover:bg-muted/20"
            }`}
            data-testid={`wizard-type-${opt.id}`}
          >
            <Icon className={`w-4 h-4 shrink-0 ${active ? "text-brand" : "text-muted-foreground/50"}`} />
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-medium">{opt.label}</span>
              <span className="block text-[10px] text-muted-foreground/55 leading-snug">{opt.desc}</span>
            </span>
            <span className={`w-3.5 h-3.5 rounded-full border shrink-0 flex items-center justify-center ${active ? "border-brand bg-brand" : "border-border/40"}`}>
              {active && <Check className="w-2.5 h-2.5 text-white" />}
            </span>
          </button>
        );
      })}
    </div>
  );

  // ---- Footer per step ------------------------------------------------------

  const totalSteps = currentCapable ? 2 : 3;
  const stepNum = currentCapable
    ? (step === "details" ? 1 : 2)
    : (step === "where" ? 1 : step === "details" ? 2 : 3);
  // Back only exists when there is a previous step. On a capable relay the
  // "where" picker is skipped, so "details" is the first slide — no Back.
  const showBack = step === "type" || (step === "details" && !currentCapable);
  const cancelBtn = (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 text-xs gap-1 text-muted-foreground/70"
      onClick={close}
      disabled={creating}
      data-testid="wizard-cancel"
    >
      <X className="w-3.5 h-3.5" /> Cancel
    </Button>
  );
  const footer = step === "where" ? (
    <div className="flex items-center justify-end w-full">{cancelBtn}</div>
  ) : (
    <div className="flex items-center justify-between gap-2 w-full">
      {showBack ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1"
          onClick={() => setStep(step === "type" ? "details" : "where")}
          disabled={creating}
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </Button>
      ) : (
        cancelBtn
      )}
      {step === "details" ? (
        <Button
          size="sm"
          className="h-8 text-xs gap-1.5 bg-brand hover:bg-brand text-white"
          onClick={() => setStep("type")}
          disabled={!name.trim()}
          data-testid="wizard-next"
        >
          Next
        </Button>
      ) : (
        <Button
          size="sm"
          className="h-8 text-xs gap-1.5 bg-brand hover:bg-brand text-white"
          onClick={handleCreate}
          disabled={!name.trim() || creating}
          data-testid="wizard-create"
        >
          {creating ? <><RelayOutpostInlineLoader className="w-3 h-3" /> Creating…</> : <><Plus className="w-3 h-3" /> Create room</>}
        </Button>
      )}
    </div>
  );

  const title = (
    <span className="font-brand tracking-wider uppercase text-brand flex items-center gap-2">
      <Plus className="w-4 h-4" /> Create room
      {step !== "where" && <span className="text-[10px] font-mono text-muted-foreground/40 tracking-normal normal-case">{stepNum} of {totalSteps}</span>}
    </span>
  );

  return (
    <ResponsiveFormPanel
      open={open}
      onOpenChange={(o) => { if (!o) close(); }}
      contentClassName="border-brand/20"
      title={title}
      description={
        step === "where" ? "Pick a relay that can host your room."
        : step === "details" ? "Name your room and add an optional description."
        : "Choose who can join and contribute."
      }
      footer={footer}
    >
      {step === "where" ? whereStep : step === "details" ? detailsStep : typeStep}
    </ResponsiveFormPanel>
  );
}
