import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Music, ImagePlus, ShieldCheck, Send, AlertTriangle } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { uploadToNostrBuild, UploadError, validateFile, canStripAudioMetadata } from "@/lib/media-upload";
import { publishEvent, DEFAULT_RELAYS } from "@/lib/nostr";
import { getPublishTarget } from "@/lib/outpost-relays";
import { KIND_MUSIC_TRACK, MUSIC_RELAYS } from "@/lib/music";
import { clientTags } from "@/lib/nostr-helpers";
import { signWithTimeout } from "@/lib/signer-timeout";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import createBg from "../assets/images/create-bg.webp";

function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";
    const timeout = setTimeout(() => {
      URL.revokeObjectURL(url);
      resolve(0);
    }, 5000);
    audio.onloadedmetadata = () => {
      clearTimeout(timeout);
      const dur = Math.round(audio.duration);
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(dur) && dur > 0 ? dur : 0);
    };
    audio.onerror = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      resolve(0);
    };
    audio.src = url;
  });
}

const GENRE_OPTIONS = [
  "Pop", "Rock", "Hip-Hop", "Electronic", "Country", "R&B", "Jazz",
  "Classical", "Reggae", "Blues", "Folk", "Latin", "Metal", "Punk",
  "Indie", "Alternative", "World", "Ambient", "Lo-fi", "Podcast",
];

interface UploadTrackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublished?: () => void;
}

export function UploadTrackDialog({ open, onOpenChange, onPublished }: UploadTrackDialogProps) {
  const { signer, profile } = useNostrAuth();
  const { toast } = useToast();

  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [genre, setGenre] = useState("");
  const [description, setDescription] = useState("");

  const [audioUrl, setAudioUrl] = useState("");
  const [audioFileName, setAudioFileName] = useState("");
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioUploading, setAudioUploading] = useState(false);
  const [audioUploadStatus, setAudioUploadStatus] = useState("");

  const [coverUrl, setCoverUrl] = useState("");
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverUploadStatus, setCoverUploadStatus] = useState("");

  const [isPublishing, setIsPublishing] = useState(false);
  const [audioMetadataStripped, setAudioMetadataStripped] = useState(false);

  const audioInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const resetForm = useCallback(() => {
    setTitle("");
    setArtist("");
    setGenre("");
    setDescription("");
    setAudioUrl("");
    setAudioFileName("");
    setAudioDuration(0);
    setCoverUrl("");
    setAudioUploadStatus("");
    setCoverUploadStatus("");
    setAudioMetadataStripped(false);
  }, []);

  const handleAudioUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      validateFile(file);
    } catch (err) {
      toast({ title: "Invalid file", description: err instanceof UploadError ? err.message : "Unsupported audio file.", variant: "destructive" });
      return;
    }
    if (!file.type.startsWith("audio/")) {
      toast({ title: "Not an audio file", description: "Please select an audio file (MP3, WAV, FLAC, etc.).", variant: "destructive" });
      return;
    }

    setAudioUploading(true);
    setAudioUploadStatus("Preparing upload...");
    try {
      const fileDuration = await getAudioDuration(file);
      setAudioDuration(fileDuration);
      const result = await uploadToNostrBuild(file, setAudioUploadStatus, signer);
      setAudioUrl(result.url);
      setAudioFileName(file.name);
      setAudioMetadataStripped(result.metadataStripped || false);
      if (!title) {
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
        setTitle(nameWithoutExt);
      }
      const desc = result.metadataStripped
        ? "Track uploaded. Metadata was scrubbed."
        : canStripAudioMetadata(file)
          ? "Track uploaded."
          : "Track uploaded. This format's metadata could not be stripped.";
      toast({ title: "Audio uploaded", description: desc });
    } catch (err) {
      console.error("Audio upload failed:", err);
      toast({ title: "Upload failed", description: err instanceof UploadError ? err.message : "Could not upload audio file.", variant: "destructive" });
    } finally {
      setAudioUploading(false);
      setAudioUploadStatus("");
      if (audioInputRef.current) audioInputRef.current.value = "";
    }
  }, [signer, title, toast]);

  const handleCoverUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      validateFile(file);
    } catch (err) {
      toast({ title: "Invalid file", description: err instanceof UploadError ? err.message : "Unsupported image.", variant: "destructive" });
      return;
    }

    setCoverUploading(true);
    setCoverUploadStatus("Uploading cover...");
    try {
      const result = await uploadToNostrBuild(file, setCoverUploadStatus, signer);
      setCoverUrl(result.url);
      toast({ title: "Cover uploaded", description: result.metadataStripped ? "Location data was removed." : "Cover art set." });
    } catch (err) {
      console.error("Cover upload failed:", err);
      toast({ title: "Upload failed", description: err instanceof UploadError ? err.message : "Could not upload cover art.", variant: "destructive" });
    } finally {
      setCoverUploading(false);
      setCoverUploadStatus("");
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  }, [signer, toast]);

  const handlePublish = async () => {
    if (!signer) {
      toast({ title: "Not signed in", description: "Sign in with a browser extension to publish.", variant: "destructive" });
      return;
    }
    if (!audioUrl) {
      toast({ title: "No audio", description: "Upload an audio file first.", variant: "destructive" });
      return;
    }
    if (!title.trim()) {
      toast({ title: "Title required", description: "Give your track a title.", variant: "destructive" });
      return;
    }

    setIsPublishing(true);
    try {
      const artistName = artist.trim() || profile?.display_name || profile?.name || "Unknown Artist";
      const dTag = `${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Math.floor(Date.now() / 1000)}`;

      const tags: string[][] = [
        ["d", dTag],
        ["title", title.trim()],
        ["subject", title.trim()],
        ["artist", artistName],
        ["media", audioUrl],
        ["url", audioUrl],
      ];

      if (coverUrl) {
        tags.push(["cover", coverUrl]);
        tags.push(["image", coverUrl]);
      }
      if (genre) {
        tags.push(["t", genre.toLowerCase()]);
      }
      if (audioDuration > 0) {
        tags.push(["duration", String(audioDuration)]);
      }
      tags.push(["t", "music"]);
      tags.push(...clientTags());
      if (description.trim()) {
        tags.push(["summary", description.trim()]);
      }

      const eventTemplate = {
        kind: KIND_MUSIC_TRACK,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: description.trim() };

      const signedEvent = await signWithTimeout(signer, eventTemplate);
      const { relays: userRelays, userSelected: isUserSelected } = getPublishTarget();
      const trackRelays = isUserSelected
        ? Array.from(new Set([...userRelays, ...MUSIC_RELAYS]))
        : Array.from(new Set([...DEFAULT_RELAYS, ...MUSIC_RELAYS]));
      await publishEvent(signedEvent, trackRelays, undefined, isUserSelected);

      toast({ title: "Track published!", description: `"${title.trim()}" is now live.` });
      resetForm();
      onOpenChange(false);
      onPublished?.();
    } catch (err) {
      console.error("Failed to publish track:", err);
      toast({ title: "Publish failed", description: "Could not publish track to relays.", variant: "destructive" });
    } finally {
      setIsPublishing(false);
    }
  };

  const isUploading = audioUploading || coverUploading;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isUploading && !isPublishing) onOpenChange(v); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg glass-dialog-card border-brand/15 max-h-[85vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6 rounded-2xl sm:rounded-2xl" data-testid="dialog-upload-track">
        {/* Same subtle space backdrop as the Create studio (photo/video) so the
            audio flow shares one visual language. Negative z keeps it behind the
            content and the close button; static gradients only — no
            fixed-attachment textures (PR #98 mobile-flicker rule). */}
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
        <DialogHeader className="-mx-4 sm:-mx-6 px-4 sm:px-6 pb-3.5 border-b border-brand/10 dark:border-white/[0.06]">
          <DialogTitle className="font-brand uppercase tracking-widest text-sm flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-brand/10 dark:bg-brand/15 flex items-center justify-center shadow-sm">
              <Upload className="w-3.5 h-3.5 text-brand/70" />
            </div>
            Upload Track
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-1 min-w-0 w-full">
          <div className="rounded-xl bg-brand/[0.04]/[0.06] border border-brand/15 dark:border-brand/20 p-3 sm:p-4 shadow-sm shadow-brand/5 dark:shadow-brand/10 transition-all duration-300">
            <p className="text-[10px] text-brand/60 font-mono uppercase tracking-wider mb-2.5">Audio File</p>
            {audioUrl ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-brand/10 dark:bg-brand/15 flex items-center justify-center shrink-0 ring-1 ring-brand/10 shadow-sm">
                    <Music className="w-5 h-5 text-brand/70" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate" data-testid="text-audio-filename">{audioFileName || "Audio uploaded"}</p>
                    <p className="text-[10px] text-muted-foreground/50 break-all line-clamp-1 mt-0.5">{audioUrl}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs h-8"
                  onClick={() => { setAudioUrl(""); setAudioFileName(""); }}
                  data-testid="button-remove-audio"
                >
                  Replace File
                </Button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <Button
                  variant="outline"
                  className="w-full gap-2 h-11 rounded-lg"
                  onClick={() => audioInputRef.current?.click()}
                  disabled={audioUploading}
                  data-testid="button-select-audio"
                >
                  {audioUploading ? <RelayOutpostInlineLoader className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                  {audioUploading ? "Uploading..." : "Select Audio File"}
                </Button>
                <div className="flex items-start gap-1.5">
                  <ShieldCheck className="w-3 h-3 text-green-500/70 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                    MP3, WAV, and FLAC metadata (GPS, device info, ID3 tags) is automatically scrubbed before upload.
                  </p>
                </div>
              </div>
            )}
            {audioUploading && audioUploadStatus && (
              <span className="text-[10px] text-brand/60 flex items-center gap-1 mt-2">
                <RelayOutpostInlineLoader className="w-2.5 h-2.5" />
                {audioUploadStatus}
              </span>
            )}
            {audioUrl && !audioUploading && (
              <span className={`text-[10px] flex items-center gap-1 mt-2 ${audioMetadataStripped ? "text-green-500/70" : "text-amber-500/70"}`}>
                {audioMetadataStripped ? <ShieldCheck className="w-2.5 h-2.5" /> : <AlertTriangle className="w-2.5 h-2.5" />}
                {audioMetadataStripped ? "Metadata scrubbed" : "Metadata could not be scrubbed for this format"}
              </span>
            )}
          </div>

          <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={handleAudioUpload} data-testid="input-upload-audio-file" />
          <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} data-testid="input-upload-cover-art" />

          <div className="rounded-xl border border-brand/15 dark:border-brand/10 bg-card/60 dark:bg-white/[0.03] p-3 sm:p-4 space-y-3 shadow-sm shadow-primary/5 dark:shadow-primary/10 transition-all duration-300">
            <div>
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-1.5 block">Title *</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Track title"
                className="bg-background/60 dark:bg-white/[0.04] border-brand/15 dark:border-brand/10 focus-visible:ring-1 focus-visible:ring-brand/30 focus-visible:border-brand/40 transition-all"
                style={{ fontSize: 16 }}
                enterKeyHint="next"
                autoCorrect="off"
                data-testid="input-track-title"
              />
            </div>

            <div>
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-1.5 block">Artist</label>
              <Input
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder={profile?.display_name || profile?.name || "Artist name"}
                className="bg-background/60 dark:bg-white/[0.04] border-brand/15 dark:border-brand/10 focus-visible:ring-1 focus-visible:ring-brand/30 focus-visible:border-brand/40 transition-all"
                style={{ fontSize: 16 }}
                enterKeyHint="next"
                autoCorrect="off"
                data-testid="input-track-artist"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-brand/15 dark:border-brand/10 bg-card/60 dark:bg-white/[0.03] p-3 shadow-sm shadow-primary/5 dark:shadow-primary/10 transition-all duration-300">
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-1.5 block">Genre</label>
              <Select value={genre} onValueChange={setGenre}>
                <SelectTrigger className="bg-background/60 dark:bg-white/[0.04] border-brand/15 dark:border-brand/10" style={{ fontSize: 16 }} data-testid="select-track-genre">
                  <SelectValue placeholder="Select genre" />
                </SelectTrigger>
                <SelectContent className="z-[220] max-h-[40vh] glass-card border-brand/20 dark:border-brand/25 bg-background/95 dark:bg-background/95 backdrop-blur-xl shadow-xl shadow-brand/10 dark:shadow-brand/15">
                  {GENRE_OPTIONS.map((g) => (
                    <SelectItem key={g} value={g} className="text-sm focus:bg-brand/10 dark:focus:bg-brand/15 focus:text-foreground cursor-pointer">{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-xl border border-brand/15 dark:border-brand/10 bg-card/60 dark:bg-white/[0.03] p-3 shadow-sm shadow-primary/5 dark:shadow-primary/10 transition-all duration-300">
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-1.5 block">Cover Art</label>
              {coverUrl ? (
                <div className="flex items-center gap-2.5">
                  <img src={coverUrl} alt="Cover" className="w-11 h-11 rounded-lg object-cover ring-1 ring-border/20 dark:ring-primary/10 shadow-sm" data-testid="img-cover-preview" />
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => coverInputRef.current?.click()}
                    disabled={coverUploading}
                    data-testid="button-replace-cover"
                  >
                    Replace
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full gap-1.5 text-xs h-11 rounded-lg"
                  onClick={() => coverInputRef.current?.click()}
                  disabled={coverUploading}
                  data-testid="button-select-cover"
                >
                  {coverUploading ? <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> : <ImagePlus className="w-3.5 h-3.5" />}
                  {coverUploading ? "Uploading..." : "Add Cover"}
                </Button>
              )}
              {coverUploading && coverUploadStatus && (
                <span className="text-[10px] text-brand/60 flex items-center gap-1 mt-1.5">
                  <ShieldCheck className="w-2.5 h-2.5" />
                  {coverUploadStatus}
                </span>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-brand/15 dark:border-brand/10 bg-card/60 dark:bg-white/[0.03] p-3 sm:p-4 shadow-sm shadow-primary/5 dark:shadow-primary/10 transition-all duration-300">
            <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-1.5 block">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="About this track (optional)"
              className="resize-none bg-background/60 dark:bg-white/[0.04] border-brand/15 dark:border-brand/10 focus-visible:ring-1 focus-visible:ring-brand/30 focus-visible:border-brand/40 text-sm transition-all"
              style={{ fontSize: 16 }}
              rows={2}
              autoComplete="off"
              data-testid="input-track-description"
            />
          </div>

          <Button
            onClick={handlePublish}
            disabled={!audioUrl || !title.trim() || isPublishing || isUploading}
            className="w-full gap-2 h-11 rounded-lg shadow-md shadow-primary/10 dark:shadow-primary/20"
            data-testid="button-publish-track"
          >
            {isPublishing ? (
              <RelayOutpostInlineLoader className="w-4 h-4" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {isPublishing ? "Publishing..." : "Publish Track"}
          </Button>

          <p className="text-[10px] text-muted-foreground/40 text-center">
            Your track will be published as a music post — playable in any compatible app.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
