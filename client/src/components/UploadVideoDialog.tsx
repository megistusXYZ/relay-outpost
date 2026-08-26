import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Film, ImagePlus, AlertTriangle, Send, Smartphone, Monitor } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { uploadToNostrBuild, UploadError, validateFile } from "@/lib/media-upload";
import { publishEvent } from "@/lib/nostr";
import { getPublishTarget } from "@/lib/outpost-relays";
import { clientTags } from "@/lib/nostr-helpers";
import { signWithTimeout } from "@/lib/signer-timeout";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

export type VideoOrientation = "portrait" | "landscape";

function detectVideoOrientation(file: File): Promise<{ orientation: VideoOrientation; width: number; height: number }> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    const cleanup = () => URL.revokeObjectURL(objectUrl);
    video.onloadedmetadata = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      cleanup();
      resolve({ orientation: h > w ? "portrait" : "landscape", width: w, height: h });
    };
    video.onerror = () => {
      cleanup();
      resolve({ orientation: "landscape", width: 0, height: 0 });
    };
    setTimeout(() => {
      cleanup();
      resolve({ orientation: "landscape", width: 0, height: 0 });
    }, 5000);
  });
}

interface UploadVideoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublished?: () => void;
}

export function UploadVideoDialog({ open, onOpenChange, onPublished }: UploadVideoDialogProps) {
  const { signer } = useNostrAuth();
  const { toast } = useToast();

  const [caption, setCaption] = useState("");

  const [videoUrl, setVideoUrl] = useState("");
  const [videoFileName, setVideoFileName] = useState("");
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoUploadStatus, setVideoUploadStatus] = useState("");
  const [detectedOrientation, setDetectedOrientation] = useState<VideoOrientation | null>(null);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null);

  const [thumbUrl, setThumbUrl] = useState("");
  const [thumbUploading, setThumbUploading] = useState(false);
  const [thumbUploadStatus, setThumbUploadStatus] = useState("");

  const [isPublishing, setIsPublishing] = useState(false);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  const resetForm = useCallback(() => {
    setCaption("");
    setVideoUrl("");
    setVideoFileName("");
    setThumbUrl("");
    setVideoUploadStatus("");
    setThumbUploadStatus("");
    setDetectedOrientation(null);
    setVideoDimensions(null);
  }, []);

  const handleVideoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
      toast({ title: "Video too large", description: "Videos must be under 100 MB.", variant: "destructive" });
      if (videoInputRef.current) videoInputRef.current.value = "";
      return;
    }
    if (!file.type.startsWith("video/")) {
      toast({ title: "Not a video file", description: "Please select a video file.", variant: "destructive" });
      if (videoInputRef.current) videoInputRef.current.value = "";
      return;
    }

    setVideoUploading(true);
    setVideoUploadStatus("Detecting video format...");
    try {
      const detected = await detectVideoOrientation(file);
      setDetectedOrientation(detected.orientation);
      if (detected.width > 0) setVideoDimensions({ width: detected.width, height: detected.height });
    } catch {
      setDetectedOrientation("landscape");
    }
    setVideoUploadStatus("Preparing upload...");
    try {
      const result = await uploadToNostrBuild(file, setVideoUploadStatus, signer);
      setVideoUrl(result.url);
      setVideoFileName(file.name);
      toast({ title: "Video uploaded", description: "Ready to publish." });
    } catch (err) {
      console.error("Video upload failed:", err);
      toast({ title: "Upload failed", description: err instanceof UploadError ? err.message : "Could not upload video.", variant: "destructive" });
    } finally {
      setVideoUploading(false);
      setVideoUploadStatus("");
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }, [signer, toast]);

  const handleThumbUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      validateFile(file);
    } catch (err) {
      toast({ title: "Invalid file", description: err instanceof UploadError ? err.message : "Unsupported image.", variant: "destructive" });
      return;
    }

    setThumbUploading(true);
    setThumbUploadStatus("Uploading thumbnail...");
    try {
      const result = await uploadToNostrBuild(file, setThumbUploadStatus, signer);
      setThumbUrl(result.url);
      toast({ title: "Thumbnail uploaded", description: result.metadataStripped ? "Location data was removed." : "Thumbnail set." });
    } catch (err) {
      console.error("Thumbnail upload failed:", err);
      toast({ title: "Upload failed", description: err instanceof UploadError ? err.message : "Could not upload thumbnail.", variant: "destructive" });
    } finally {
      setThumbUploading(false);
      setThumbUploadStatus("");
      if (thumbInputRef.current) thumbInputRef.current.value = "";
    }
  }, [signer, toast]);

  const handlePublish = async () => {
    if (!signer) {
      toast({ title: "Not signed in", description: "Sign in to publish.", variant: "destructive" });
      return;
    }
    if (!videoUrl) {
      toast({ title: "No video", description: "Upload a video file first.", variant: "destructive" });
      return;
    }

    setIsPublishing(true);
    try {
      const parts: string[] = [];
      if (caption.trim()) parts.push(caption.trim());
      parts.push(videoUrl);
      const content = parts.join("\n\n");

      const orientation = detectedOrientation || "landscape";
      const tags: string[][] = [
        ["r", videoUrl],
        ["orientation", orientation],
      ];
      if (videoDimensions && videoDimensions.width > 0) {
        tags.push(["dim", `${videoDimensions.width}x${videoDimensions.height}`]);
      }
      if (thumbUrl) {
        tags.push(["r", thumbUrl]);
      }
      tags.push(...clientTags());

      const signedEvent = await signWithTimeout(signer, {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content });
      const { relays: userRelays, userSelected: isUserSelected } = getPublishTarget();
      await publishEvent(signedEvent, userRelays, undefined, isUserSelected);

      toast({ title: "Published!", description: "Your video has been posted." });
      resetForm();
      onOpenChange(false);
      onPublished?.();
    } catch (err) {
      console.error("Failed to publish video:", err);
      toast({ title: "Publish failed", description: "Could not publish video.", variant: "destructive" });
    } finally {
      setIsPublishing(false);
    }
  };

  const isUploading = videoUploading || thumbUploading;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isUploading && !isPublishing) onOpenChange(v); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg glass-dialog-card border-brand/15 max-h-[85vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6" data-testid="dialog-upload-video">
        <DialogHeader>
          <DialogTitle className="font-brand uppercase tracking-widest text-sm flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-brand/10 dark:bg-brand/15 flex items-center justify-center shadow-sm">
              <Upload className="w-3.5 h-3.5 text-brand/70" />
            </div>
            Upload Video
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-1 min-w-0 w-full">
          <div className="rounded-xl bg-brand/[0.04]/[0.06] border border-brand/15 dark:border-brand/20 p-3 sm:p-4 shadow-sm shadow-brand/5 dark:shadow-brand/10 transition-all duration-300">
            <p className="text-[10px] text-brand/60 font-mono uppercase tracking-wider mb-2.5">Video File</p>
            {videoUrl ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-brand/10 dark:bg-brand/15 flex items-center justify-center shrink-0 ring-1 ring-brand/10 shadow-sm">
                    <Film className="w-5 h-5 text-brand/70" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate" data-testid="text-video-filename">{videoFileName || "Video uploaded"}</p>
                    <p className="text-[10px] text-muted-foreground/50 break-all line-clamp-1 mt-0.5">{videoUrl}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs h-8"
                  onClick={() => { setVideoUrl(""); setVideoFileName(""); setThumbUrl(""); setDetectedOrientation(null); setVideoDimensions(null); }}
                  data-testid="button-remove-video"
                >
                  Replace File
                </Button>
                {detectedOrientation && (
                  <div className="flex items-center gap-2 mt-2 p-2 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.06]">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60 shrink-0">Format</span>
                    <div className="flex items-center gap-1.5 flex-1">
                      <button
                        type="button"
                        className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
                          detectedOrientation === "portrait"
                            ? "bg-brand/15 dark:bg-brand/20 text-brand border border-brand/30 dark:border-brand/25 shadow-sm"
                            : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/20"
                        }`}
                        onClick={() => setDetectedOrientation("portrait")}
                        data-testid="button-orientation-portrait"
                      >
                        <Smartphone className="w-3 h-3" />
                        <span className="hidden sm:inline">Vertical</span>
                        <span className="sm:hidden">9:16</span>
                      </button>
                      <button
                        type="button"
                        className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
                          detectedOrientation === "landscape"
                            ? "bg-brand/15 dark:bg-brand/20 text-brand border border-brand/30 dark:border-brand/25 shadow-sm"
                            : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/20"
                        }`}
                        onClick={() => setDetectedOrientation("landscape")}
                        data-testid="button-orientation-landscape"
                      >
                        <Monitor className="w-3 h-3" />
                        <span className="hidden sm:inline">Horizontal</span>
                        <span className="sm:hidden">16:9</span>
                      </button>
                    </div>
                    {videoDimensions && videoDimensions.width > 0 && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground/50 border-border/30 shrink-0">
                        {videoDimensions.width}×{videoDimensions.height}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                <Button
                  variant="outline"
                  className="w-full gap-2 h-11 rounded-lg"
                  onClick={() => videoInputRef.current?.click()}
                  disabled={videoUploading}
                  data-testid="button-select-video"
                >
                  {videoUploading ? <RelayOutpostInlineLoader className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                  {videoUploading ? "Uploading..." : "Select Video File"}
                </Button>
                <div className="flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-amber-500/70 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                    Video metadata (GPS, device info) cannot be stripped in-browser. Consider removing location data beforehand.
                  </p>
                </div>
              </div>
            )}
            {videoUploading && videoUploadStatus && (
              <span className="text-[10px] text-brand/60 flex items-center gap-1 mt-2">
                <RelayOutpostInlineLoader className="w-2.5 h-2.5" />
                {videoUploadStatus}
              </span>
            )}
          </div>

          <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoUpload} data-testid="input-upload-video-file" />
          <input ref={thumbInputRef} type="file" accept="image/*" className="hidden" onChange={handleThumbUpload} data-testid="input-upload-video-thumb" />

          <div className="rounded-xl border border-border/30 dark:border-primary/10 bg-card/30 dark:bg-card/15 p-3 sm:p-4 shadow-sm shadow-primary/5 dark:shadow-primary/10 transition-all duration-300">
            <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-1.5 block">Caption</label>
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Say something about this video (optional)"
              className="resize-none bg-background/50 border-border/30 dark:border-primary/10 focus-visible:ring-1 focus-visible:ring-brand/30 focus-visible:border-brand/40 text-sm transition-all"
              style={{ fontSize: 16 }}
              rows={3}
              autoComplete="off"
              data-testid="input-video-caption"
            />
          </div>

          <div className="rounded-xl border border-border/30 dark:border-primary/10 bg-card/30 dark:bg-card/15 p-3 shadow-sm shadow-primary/5 dark:shadow-primary/10 transition-all duration-300">
            <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-1.5 block">Thumbnail</label>
            {thumbUrl ? (
              <div className="flex items-center gap-2.5">
                <img src={thumbUrl} alt="Thumbnail" className="w-16 h-10 rounded-lg object-cover ring-1 ring-border/20 dark:ring-primary/10 shadow-sm" data-testid="img-thumb-preview" />
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => thumbInputRef.current?.click()}
                  disabled={thumbUploading}
                  data-testid="button-replace-thumb"
                >
                  Replace
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full gap-1.5 text-xs h-11 rounded-lg"
                onClick={() => thumbInputRef.current?.click()}
                disabled={thumbUploading}
                data-testid="button-select-thumb"
              >
                {thumbUploading ? <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> : <ImagePlus className="w-3.5 h-3.5" />}
                {thumbUploading ? "Uploading..." : "Add Thumbnail"}
              </Button>
            )}
            {thumbUploading && thumbUploadStatus && (
              <span className="text-[10px] text-brand/60 flex items-center gap-1 mt-1.5">
                <RelayOutpostInlineLoader className="w-2.5 h-2.5" />
                {thumbUploadStatus}
              </span>
            )}
          </div>

          <Button
            onClick={handlePublish}
            disabled={!videoUrl || isPublishing || isUploading}
            className="w-full gap-2 h-11 rounded-lg shadow-md shadow-primary/10 dark:shadow-primary/20"
            data-testid="button-publish-video"
          >
            {isPublishing ? (
              <RelayOutpostInlineLoader className="w-4 h-4" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {isPublishing ? "Publishing..." : "Publish Video"}
          </Button>

          <p className="text-[10px] text-muted-foreground/40 text-center">
            Your video will be published as a post. Videos up to 100 MB.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
