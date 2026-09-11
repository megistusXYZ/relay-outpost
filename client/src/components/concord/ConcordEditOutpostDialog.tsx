/**
 * Edit a group chat's name, image, description and invite policy.
 *
 * Every metadata edition REPLACES the whole content object, so this form does
 * not just publish what it shows — it publishes what it shows OVER everything
 * else. It used to seed all four fields from the local record, which for anyone
 * but the creator is a join-time snapshot nothing ever refreshes: a link-joined
 * admin saw a blank Description for a group that had one, and fixing a typo in
 * the name republished that blank over everyone, along with the owner's invite
 * policy.
 *
 * Two rules follow, and the dialog exists to enforce both:
 *  - Display seeds from the FOLD, never over a field the user has touched.
 *  - Save sends only DIRTY fields; everything else is composed at publish time
 *    from the fold (see concord-metadata-edition.ts). Only the surface holding
 *    the controls knows which ones a human moved — a Switch rendered off from
 *    an absent record is indistinguishable, from below, from one turned off.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDialogKeyboardFit } from "@/hooks/use-dialog-keyboard-fit";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { publishEvent } from "@/lib/nostr";
import { useToast } from "@/hooks/use-toast";
import { editMetadata, postTimerNotices } from "@/lib/concord/concord-community";
import { disappearingTimer, timerSpan } from "@/lib/concord/concord-disappearing";
import type { CommunityMetadata } from "@/lib/concord/concord-events";
import { canPublishMetadata, type MetadataChanges, type MetadataHead } from "@/lib/concord/concord-metadata-edition";
import type { StoredCommunity } from "@/lib/concord/concord-keys";
import { RoomImagePicker } from "./RoomImagePicker";
import { parseCommunityImage, type CommunityImage } from "@/lib/concord/concord-image";

type Field = "name" | "icon" | "about" | "allowMemberInvites" | "messageExpiration";

/** The choices CORD-08 suggests: a day is the shortest, so clock skew never matters. */
const TIMER_CHOICES = [
  { seconds: 0, label: "Off" },
  { seconds: 86400, label: "1 day" },
  { seconds: 604800, label: "7 days" },
  { seconds: 2592000, label: "30 days" },
];

export function ConcordEditOutpostDialog({ open, onOpenChange, community, onCommunityChange, govMetadata, foldHead }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  community: StoredCommunity;
  onCommunityChange: (c: StoredCommunity) => void;
  /** Live folded metadata — the base every untouched field is published from. */
  govMetadata: CommunityMetadata | undefined;
  /** Live head of the vsk-0 chain, so an edit chains onto what the relays hold. */
  foldHead: MetadataHead | undefined;
}) {
  const { pubkey } = useNostrAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  // Mobile keyboard: top-anchor + cap to the visual viewport (see hook docs).
  const kbFit = useDialogKeyboardFit(open);

  // The fold goes BACKWARDS: useConcordGovernance clears every rumor map when
  // `community` changes identity (a rekey does), so govMetadata returns to
  // undefined mid-session. An emptied fold is a torn-down subscription, not a
  // deletion — falling back to the record on that signal is this exact bug
  // arriving while the dialog is open. Hold the last one we actually saw.
  const lastFolded = useRef<CommunityMetadata | undefined>(undefined);
  if (govMetadata) lastFolded.current = govMetadata;
  const folded = govMetadata ?? lastFolded.current;

  const [dirty, setDirty] = useState<Partial<Record<Field, true>>>({});
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [image, setImage] = useState<CommunityImage | null>(null);
  const [about, setAbout] = useState("");
  const [allowMemberInvites, setAllowMemberInvites] = useState(false);
  const [expiration, setExpiration] = useState(0);
  const touch = (f: Field) => setDirty((d) => (d[f] ? d : { ...d, [f]: true }));

  // Seeding is for DISPLAY only, and never reaches into a field the user has
  // touched. What gets published is composed at save time, so a fold landing
  // mid-edit updates what they can see without editing what they are typing.
  useEffect(() => {
    if (!open) { setDirty({}); return; }
    if (!dirty.name) setName(folded?.name ?? community.name);
    if (!dirty.icon) {
      setIcon(folded?.picture ?? community.icon ?? "");
      // The group's settings are the whole photo: no `icon` there, no encrypted photo.
      setImage((folded?.raw ? parseCommunityImage(folded.raw.icon) : community.iconImage) ?? null);
    }
    if (!dirty.about) setAbout(folded?.about ?? community.about ?? "");
    if (!dirty.allowMemberInvites) setAllowMemberInvites((folded?.allowMemberInvites ?? community.allowMemberInvites) === true);
    if (!dirty.messageExpiration) setExpiration(disappearingTimer(folded));
  }, [open, community, folded, dirty]);

  const ready = canPublishMetadata({ community, pubkey, govMetadata: folded, foldHead });

  const save = async () => {
    const signer = getGlobalSigner();
    if (!pubkey || !signer || !name.trim() || busy || !ready) return;

    const changes: MetadataChanges = {};
    if (dirty.name) changes.name = name.trim();
    if (dirty.icon) changes.image = image;          // null means removed, and stays removed
    if (dirty.about) changes.about = about.trim();
    if (dirty.allowMemberInvites) changes.allowMemberInvites = allowMemberInvites;
    if (dirty.messageExpiration) changes.messageExpiration = expiration;
    // Publishing an edition that changes nothing is not free: it is a full
    // replacement at a version that outranks the real head. A Save with nothing
    // dirty has to go on the wire as nothing.
    if (Object.keys(changes).length === 0) { onOpenChange(false); return; }

    setBusy(true);
    try {
      const relays = community.relays;
      const updated = await editMetadata(signer, pubkey, community, changes,
        { metadata: folded, head: foldHead },
        (e, r) => publishEvent(e, r), (e) => publishEvent(e, relays));
      onCommunityChange(updated);
      // A line in each room saying who changed the timer (CORD-08 §4). The
      // settings are the authority, so this never holds up the save.
      if (dirty.messageExpiration) void postTimerNotices(signer, pubkey, updated, expiration, (e, r) => publishEvent(e, r));
      toast({ title: "Group chat updated" });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Couldn't save", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className={cn("w-[calc(100vw-2rem)] max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto", kbFit.className)} style={kbFit.style} onFocusCapture={kbFit.onFocusCapture}>
        <DialogHeader>
          <DialogTitle className="text-base">Edit group chat</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground/70">Group photo</label>
            <RoomImagePicker
              image={image ?? undefined}
              picture={icon || undefined}
              onChange={(next) => { touch("icon"); setImage(next); if (!next) setIcon(""); }}
              fallback={name || "?"}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground/70">Name</label>
            <Input value={name} onChange={(e) => { touch("name"); setName(e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter") save(); }} data-testid="input-edit-outpost-name" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground/70">Description <span className="opacity-50">(optional)</span></label>
            <Textarea value={about} onChange={(e) => { touch("about"); setAbout(e.target.value); }} rows={3} maxLength={500} placeholder="What's this group chat about?" className="resize-none text-sm" data-testid="input-edit-outpost-about" />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/30 bg-muted/10 p-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">Let members invite</p>
              <p className="text-[11px] text-muted-foreground/60">Anyone can create invite links, not just admins.</p>
            </div>
            <Switch checked={allowMemberInvites} onCheckedChange={(v) => { touch("allowMemberInvites"); setAllowMemberInvites(v); }} data-testid="switch-member-invites" />
          </div>
          <div className="space-y-2 rounded-lg border border-border/30 bg-muted/10 p-2.5" data-testid="disappearing-setting">
            <div className="min-w-0">
              <p className="text-sm font-medium">Disappearing messages</p>
              <p className="text-[11px] text-muted-foreground/60">New messages disappear for everyone after this long. Anyone could still have saved a copy before then.</p>
            </div>
            <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Disappearing messages">
              {TIMER_CHOICES.map((c) => (
                <button
                  key={c.seconds}
                  type="button"
                  role="radio"
                  aria-checked={expiration === c.seconds}
                  onClick={() => { touch("messageExpiration"); setExpiration(c.seconds); }}
                  className={cn("h-10 md:h-8 rounded-md text-xs font-medium transition-colors",
                    expiration === c.seconds ? "bg-primary text-primary-foreground" : "bg-background/60 text-muted-foreground hover:bg-muted/40")}
                  data-testid={`disappearing-${c.seconds}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {expiration > 0 && !TIMER_CHOICES.some((c) => c.seconds === expiration) && (
              <p className="text-[11px] text-muted-foreground/60">Set elsewhere to {timerSpan(expiration)}.</p>
            )}
          </div>
          {/* Say WHY it is disabled. A dead Save button with no reason is its own
              defect, and "we don't know this group's current details" is a real
              thing that happens — to anyone who joined after a rekey, forever. */}
          {!ready && (
            <p className="text-[11px] text-muted-foreground/60" data-testid="edit-outpost-not-ready">
              Waiting for this group's current details. Saving before they arrive would publish over whatever they turn out to be.
            </p>
          )}
          <Button onClick={save} disabled={!name.trim() || busy || !ready} className="w-full" data-testid="button-save-outpost">
            {busy ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Saving…</> : "Save changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
