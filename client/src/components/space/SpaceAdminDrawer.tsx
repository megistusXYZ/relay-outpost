import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useIsMobile } from "@/hooks/use-mobile";
import { visibleSections, type SpaceAdminSectionDef } from "./space-admin-sections";
import type { SpaceCapabilities, SpaceBackend } from "@/lib/space-admin";

/**
 * One admin door per space, for both governance models.
 *
 * The actions behind it all existed already — sendPutUser/sendRemoveUser/
 * sendEditMetadata on the relay side, the governance fold on the Concord side.
 * What did not exist was one place to go: they were scattered across menus, and
 * the complete set lived only in the Relay Ops console, a separate page on a
 * different mental model. This adds ZERO governance calls.
 *
 * The organizing rule, one sentence, both backends: the ⋯ menu is "me in this
 * space" (members, mute, leave, invite — things every member does), and this
 * drawer is "this space" (authority). Today they are mixed, and that mixing is
 * the actual confusion.
 *
 * Content is supplied by the host via `renderSection`, not built here. The two
 * backends' sections are genuinely different components — ConcordMembers versus
 * a relay roster — and pulling both into this file would make the shell know
 * about every dialog in the app. The shell owns the frame, the header, the
 * ready-gate and the gating; the host owns what goes inside.
 */
export function SpaceAdminDrawer({
  open,
  onOpenChange,
  backend,
  caps,
  ready,
  spaceName,
  spaceAvatar,
  standingLine,
  renderSection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backend: SpaceBackend;
  caps: SpaceCapabilities | null;
  /**
   * Has authority actually been resolved?
   *
   * Concord: `isOwner || !!myMember` — NOT "the roster is non-empty". computeRoster
   * seats the owner unconditionally with no join rumor, so a roster has a member
   * on the very first render, before any relay data has arrived. Gating on its
   * length reports "resolved" while a non-owner admin's own member record is
   * still undefined, which is precisely the false claim below.
   * NIP-29: the admin list came back (not null).
   *
   * Load-bearing, because concordCapabilities(null) returns NO_CAPABILITIES by
   * design — "absence of evidence is not authority". Without this flag the
   * drawer cannot tell "still loading" from "nothing for you", and would flash
   * an empty state at an owner every time it opens.
   */
  ready: boolean;
  spaceName: string;
  spaceAvatar?: string;
  /**
   * What this person holds, in one sentence — "You're the owner", "You're an
   * admin here", or an admin's limit spelled out. This is what buys the right to
   * make sections simply absent: say once what you have, rather than greying out
   * five controls to imply what you don't.
   */
  standingLine: string;
  renderSection: (section: SpaceAdminSectionDef) => ReactNode;
}) {
  const isMobile = useIsMobile();
  const sections = visibleSections(caps, backend);

  // Named rather than inlined: one line, and it is the difference between "this
  // is a relay's room and the relay decides" and "this is encrypted and nobody
  // else holds the keys". A moderator's expectations about what their actions
  // can do should not depend on remembering which kind of space they opened.
  const backendLine =
    backend === "concord"
      ? "Encrypted group chat · no relay required"
      : "Room on a relay · the relay has the final say";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        // Both the panel AND its scrim must clear the chat surfaces: the Concord
        // mobile overlay (z-[55]), the channel room frame (z-[60]) and dropdowns
        // (z-[80]). Leaving the scrim at its default z-50 is what makes a sheet
        // paint underneath its own backdrop and read as frozen — hence the
        // overlayClassName escape hatch this needed added to sheet.tsx.
        //
        // Deliberately BELOW the z-[210] ResponsiveFormPanel layer, so any
        // sub-panel launched from in here stacks on top of the drawer rather
        // than racing it.
        overlayClassName="z-[200]"
        className="glass-dialog-card border-primary/15 z-[200] !gap-0 !p-0 flex flex-col h-[85dvh] rounded-t-2xl sm:h-full sm:rounded-none sm:max-w-md"
        data-testid="space-admin-drawer"
      >
        <SheetHeader className="shrink-0 space-y-0 px-4 pt-4 pb-3 border-b border-border/30 text-left">
          <div className="flex items-center gap-2.5">
            <Avatar className="w-9 h-9 shrink-0 border border-border/40">
              <AvatarImage src={spaceAvatar} alt="" />
              <AvatarFallback className="bg-brand/10 text-brand text-[11px] font-semibold">
                {spaceName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-base truncate">Manage</SheetTitle>
              <SheetDescription className="text-[11px] truncate">{spaceName}</SheetDescription>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground/60">{backendLine}</p>
          {ready && <p className="mt-0.5 text-[11px] text-foreground/70">{standingLine}</p>}
        </SheetHeader>

        {/* `!p-0` above opts out of the bottom sheet's baked-in safe-area padding,
            so the scroll body re-adds it here. This is the ONLY place it should
            reappear — a second one double-pads the phone. */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          {!ready ? (
            // Quiet skeletons, never "you have no permissions". Authority has not
            // been resolved yet, and an empty state here would be a false claim
            // shown to the owner for as long as the fold takes.
            <div className="space-y-3" data-testid="space-admin-loading">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 rounded-xl border border-border/30 bg-muted/10 animate-pulse" />
              ))}
            </div>
          ) : sections.length === 0 ? (
            // Genuinely nothing — the ⋯ item should not have offered this. Kept
            // as an honest terminal state rather than an empty panel.
            <p className="text-xs text-muted-foreground/60" data-testid="space-admin-none">
              You don't run this space.
            </p>
          ) : (
            sections.map((s) => <div key={s.id}>{renderSection(s)}</div>)
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
