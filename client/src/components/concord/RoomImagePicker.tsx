/**
 * Tap-to-upload room image for an encrypted outpost. Replaces the raw "avatar
 * URL" paste — picks a file, scrubs + uploads via the shared media pipeline,
 * previews the result. No link handling for the user.
 */
import { useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { uploadMedia } from "@/lib/media-upload";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

export function RoomImagePicker({ value, onChange, fallback = "?", size = 64 }: {
  value?: string;
  onChange: (url: string | undefined) => void;
  fallback?: string;
  size?: number;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const px = `${size}px`;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await uploadMedia(file, undefined, getGlobalSigner());
      onChange(res.url);
    } catch (err) {
      toast({ title: "Couldn't upload image", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setBusy(false);
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
        aria-label="Upload room image"
      >
        <Avatar className="w-full h-full">
          {value && <AvatarImage src={value} alt="Room image" />}
          <AvatarFallback className="bg-brand/20 text-brand text-lg font-bold">{fallback.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity">
          {busy ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <ImagePlus className="w-5 h-5 text-white" />}
        </span>
      </button>
      <div className="min-w-0">
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="text-xs font-medium text-brand hover:underline disabled:opacity-50">
          {busy ? "Uploading…" : value ? "Change image" : "Upload image"}
        </button>
        {value && !busy && (
          <button type="button" onClick={() => onChange(undefined)} className="block text-[11px] text-muted-foreground/50 hover:text-destructive mt-0.5">Remove</button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} data-testid="room-image-input" />
    </div>
  );
}
