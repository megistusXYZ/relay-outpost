/**
 * Tap-to-upload group photo for an encrypted group chat. Picks a file, strips
 * its metadata, encrypts it and uploads only the ciphertext — the spec's `icon`
 * (CORD-02 §6), which Armada and Vector show too — then previews it. No link
 * handling for the user, and the media server never sees the photo.
 */
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { uploadCommunityImage } from "@/lib/concord/concord-media";
import type { CommunityImage } from "@/lib/concord/concord-image";
import { useCommunityImage } from "./useCommunityImage";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

export function RoomImagePicker({ image, picture, onChange, fallback = "?", size = 64 }: {
  /** The group's encrypted photo, if it has one. */
  image?: CommunityImage;
  /** A plain photo URL, from a group made before photos were encrypted. */
  picture?: string;
  /** The newly uploaded photo, or null when it's removed. */
  onChange: (image: CommunityImage | null) => void;
  fallback?: string;
  size?: number;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  // The file just picked, shown straight away instead of downloaded back.
  const [local, setLocal] = useState<{ hash: string; url: string } | undefined>();
  useEffect(() => () => { if (local) URL.revokeObjectURL(local.url); }, [local]);
  const opened = useCommunityImage(image);
  const src = (image && local?.hash === image.hash ? local.url : undefined) ?? opened ?? picture;
  const hasPhoto = !!image || !!picture;
  const px = `${size}px`;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const uploaded = await uploadCommunityImage(file, getGlobalSigner(), setStatus);
      setLocal({ hash: uploaded.hash, url: URL.createObjectURL(file) });
      onChange(uploaded);
    } catch (err) {
      toast({ title: "Couldn't upload photo", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setBusy(false);
      setStatus("");
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="relative shrink-0 rounded-full overflow-hidden group border border-border/40 hover:border-primary/50 transition-colors"
        style={{ width: px, height: px }}
        data-testid="room-image-picker"
        aria-label="Upload group photo"
      >
        <Avatar className="w-full h-full">
          {src && <AvatarImage src={src} alt="Group photo" />}
          <AvatarFallback className="bg-brand/20 text-brand text-lg font-bold">{fallback.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity">
          {busy ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <ImagePlus className="w-5 h-5 text-white" />}
        </span>
      </button>
      <div className="min-w-0">
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="text-xs font-medium text-brand hover:underline disabled:opacity-50">
          {busy ? status || "Uploading…" : hasPhoto ? "Change photo" : "Upload photo"}
        </button>
        {hasPhoto && !busy && (
          <button type="button" onClick={() => { setLocal(undefined); onChange(null); }} className="block text-[11px] text-muted-foreground/50 hover:text-destructive mt-0.5">Remove</button>
        )}
        {!busy && <p className="text-[11px] text-muted-foreground/50 mt-0.5">Encrypted, so only members can see it</p>}
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} data-testid="room-image-input" />
    </div>
  );
}
