import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { uploadToNostrBuild, UploadError } from "@/lib/media-upload";
import { getPublishTarget } from "@/lib/outpost-relays";
import { publishEvent } from "@/lib/nostr";
import { clientTags } from "@/lib/nostr-helpers";
import { publishPodcastFeed } from "@/lib/music";
import { signWithTimeout } from "@/lib/signer-timeout";
import { createScheduledPost } from "@/lib/schedule";
import { UploadTrackDialog } from "@/components/UploadTrackDialog";
import createBg from "../assets/images/create-bg.webp";
import {
  Pencil, Image as ImageIcon, Video as VideoIcon, Music, BookOpen, Mic,
  UploadCloud, Clock, ChevronLeft, Loader2, X,
} from "lucide-react";

// One global event opens the studio from anywhere (sidebar, mobile footer,
// Command Post header). Mounted once at the app root.
export const OPEN_CREATE_STUDIO = "open-create-studio";
export function openCreateStudio() {
  window.dispatchEvent(new CustomEvent(OPEN_CREATE_STUDIO));
}

type Step = "picker" | "photo" | "video" | "audio" | "podcast";

// Each type gets its own tinted icon chip (chip = soft bg, icon = matching hue)
// so the grid reads at a glance — hues reused from the app's feed-card accents.
const TYPES: { id: Step | "note" | "article"; label: string; icon: typeof Pencil; desc: string; chip: string; tint: string }[] = [
  { id: "note", label: "Note", icon: Pencil, desc: "A quick post", chip: "bg-brand/10", tint: "text-brand" },
  { id: "photo", label: "Photo", icon: ImageIcon, desc: "Share an image", chip: "bg-sky-500/10", tint: "text-sky-600 dark:text-sky-400" },
  { id: "video", label: "Video", icon: VideoIcon, desc: "Share a video", chip: "bg-rose-500/10", tint: "text-rose-600 dark:text-rose-400" },
  { id: "audio", label: "Audio", icon: Music, desc: "Publish a track", chip: "bg-teal-500/10", tint: "text-teal-600 dark:text-teal-400" },
  { id: "article", label: "Article", icon: BookOpen, desc: "Write long-form", chip: "bg-amber-500/10", tint: "text-amber-600 dark:text-amber-400" },
  { id: "podcast", label: "Podcast", icon: Mic, desc: "Connect an RSS feed", chip: "bg-emerald-500/10", tint: "text-emerald-600 dark:text-emerald-400" },
];

export function CreateStudio() {
  const [, setLocation] = useLocation();
  const { pubkey, signer } = useNostrAuth();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("picker");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [podcastUrl, setPodcastUrl] = useState("");
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [audioDialogOpen, setAudioDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setStep("picker");
    setFile(null);
    setCaption(""); setPodcastUrl("");
    setScheduleOn(false); setScheduleAt(""); setBusy(false); setStatus("");
    setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setCoverFile(null);
    setCoverPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
  }, []);

  useEffect(() => {
    const onOpen = () => { reset(); setOpen(true); };
    window.addEventListener(OPEN_CREATE_STUDIO, onOpen);
    return () => window.removeEventListener(OPEN_CREATE_STUDIO, onOpen);
  }, [reset]);

  const close = useCallback(() => { setOpen(false); reset(); }, [reset]);

  const pickType = useCallback((id: typeof TYPES[number]["id"]) => {
    if (id === "note") {
      close();
      // Reuse the existing composer FAB for plain notes (mentions, polls, emoji).
      setTimeout(() => (document.querySelector('[data-testid="button-fab-compose"]') as HTMLButtonElement | null)?.click(), 60);
      return;
    }
    if (id === "article") { close(); setLocation("/articles/write"); return; }
    // Audio delegates to the canonical, richer track publisher (cover art, genre,
    // description, duration, privacy metadata-strip, validation) — one audio flow.
    if (id === "audio") { close(); setTimeout(() => setAudioDialogOpen(true), 60); return; }
    setStep(id as Step);
  }, [close, setLocation]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return f && f.type.startsWith("image/") ? URL.createObjectURL(f) : null; });
  };

  const onCoverFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    if (f && !f.type.startsWith("image/")) {
      toast({ title: "Images only", description: "Pick an image for the cover.", variant: "destructive" });
      return;
    }
    setCoverFile(f);
    setCoverPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return f ? URL.createObjectURL(f) : null; });
  };
  const clearCover = () => {
    setCoverFile(null);
    setCoverPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
  };

  const requireAuth = () => {
    if (!pubkey || !signer) { toast({ title: "Sign in first", description: "Connect your account to publish.", variant: "destructive" }); return false; }
    return true;
  };

  const publishOrSchedule = async (template: any, preview: string) => {
    const signed = await signWithTimeout(signer!, template);
    const { relays, userSelected } = getPublishTarget();
    if (scheduleOn && scheduleAt) {
      const when = new Date(scheduleAt);
      if (isNaN(when.getTime()) || when.getTime() < Date.now() + 30_000) {
        throw new Error("Pick a time at least a minute from now.");
      }
      await createScheduledPost(signed, relays, when, pubkey!, preview);
      toast({ title: "Scheduled", description: `Publishes ${when.toLocaleString()}.` });
    } else {
      await publishEvent(signed, relays, undefined, userSelected);
      toast({ title: "Published", description: "Your content is live." });
    }
    window.dispatchEvent(new CustomEvent("content-published"));
  };

  const handlePublish = async () => {
    if (!requireAuth()) return;
    setBusy(true);
    try {
      if (step === "podcast") {
        const url = podcastUrl.trim();
        if (!/^https?:\/\//i.test(url)) throw new Error("Enter a valid RSS feed URL.");
        const ok = await publishPodcastFeed(url, signer);
        if (!ok) throw new Error("Couldn't publish the feed to relays.");
        toast({ title: "Podcast connected", description: "Your feed is now on your profile." });
        window.dispatchEvent(new CustomEvent("content-published"));
        close();
        return;
      }
      if (!file) throw new Error("Choose a file first.");
      setStatus("Uploading…");
      const { url } = await uploadToNostrBuild(file, setStatus, signer);
      // Optional cover image for video — powers the thumbnail and richer previews.
      // (Audio is published via the dedicated UploadTrackDialog, which has its own
      // cover-art flow.) Uploaded separately so it has its own hosted URL.
      let coverUrl = "";
      if (coverFile && step === "video") {
        setStatus("Uploading cover…");
        const up = await uploadToNostrBuild(coverFile, setStatus, signer);
        coverUrl = up.url;
      }
      setStatus("Publishing…");
      const now = Math.floor(Date.now() / 1000);
      let template: any;
      let preview = caption;
      if (step === "photo") {
        template = { kind: 1, created_at: now, content: caption ? `${caption}\n${url}` : url, tags: [...clientTags(), ["imeta", `url ${url}`, `m ${file.type}`]] };
        preview = caption || "Photo";
      } else {
        // video: NIP-92 imeta with an optional `image` thumbnail so clients show a poster.
        const imeta = ["imeta", `url ${url}`, `m ${file.type}`, ...(coverUrl ? [`image ${coverUrl}`] : [])];
        template = { kind: 1, created_at: now, content: caption ? `${caption}\n${url}` : url, tags: [...clientTags(), ["r", url], imeta, ...(coverUrl ? [["image", coverUrl]] : [])] };
        preview = caption || "Video";
      }
      await publishOrSchedule(template, preview);
      close();
    } catch (err: any) {
      const msg = err instanceof UploadError ? err.message : (err?.message || "Something went wrong.");
      toast({ title: "Couldn't publish", description: msg, variant: "destructive" });
      setBusy(false);
      setStatus("");
    }
  };

  const canSchedule = step === "photo" || step === "video";
  const acceptFor = step === "photo" ? "image/*" : "video/*";

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogContent className="glass-dialog-card border-brand/15 max-w-lg w-[calc(100vw-1.5rem)] max-h-[88vh] overflow-y-auto p-0 gap-0 rounded-2xl sm:rounded-2xl" data-testid="dialog-create-studio">
        {/* Subtle space backdrop — blends into the modal in both themes. Sits at
            a NEGATIVE z so it's behind the content AND the close button (raising
            content with a positive z hid the X). A background-tinted gradient
            keeps the satellites visible up top while the buttons stay crisp.
            The radial violet glow is a single static gradient — GPU-cheap, no
            fixed-attachment textures (see the PR #98 mobile-flicker rule). */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]">
          <img
            src={createBg}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover object-top opacity-[0.12] dark:opacity-[0.24]"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/25 via-background/60 to-background/92" />
          <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(ellipse_75%_100%_at_50%_0%,rgba(139,92,246,0.14),transparent_70%)] dark:bg-[radial-gradient(ellipse_75%_100%_at_50%_0%,rgba(139,92,246,0.22),transparent_70%)]" />
        </div>
        <div className="px-5 pt-5 pb-3.5 border-b border-brand/10 dark:border-white/[0.06]">
          <DialogTitle className="flex items-center gap-2.5 text-base">
            {step !== "picker" && (
              <button onClick={() => { setStep("picker"); setFile(null); }} className="flex h-9 w-9 -ml-2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors" data-testid="button-create-back" aria-label="Back">
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            {step === "picker" ? "Create" : `New ${step}`}
          </DialogTitle>
          <DialogDescription className="text-xs mt-1">
            {step === "picker" ? "Pick a format — it files into the right place automatically." : "Publishes to your relays and your profile."}
          </DialogDescription>
        </div>

        <div className="p-5">
          {step === "picker" && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="create-type-grid">
              {TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => pickType(t.id)}
                  className={`group flex h-full min-h-[104px] flex-col items-start gap-2 p-3.5 rounded-xl border bg-card/60 dark:bg-white/[0.03] shadow-[0_2px_10px_-2px_rgba(100,70,180,0.10)] dark:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.5)] hover:bg-card/90 dark:hover:bg-white/[0.06] hover:border-brand/40 hover:shadow-[0_6px_20px_-4px_rgba(124,58,237,0.22)] motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 motion-safe:active:scale-[0.98] transition-all duration-200 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                    t.id === "note"
                      ? "border-brand/30 dark:border-brand/25"
                      : "border-brand/15 dark:border-brand/10"
                  }`}
                  data-testid={`create-type-${t.id}`}
                >
                  <span aria-hidden className={`flex h-9 w-9 items-center justify-center rounded-lg ${t.chip} ring-1 ring-inset ring-white/[0.06]`}>
                    <t.icon className={`w-[18px] h-[18px] ${t.tint}`} />
                  </span>
                  <span className="text-sm font-medium text-foreground">{t.label}</span>
                  <span className="text-[11px] text-muted-foreground leading-tight">{t.desc}</span>
                </button>
              ))}
            </div>
          )}

          {step === "podcast" && (
            <div className="space-y-3">
              <label className="text-xs font-medium text-muted-foreground">Podcast RSS feed URL</label>
              <Input value={podcastUrl} onChange={(e) => setPodcastUrl(e.target.value)} placeholder="https://example.com/feed.xml" inputMode="url" className="bg-card/60 dark:bg-white/[0.03] border-brand/15 dark:border-brand/10" data-testid="input-podcast-url" />
              <p className="text-[11px] text-muted-foreground">Episodes appear under Media → Audio on your profile.</p>
              <Button className="w-full" disabled={busy || !podcastUrl.trim()} onClick={handlePublish} data-testid="button-publish-podcast">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4 mr-1.5" />} Connect podcast
              </Button>
            </div>
          )}

          {(step === "photo" || step === "video") && (
            <div className="space-y-3">
              <input ref={fileInputRef} type="file" accept={acceptFor} className="hidden" onChange={onFile} data-testid="input-create-file" />
              {!file ? (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-2 py-10 rounded-xl border-2 border-dashed border-brand/20 dark:border-brand/15 bg-card/40 dark:bg-white/[0.02] hover:border-brand/50 hover:bg-brand/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-colors"
                  data-testid="button-pick-file"
                >
                  <UploadCloud className="w-7 h-7 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Choose {step === "photo" ? "an image" : step === "video" ? "a video" : "an audio file"}</span>
                </button>
              ) : (
                <div className="flex items-center gap-3 p-3 rounded-xl border border-brand/15 dark:border-brand/10 bg-card/60 dark:bg-white/[0.03]">
                  {previewUrl ? (
                    <img src={previewUrl} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      {step === "video" ? <VideoIcon className="w-6 h-6 text-muted-foreground" /> : <Music className="w-6 h-6 text-muted-foreground" />}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{file.name}</div>
                    <div className="text-[11px] text-muted-foreground">{(file.size / (1024 * 1024)).toFixed(1)} MB</div>
                  </div>
                  <button onClick={() => { setFile(null); setPreviewUrl((p) => { if (p) URL.revokeObjectURL(p); return null; }); }} className="text-muted-foreground hover:text-foreground" data-testid="button-clear-file" aria-label="Remove file">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption…" rows={3} className="bg-card/60 dark:bg-white/[0.03] border-brand/15 dark:border-brand/10" data-testid="input-create-caption" />

              {step === "video" && (
                <div className="rounded-xl border border-brand/15 dark:border-brand/10 bg-card/60 dark:bg-white/[0.03] p-3">
                  <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={onCoverFile} data-testid="input-cover-file" />
                  <div className="flex items-center gap-3">
                    {coverPreviewUrl ? (
                      <img src={coverPreviewUrl} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />
                    ) : (
                      <button
                        type="button"
                        onClick={() => coverInputRef.current?.click()}
                        className="w-14 h-14 rounded-lg border-2 border-dashed border-brand/20 dark:border-brand/15 hover:border-brand/50 hover:bg-brand/5 flex items-center justify-center shrink-0 transition-colors"
                        data-testid="button-pick-cover"
                        aria-label="Add cover image"
                      >
                        <ImageIcon className="w-5 h-5 text-muted-foreground" />
                      </button>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground">
                        Cover image <span className="text-[11px] font-normal text-brand">· Recommended</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground leading-tight">
                        Shows as the video thumbnail and improves how your post previews everywhere.
                      </div>
                    </div>
                    {coverPreviewUrl ? (
                      <button type="button" onClick={clearCover} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Remove cover image" data-testid="button-clear-cover">
                        <X className="w-4 h-4" />
                      </button>
                    ) : (
                      <button type="button" onClick={() => coverInputRef.current?.click()} className="text-xs font-medium text-brand shrink-0" data-testid="button-add-cover">
                        Add
                      </button>
                    )}
                  </div>
                </div>
              )}

              {canSchedule && (
                <div className="rounded-xl border border-brand/15 dark:border-brand/10 bg-card/60 dark:bg-white/[0.03] p-3 space-y-2">
                  <label className="flex items-center justify-between text-sm cursor-pointer">
                    <span className="flex items-center gap-2"><Clock className="w-4 h-4 text-muted-foreground" /> Schedule for later</span>
                    <input type="checkbox" checked={scheduleOn} onChange={(e) => setScheduleOn(e.target.checked)} className="accent-brand" data-testid="toggle-schedule" />
                  </label>
                  {scheduleOn && (
                    <Input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="bg-card/60 dark:bg-white/[0.03] border-brand/15 dark:border-brand/10" data-testid="input-schedule-at" />
                  )}
                </div>
              )}

              {busy && status && <p className="text-[11px] text-muted-foreground text-center">{status}</p>}
              <Button className="w-full" disabled={busy || !file} onClick={handlePublish} data-testid="button-create-publish">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {scheduleOn && canSchedule ? "Schedule" : "Publish"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
    {/* Audio publishing is delegated to the canonical, richer track dialog. */}
    <UploadTrackDialog
      open={audioDialogOpen}
      onOpenChange={setAudioDialogOpen}
      onPublished={() => window.dispatchEvent(new CustomEvent("content-published"))}
    />
    </>
  );
}
