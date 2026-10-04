/**
 * A community's member inbox: whether members can contact the team, and the
 * kinds of request they can open (ticket templates) — like the request types
 * on a Discord or Slack support channel, but on Nostr.
 *
 * Kept on the community's feedback listing (the NIP-34 repo announcement,
 * kind 30617) the inbox already uses, so any NIP-34 app finds the inbox and
 * ours also reads the templates:
 *
 *   ["inbox", "on" | "off"]
 *   ["template", id, label, prompt, "private" | "public", kind, "on" | "off"]
 *
 * Writing keeps every other tag on the listing (a replaceable event replaces
 * the whole thing — publishing a trimmed copy would wipe what other apps put
 * there), and switching off says "off" rather than deleting it.
 *
 * Pure.
 */
import type { FeedbackType } from "./nip34-feedback";

export interface TicketTemplate {
  id: string;
  label: string;
  /** What to ask the member — shown as the hint in the message box. */
  prompt: string;
  visibility: "private" | "public";
  /** Which kind of ticket it files as (Problem, Idea, Question, Design). */
  kind: FeedbackType;
  enabled: boolean;
}

export interface InboxSettings {
  /** A feedback listing exists for this community. */
  exists: boolean;
  /** Members can contact the team. */
  on: boolean;
  templates: TicketTemplate[];
}

export const STARTER_TEMPLATES: TicketTemplate[] = [
  { id: "help", label: "Ask for help", prompt: "What do you need help with?", visibility: "private", kind: "question", enabled: true },
  { id: "problem", label: "Report a problem", prompt: "What went wrong, and what were you trying to do?", visibility: "private", kind: "bug", enabled: true },
  { id: "suggest", label: "Suggest something", prompt: "What would make this community better?", visibility: "public", kind: "idea", enabled: true },
  { id: "access", label: "Request access or a role", prompt: "What are you asking for, and why?", visibility: "private", kind: "question", enabled: true },
];

const KINDS: FeedbackType[] = ["bug", "idea", "ux", "question"];

export function readInboxSettings(repo: { tags: string[][] } | null): InboxSettings {
  if (!repo) return { exists: false, on: false, templates: STARTER_TEMPLATES };
  const inbox = repo.tags.find((t) => t[0] === "inbox")?.[1];
  const tagged = repo.tags.filter((t) => t[0] === "template");
  const templates: TicketTemplate[] = tagged
    .map(([, id, label, prompt, vis, kind, state]) => ({
      id: id ?? "",
      label: (label ?? "").trim(),
      prompt: prompt ?? "",
      visibility: vis === "public" ? "public" as const : "private" as const,
      kind: KINDS.includes(kind as FeedbackType) ? (kind as FeedbackType) : "question" as const,
      enabled: state !== "off",
    }))
    .filter((t) => t.id && t.label);
  return { exists: true, on: inbox !== "off", templates: tagged.length ? templates : STARTER_TEMPLATES };
}

const KIND_REPO = 30617;

/**
 * The listing to publish: every tag the current one has, in order, with the
 * inbox and template tags replaced; or, with none yet, a fresh one.
 */
export function writeInboxSettings(
  existing: { tags: string[][]; content?: string } | null,
  settings: { on: boolean; templates: TicketTemplate[] },
  base: { d: string; name: string; description: string; relay: string },
): { kind: number; created_at: number; tags: string[][]; content: string } {
  const kept = existing
    ? existing.tags.filter((t) => t[0] !== "inbox" && t[0] !== "template")
    : [["d", base.d], ["name", base.name], ["description", base.description], ["relays", base.relay], ["t", "feedback"]];
  const tags = [
    ...kept,
    ["inbox", settings.on ? "on" : "off"],
    ...settings.templates.map((t) => ["template", t.id, t.label.trim(), t.prompt.trim(), t.visibility, t.kind, t.enabled ? "on" : "off"]),
  ];
  return { kind: KIND_REPO, created_at: Math.floor(Date.now() / 1000), tags, content: existing?.content ?? "" };
}

/** The name of the request type a ticket was opened from, when the community still has it. */
export function templateLabelFor(ticket: { tags: string[][] }, templates: TicketTemplate[] | undefined): string | null {
  const id = ticket.tags.find((t) => t[0] === "template")?.[1];
  return (id && templates?.find((t) => t.id === id)?.label) || null;
}
