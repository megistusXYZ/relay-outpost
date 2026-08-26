/**
 * "Rename for you" — set a private nickname and an emoji/color avatar for a
 * person, group or community. Only you ever see it (lib/petnames.ts); the
 * real name stays visible right here, which is the promised reveal surface.
 */
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImagePlus, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getPetname, setPetname, clearPetname, type PetnameKind } from "@/lib/petnames";
import { processImageToAvatar, putPetnameImage, deletePetnameImage, petnameImageUrlSync } from "@/lib/petname-images";

/** A short, deliberately bounded palette — customization, not a color picker. */
const SWATCHES = ["#7c5cff", "#2f9e77", "#d97706", "#dc2626", "#0284c7", "#db2777"];
const EMOJIS = ["⭐", "💼", "🏠", "🎯", "🚀", "🎨", "🛠️", "📚", "❤️", "🤝", "🎮", "🌊"];

export function PetnameDialog({
  open,
  onOpenChange,
  kind,
  id,
  realName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: PetnameKind;
  id: string;
  realName: string;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string | undefined>();
  const [color, setColor] = useState<string | undefined>();
  // Photo state: a freshly-processed blob (preview via its own object URL),
  // an existing stored photo, or a pending removal. Processing happens at
  // PICK time so Save stays instant and a bad file fails loudly right away.
  const [pickedBlob, setPickedBlob] = useState<Blob | null>(null);
  const [pickedUrl, setPickedUrl] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Re-seed from the store each time the dialog opens for a subject.
  useEffect(() => {
    if (!open) return;
    const current = getPetname(kind, id);
    setName(current?.name ?? "");
    setEmoji(current?.emoji);
    setColor(current?.color);
    setPickedBlob(null);
    setRemovePhoto(false);
    setPickedUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
  }, [open, kind, id]);

  const existingUrl = petnameImageUrlSync(kind, id);
  const previewUrl = removePhoto ? null : (pickedUrl ?? existingUrl ?? null);
  const hasExisting = !!getPetname(kind, id) || !!existingUrl;

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const blob = await processImageToAvatar(file);
      setPickedBlob(blob);
      setRemovePhoto(false);
      setPickedUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
    } catch (err) {
      toast({ title: "Couldn't use that image", description: (err as Error).message, variant: "destructive" });
    }
  };

  const save = async () => {
    setPetname(kind, id, { name, emoji, color });
    if (pickedBlob) await putPetnameImage(kind, id, pickedBlob);
    else if (removePhoto) await deletePetnameImage(kind, id);
    onOpenChange(false);
  };
  const clear = async () => {
    clearPetname(kind, id);
    await deletePetnameImage(kind, id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="petname-dialog">
        <DialogHeader>
          <DialogTitle>Rename for you</DialogTitle>
          {/* The reveal: the real name lives here, always. */}
          <DialogDescription data-testid="petname-real-name">
            Real name: <span className="text-foreground/90 font-medium">{realName}</span>. Only you see your version — it never leaves your account.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={realName}
            maxLength={48}
            autoFocus
            data-testid="petname-name-input"
          />
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">Photo</p>
            <div className="flex items-center gap-3">
              {previewUrl ? (
                <img src={previewUrl} alt="" className="w-12 h-12 rounded-full object-cover border border-border" data-testid="petname-photo-preview" />
              ) : (
                <span className="w-12 h-12 rounded-full border border-dashed border-border/60 flex items-center justify-center text-muted-foreground/40">
                  <ImagePlus className="w-4 h-4" />
                </span>
              )}
              <div className="flex flex-col gap-1">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => fileRef.current?.click()} data-testid="petname-photo-pick">
                  {previewUrl ? "Change photo" : "Upload photo"}
                </Button>
                {previewUrl && (
                  <button
                    type="button"
                    onClick={() => { setPickedBlob(null); setRemovePhoto(true); setPickedUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; }); }}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-foreground text-left"
                    data-testid="petname-photo-remove"
                  >
                    <X className="w-3 h-3" /> Remove photo
                  </button>
                )}
                {/* The honest trade, stated where the choice is made: photos
                    stay on THIS device (uploading one anywhere would break
                    "it never leaves your account"); name & icon still sync. */}
                <span className="text-[10px] text-muted-foreground/50">Stays on this device · metadata removed</span>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ""; }}
                data-testid="petname-photo-input"
              />
            </div>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">Icon</p>
            <div className="flex flex-wrap gap-1.5">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(emoji === e ? undefined : e)}
                  className={`w-8 h-8 rounded-lg text-base flex items-center justify-center border transition-colors ${
                    emoji === e ? "border-primary/60 bg-primary/15" : "border-border/40 hover:bg-muted/40"
                  }`}
                  aria-label={`Icon ${e}`}
                  aria-pressed={emoji === e}
                  data-testid={`petname-emoji-${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">Color</p>
            <div className="flex gap-1.5">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(color === c ? undefined : c)}
                  className={`w-7 h-7 rounded-full border-2 transition-transform ${
                    color === c ? "border-foreground scale-110" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Color ${c}`}
                  aria-pressed={color === c}
                  data-testid={`petname-color-${c.slice(1)}`}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            {hasExisting ? (
              <Button variant="ghost" size="sm" onClick={clear} className="text-muted-foreground" data-testid="petname-clear">
                Use real name
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} data-testid="petname-cancel">Cancel</Button>
              <Button size="sm" onClick={save} data-testid="petname-save">Save</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
