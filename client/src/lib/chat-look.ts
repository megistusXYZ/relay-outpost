/**
 * The chat look, shared by group chats (Concord), Community rooms (NIP-29) and
 * DMs, so moving between them doesn't feel like three different apps.
 *
 * Outpost brand (2026-11-16): selection is ink (filled foreground), Ember is
 * kept for actions, links, focus and status (unread dot, the New rule).
 */

/** The room you're in: a filled ink pill, both themes. */
export const ACTIVE_ROOM = "bg-foreground text-background font-medium";

/** A room with messages you haven't read. */
export const UNREAD_DOT = "w-2 h-2 rounded-full bg-brand shrink-0";

/** The day, as a small chip between hairlines. */
export const DAY_CHIP = "h-6 px-3 inline-flex items-center rounded-full border border-border/60 bg-card text-[12px] font-medium text-muted-foreground tabular-nums whitespace-nowrap";

/** Where unread begins: the status word "New" at the end of an Ember rule (a word, not a pill). */
export const NEW_TAG = "text-[12px] font-semibold text-brand";

/** One field holding attach, emoji and the text, lifting with a quiet ink ring on
 *  focus. Call sites add the shape: a pill for one line, rounded-3xl for a
 *  field that grows. */
export const COMPOSER_FIELD = "border border-border bg-card shadow-[0_1px_2px_hsl(var(--foreground)/0.05)] transition-[border-color,box-shadow] focus-within:border-foreground/30 focus-within:ring-[3px] focus-within:ring-foreground/[0.06] dark:border-white/[0.09] dark:bg-white/[0.03] dark:shadow-none";

/** A reaction you've made, and one you haven't. */
export const REACTION_ON = "border-foreground/40 bg-foreground/[0.08] text-foreground font-medium";
export const REACTION_OFF = "border-border/70 bg-muted/40 hover:bg-muted/80 hover:border-border text-foreground/75 dark:border-white/[0.08] dark:bg-white/[0.04] dark:hover:bg-white/[0.08]";

/** A message's action toolbar, and a tool inside it. */
export const MSG_TOOLBAR = "rounded-lg border border-border bg-popover p-0.5 shadow-[0_1px_2px_hsl(var(--foreground)/0.06),0_6px_16px_-6px_hsl(var(--foreground)/0.18)] dark:border-white/[0.08]";
export const MSG_TOOL = "rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors";
