import { Fragment } from "react";
import { MoreHorizontal, MoreVertical, Share } from "lucide-react";
import { stepText, type InstallGuide, type InstallIcon } from "@/lib/install-guide";

const ICONS: Record<InstallIcon, typeof Share> = { more: MoreHorizontal, share: Share, menu: MoreVertical };
const SPOKEN: Record<InstallIcon, string> = { more: "the More button (•••)", share: "Share", menu: "the menu button (⋮)" };

/** One step's words, with `{more}` / `{share}` / `{menu}` drawn as the button the person will look for. */
function StepWords({ text }: { text: string }) {
  const parts = text.split(/(\{(?:more|share|menu)\})/);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\{(more|share|menu)\}$/.exec(part);
        if (!m) return <Fragment key={i}>{part}</Fragment>;
        const key = m[1] as InstallIcon;
        const Icon = ICONS[key];
        return (
          <span key={i} className="inline-flex items-center gap-0.5 align-[-2px] font-medium" role="img" aria-label={SPOKEN[key]}>
            <Icon className="w-3.5 h-3.5" aria-hidden />
            {key === "share" && <span aria-hidden>Share</span>}
          </span>
        );
      })}
    </>
  );
}

/** The numbered install steps for this device (lib/install-guide.ts). */
export function InstallSteps({ guide, className = "" }: { guide: InstallGuide; className?: string }) {
  if (guide.steps.length === 0) return null;
  return (
    <div className={className} data-testid="install-steps">
      <ol className="space-y-1.5 text-[13px] leading-snug">
        {guide.steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2" title={stepText(step)}>
            <span className="w-4 shrink-0 text-right tabular-nums opacity-60">{i + 1}.</span>
            <span><StepWords text={step.text} /></span>
          </li>
        ))}
      </ol>
      {guide.note && <p className="mt-2 text-xs opacity-70">{guide.note}</p>}
    </div>
  );
}
