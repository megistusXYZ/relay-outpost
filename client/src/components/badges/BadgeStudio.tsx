/**
 * Create or edit a badge (owner, 2026-10-06 — badges-plan, step 2): start
 * from a template, shape it with a few plain controls, and see it exactly as
 * people will — on a profile, beside a name, and in the card they receive —
 * before publishing. The preview and the published picture are one drawing
 * (lib/badge-design.tsx badgeSvg → lib/badge-render.ts).
 */
import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Upload, Award } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { uploadMedia } from "@/lib/media-upload";
import { createBadgeDefinition, type BadgeDefinition } from "@/lib/nip58-badges";
import {
  BADGE_TEMPLATES, BADGE_SHAPES, BADGE_COLOURS, BADGE_SYMBOLS, BADGE_ICONS,
  type BadgeDesign, type BadgeColour, type BadgeShape,
} from "@/lib/badge-design";
import { badgeDataUrl, renderBadgePng } from "@/lib/badge-render";

const SHAPE_LABEL: Record<BadgeShape, string> = { circle: "Circle", shield: "Shield", star: "Star", hexagon: "Hexagon" };

/** What Edit reopens: the designer's settings when the badge was made here. */
function designOf(def: BadgeDefinition): BadgeDesign | null {
  if (!def.design) return null;
  try {
    const d = JSON.parse(def.design) as Pick<BadgeDesign, "shape" | "colour" | "symbol">;
    if (!BADGE_SHAPES.includes(d.shape) || !(d.colour in BADGE_COLOURS) || !d.symbol) return null;
    return { name: def.name, description: def.description, shape: d.shape, colour: d.colour, symbol: d.symbol };
  } catch {
    return null;
  }
}

function Picture({ src, size, label }: { src: string; size: number; label?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <span className="flex shrink-0 items-center justify-center rounded-lg bg-brand/10" style={{ width: size, height: size }}>
        <Award className="text-brand" style={{ width: size * 0.5, height: size * 0.5 }} aria-hidden />
      </span>
    );
  }
  return <img src={src} alt={label ?? ""} width={size} height={size} className="shrink-0 object-contain" style={{ width: size, height: size }} onError={() => setBroken(true)} />;
}

export function BadgeStudio({ editing, startTemplate, onDone, onCancel }: {
  /** Edit this badge instead of making a new one. */
  editing?: BadgeDefinition;
  /** Open straight into a template (e.g. "thanks" from an empty page). */
  startTemplate?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { signer } = useNostrAuth();
  const { toast } = useToast();
  const initial = useMemo(() => {
    if (editing) {
      const d = designOf(editing);
      return { design: d ?? { ...BADGE_TEMPLATES[BADGE_TEMPLATES.length - 1].design, name: editing.name, description: editing.description }, own: d ? "" : editing.image };
    }
    const t = BADGE_TEMPLATES.find((x) => x.id === startTemplate);
    return t ? { design: { ...t.design }, own: "" } : null;
  }, [editing, startTemplate]);

  const [design, setDesign] = useState<BadgeDesign | null>(initial?.design ?? null);
  const [ownPicture, setOwnPicture] = useState(initial?.own ?? "");
  const [emoji, setEmoji] = useState(initial?.design.symbol.kind === "emoji" ? initial.design.symbol.char : "");
  const [status, setStatus] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Template gallery ────────────────────────────────────────────────
  if (!design) {
    return (
      <section className="space-y-3" data-testid="badge-studio">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Start from a template</h2>
          <Button variant="ghost" className="min-h-[44px]" onClick={onCancel}>Cancel</Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {BADGE_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setDesign({ ...t.design }); setEmoji(t.design.symbol.kind === "emoji" ? t.design.symbol.char : ""); }}
              className="flex min-h-[44px] items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/40"
              data-testid={`badge-template-${t.id}`}
            >
              <Picture src={badgeDataUrl(t.design)} size={40} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{t.design.name || "Start from blank"}</span>
                {t.design.description && <span className="block truncate text-xs text-muted-foreground">{t.design.description}</span>}
              </span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  // ── Designer ────────────────────────────────────────────────────────
  const set = (patch: Partial<BadgeDesign>) => setDesign({ ...design, ...patch });
  const picture = ownPicture || badgeDataUrl(design);
  const name = design.name.trim();
  const busy = status !== "";

  const uploadOwn = async (file: File) => {
    setStatus("Uploading your picture…");
    try {
      const r = await uploadMedia(file, undefined, signer);
      if (r.url) setOwnPicture(r.url);
      else toast({ title: "Couldn't upload that picture", description: "Try again, or use the designer.", variant: "destructive" });
    } catch {
      toast({ title: "Couldn't upload that picture", description: "Try again, or use the designer.", variant: "destructive" });
    } finally {
      setStatus("");
    }
  };

  const publish = async () => {
    if (!signer || !name) return;
    try {
      let image = ownPicture, thumb = "", imageSize: string | undefined, thumbSize: string | undefined, saved: string | undefined;
      if (!ownPicture) {
        setStatus("Drawing your badge…");
        const [big, small] = await Promise.all([renderBadgePng(design, 1024), renderBadgePng(design, 256)]);
        setStatus("Uploading…");
        const up = async (b: Blob, n: string) => (await uploadMedia(new File([b], n, { type: "image/png" }), undefined, signer)).url;
        [image, thumb] = await Promise.all([up(big, "badge.png"), up(small, "badge-small.png")]);
        if (!image) throw new Error("upload");
        imageSize = "1024x1024"; thumbSize = "256x256";
        saved = JSON.stringify({ shape: design.shape, colour: design.colour, symbol: design.symbol });
      }
      setStatus(editing ? "Saving…" : "Publishing…");
      const ok = await createBadgeDefinition(signer, {
        id: editing?.dTag, name, description: design.description.trim(),
        image, imageSize, thumb: thumb || undefined, thumbSize: thumb ? thumbSize : undefined, design: saved,
      });
      if (!ok) throw new Error("publish");
      toast({ title: editing ? "Badge updated" : "Badge created", description: editing ? "Everyone who has it sees the change." : `"${name}" is ready to give.` });
      onDone();
    } catch {
      toast({ title: editing ? "Couldn't save the badge" : "Couldn't create the badge", description: "Nothing was published. Try again in a moment.", variant: "destructive" });
    } finally {
      setStatus("");
    }
  };

  return (
    <section className="space-y-4" data-testid="badge-studio">
      <div className="flex items-center justify-between gap-3">
        {editing ? <h2 className="text-base font-semibold">Edit badge</h2> : (
          <button type="button" onClick={() => setDesign(null)} className="-ml-2 flex min-h-[44px] items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground" data-testid="button-badge-templates">
            <ArrowLeft className="h-4 w-4" /> Templates
          </button>
        )}
        <Button variant="ghost" className="min-h-[44px]" onClick={onCancel}>Cancel</Button>
      </div>

      <div className="grid gap-5 md:grid-cols-[1fr_260px]">
        {/* Controls */}
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Name</span>
            <Input className="min-h-[44px]" value={design.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Founding member" data-testid="input-badge-name" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">What it's for <span className="font-normal text-muted-foreground">(optional)</span></span>
            <Input className="min-h-[44px]" value={design.description} maxLength={140} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Here from day one." data-testid="input-badge-description" />
          </label>

          {ownPicture ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
              <p className="flex-1 text-sm">Using your own picture.</p>
              <Button variant="outline" className="min-h-[44px]" onClick={() => setOwnPicture("")} data-testid="button-badge-use-designer">Use the designer instead</Button>
            </div>
          ) : (
            <>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">Shape</legend>
                <div className="flex flex-wrap gap-2">
                  {BADGE_SHAPES.map((s) => (
                    <button key={s} type="button" aria-pressed={design.shape === s} aria-label={SHAPE_LABEL[s]} title={SHAPE_LABEL[s]} onClick={() => set({ shape: s })}
                      className={`flex h-11 w-11 items-center justify-center rounded-lg border ${design.shape === s ? "border-primary ring-2 ring-primary/40" : "border-border hover:bg-muted/40"}`} data-testid={`badge-shape-${s}`}>
                      <Picture src={badgeDataUrl({ ...design, shape: s })} size={32} />
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">Colour</legend>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(BADGE_COLOURS) as BadgeColour[]).map((c) => (
                    <button key={c} type="button" aria-pressed={design.colour === c} aria-label={BADGE_COLOURS[c].label} title={BADGE_COLOURS[c].label} onClick={() => set({ colour: c })}
                      className={`h-11 w-11 rounded-full border-2 ${design.colour === c ? "border-foreground" : "border-transparent"}`}
                      style={{ background: `linear-gradient(${BADGE_COLOURS[c].light}, ${BADGE_COLOURS[c].dark})` }} data-testid={`badge-colour-${c}`} />
                  ))}
                </div>
              </fieldset>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">Symbol</legend>
                <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
                  {BADGE_SYMBOLS.map((id) => {
                    const Icon = BADGE_ICONS[id];
                    const on = design.symbol.kind === "icon" && design.symbol.id === id;
                    return (
                      <button key={id} type="button" aria-pressed={on} aria-label={id.replace("-", " ")} onClick={() => { set({ symbol: { kind: "icon", id } }); setEmoji(""); }}
                        className={`flex h-11 items-center justify-center rounded-lg border ${on ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"}`} data-testid={`badge-symbol-${id}`}>
                        <Icon className="h-5 w-5" aria-hidden />
                      </button>
                    );
                  })}
                </div>
                <label className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
                  Or an emoji
                  <Input value={emoji} maxLength={8} className="min-h-[44px] w-20 text-center text-lg" aria-label="Emoji"
                    onChange={(e) => { const v = e.target.value.trim(); setEmoji(v); if (v) set({ symbol: { kind: "emoji", char: v } }); }} data-testid="input-badge-emoji" />
                </label>
              </fieldset>
            </>
          )}

          {!ownPicture && (
            <>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadOwn(f); e.target.value = ""; }} />
              <Button variant="outline" className="min-h-[44px] gap-2" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="button-badge-own-picture">
                <Upload className="h-4 w-4" /> Use your own picture
              </Button>
            </>
          )}
        </div>

        {/* Live preview: where people will see it */}
        <aside className="space-y-3" aria-label="Preview" data-testid="badge-preview">
          <p className="text-sm font-medium">How people will see it</p>
          <div className="space-y-1 rounded-lg border border-border p-3" data-testid="badge-preview-profile">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">On a profile</p>
            <div className="flex items-center gap-3">
              <Picture src={picture} size={56} label={name} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{name || "Your badge"}</p>
                {design.description && <p className="line-clamp-2 text-xs text-muted-foreground">{design.description}</p>}
              </div>
            </div>
          </div>
          <div className="space-y-1 rounded-lg border border-border p-3" data-testid="badge-preview-name">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Beside a name</p>
            <p className="flex items-center gap-1.5 text-sm font-medium">Sam Rivera <Picture src={picture} size={16} label={name} /></p>
          </div>
          <div className="space-y-1 rounded-lg border border-brand/20 bg-brand/[0.05] p-3" data-testid="badge-preview-received">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">When someone receives it</p>
            <div className="flex items-center gap-3">
              <Picture src={picture} size={44} label={name} />
              <p className="text-sm">Sam got <span className="font-semibold">{name || "a badge"}</span> from you</p>
            </div>
          </div>
          <Button className="min-h-[44px] w-full" disabled={!name || busy || !signer} onClick={() => void publish()} data-testid="button-publish-badge">
            {status || (editing ? "Save changes" : "Publish badge")}
          </Button>
          {!name && <p className="text-xs text-muted-foreground">Give it a name to publish.</p>}
        </aside>
      </div>
    </section>
  );
}
