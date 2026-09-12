/**
 * The chat look, shared by group chats (Concord), Community rooms (NIP-29) and
 * DMs, so moving between them doesn't feel like three different apps.
 *
 * Violet stays reserved for active/selected, primary and focus (LIGHT_MODE.md).
 * Dark accents come from --brand: dark --primary is near-white, so an accent
 * painted with it reads as plain text.
 */

/** The room you're in: a solid violet pill in light; in dark, a deep violet fill with bright violet text. */
export const ACTIVE_ROOM = "bg-primary text-primary-foreground font-medium shadow-sm shadow-primary/25 dark:bg-brand/[0.16] dark:text-brand-strong dark:shadow-none dark:ring-1 dark:ring-inset dark:ring-brand/20";

/** A room with messages you haven't read. */
export const UNREAD_DOT = "w-2 h-2 rounded-full bg-brand shrink-0 shadow-[0_0_6px_hsl(var(--brand)/0.55)]";

/** The day, as a small chip between hairlines. */
export const DAY_CHIP = "h-5 px-2.5 inline-flex items-center rounded-full border border-border bg-card text-[10px] font-semibold uppercase tracking-wider text-muted-foreground tabular-nums whitespace-nowrap dark:border-white/[0.08] dark:bg-white/[0.03]";

/** Where unread begins: a solid tag at the end of a brand rule. Dark
 *  --primary-foreground is near-black, which is what reads on dark --brand. */
export const NEW_TAG = "h-4 px-1.5 inline-flex items-center rounded bg-brand text-[10px] font-bold uppercase tracking-wider text-primary-foreground";

/** One field holding attach, emoji and the text, lifting with a brand ring on
 *  focus. Call sites add the shape: a pill for one line, rounded-3xl for a
 *  field that grows. */
export const COMPOSER_FIELD = "border border-border bg-card shadow-[0_1px_2px_hsl(var(--foreground)/0.05)] transition-[border-color,box-shadow] focus-within:border-brand/50 focus-within:ring-[3px] focus-within:ring-brand/15 dark:border-white/[0.09] dark:bg-white/[0.03] dark:shadow-none";

/** A reaction you've made, and one you haven't. */
export const REACTION_ON = "border-brand/40 bg-brand/10 text-brand font-medium";
export const REACTION_OFF = "border-border/70 bg-muted/40 hover:bg-muted/80 hover:border-border text-foreground/75 dark:border-white/[0.08] dark:bg-white/[0.04] dark:hover:bg-white/[0.08]";

/** A message's action toolbar, and a tool inside it. */
export const MSG_TOOLBAR = "rounded-lg border border-border bg-popover p-0.5 shadow-[0_1px_2px_hsl(var(--foreground)/0.06),0_6px_16px_-6px_hsl(var(--foreground)/0.18)] dark:border-white/[0.08]";
export const MSG_TOOL = "rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors";
