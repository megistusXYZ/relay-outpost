/**
 * Create a poll in a group chat room, written the way Armada writes one
 * (CORD.md "Polls"), so it shows and counts the same in both apps. A sheet on
 * phones, a dialog on desktop (ResponsiveFormPanel; Back closes it).
 */
import { useState } from "react";
import { Plus, X, Loader2 } from "lucide-react";
import { ResponsiveFormPanel } from "@/components/ui/responsive-form-panel";
import { Switch } from "@/components/ui/switch";
import type { PollOption, PollType } from "@/lib/concord/concord-polls";

/** Armada's choices, 7 days its default. */
const DURATIONS = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "7 days" },
  { days: 0, label: "No end" },
];
const MAX_OPTIONS = 10;
/** Any non-empty id reads in Armada's parsePoll; short and random keeps them distinct. */
const newId = () => Math.random().toString(36).slice(2, 8);
const blank = (): PollOption[] => [{ id: newId(), label: "" }, { id: newId(), label: "" }];

const FIELD = "w-full min-w-0 h-11 md:h-10 rounded-lg border border-border bg-card px-3 text-base md:text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:border-brand/50 focus:ring-[3px] focus:ring-brand/15 dark:border-white/[0.09] dark:bg-white/[0.03]";

export function ConcordPollComposer({ open, onOpenChange, onCreate }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Send it; false when no relay took it (the caller says so and keeps the draft). */
  onCreate: (poll: { question: string; options: PollOption[]; pollType: PollType; endsAt: number | undefined }) => Promise<boolean>;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<PollOption[]>(blank);
  const [multiple, setMultiple] = useState(false);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);

  const filled = options.map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label);
  const distinct = new Set(filled.map((o) => o.label.toLowerCase())).size === filled.length;
  const ready = question.trim().length > 0 && filled.length >= 2 && distinct && !busy;

  const setLabel = (id: string, label: string) => setOptions((prev) => prev.map((o) => (o.id === id ? { ...o, label } : o)));
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    const ok = await onCreate({
      question: question.trim(),
      options: filled,
      pollType: multiple ? "multiplechoice" : "singlechoice",
      endsAt: days > 0 ? Math.floor(Date.now() / 1000) + days * 86_400 : undefined,
    });
    setBusy(false);
    if (ok) {
      setQuestion(""); setOptions(blank()); setMultiple(false); setDays(7);
      onOpenChange(false);
    }
  };

  return (
    <ResponsiveFormPanel
      open={open}
      onOpenChange={onOpenChange}
      title="New poll"
      description="Everyone in this room can vote, in Relay Outpost or Armada."
      footer={
        <button
          type="button"
          onClick={submit}
          disabled={!ready}
          className="inline-flex h-11 md:h-10 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          data-testid="concord-poll-submit"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create poll"}
        </button>
      }
    >
      <div className="space-y-4" data-testid="concord-poll-composer">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Question</span>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} placeholder="Ask something" className={FIELD} data-testid="concord-poll-question" />
        </label>

        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Options</span>
          {options.map((o, i) => (
            <div key={o.id} className="flex items-center gap-2">
              <input value={o.label} onChange={(e) => setLabel(o.id, e.target.value)} maxLength={100} placeholder={`Option ${i + 1}`} className={FIELD} data-testid="concord-poll-option-input" />
              {options.length > 2 && (
                <button type="button" onClick={() => setOptions((prev) => prev.filter((x) => x.id !== o.id))} aria-label={`Remove option ${i + 1}`}
                  className="flex h-11 w-11 md:h-10 md:w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          {options.length < MAX_OPTIONS && (
            <button type="button" onClick={() => setOptions((prev) => [...prev, { id: newId(), label: "" }])}
              className="inline-flex min-h-11 md:min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-brand hover:bg-brand/10 transition-colors" data-testid="concord-poll-add-option">
              <Plus className="h-4 w-4" /> Add option
            </button>
          )}
          {!distinct && <p className="text-xs text-destructive">Two options say the same thing.</p>}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 dark:border-white/[0.09]">
          <span className="text-sm">Let people pick more than one</span>
          <Switch checked={multiple} onCheckedChange={setMultiple} data-testid="concord-poll-multiple" />
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Voting closes</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Voting closes">
            {DURATIONS.map((d) => (
              <button key={d.days} type="button" role="radio" aria-checked={days === d.days} onClick={() => setDays(d.days)}
                className={`min-h-11 md:min-h-9 rounded-full border px-3.5 text-xs font-medium transition-colors ${days === d.days ? "border-brand/50 bg-brand/10 text-brand" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground dark:border-white/[0.09]"}`}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </ResponsiveFormPanel>
  );
}
