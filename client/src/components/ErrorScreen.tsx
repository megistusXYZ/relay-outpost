import type { CSSProperties, ReactNode } from "react";
import { Link } from "wouter";
import { BrandMark } from "@/components/BrandMark";

/**
 * The one screen for "this didn't work": a missing page, a link we can't read,
 * a part of the app that crashed, no connection, a relay that wouldn't answer,
 * a door that isn't yours. Every error surface in the app renders through it,
 * so they all look and read the same way.
 *
 * The picture is the launch screen's: the R mark inside a ring of eight relay
 * dots (client/index.html). The dots say what happened without words:
 *   not-found    one dot hollow (a signal that didn't arrive)
 *   link         every dot hollow (nothing to connect to)
 *   offline,
 *   unreachable  every dot unlit
 *   broken       the mark itself goes quiet
 *   denied       the ring is lit; it just isn't yours
 *
 * Calm by design: static, sentence-case title, one sentence, one filled
 * action and at most a quiet text link. Theme tokens only, so light, dark and
 * black all work. The only motion is a short fade, and only when the reader
 * hasn't asked for reduced motion.
 */
export type ErrorKind = "not-found" | "broken" | "offline" | "unreachable" | "denied" | "link";
export type ErrorLayout = "page" | "section" | "inline";

export interface ErrorAction {
  label: ReactNode;
  /** In-app path (rendered as a router link) or an absolute URL. */
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Leading icon, decorative. */
  icon?: ReactNode;
  testId?: string;
}

export interface ErrorScreenProps {
  kind: ErrorKind;
  title: ReactNode;
  body?: ReactNode;
  primary?: ErrorAction;
  /** Quiet text links under the primary action. */
  secondary?: ErrorAction | ErrorAction[];
  /** Raw error text, kept behind a "Details" disclosure for screenshots. */
  detail?: string | null;
  layout?: ErrorLayout;
  /** Extra content between the sentence and the actions (a context note). */
  children?: ReactNode;
  testId?: string;
  titleTestId?: string;
  className?: string;
}

const DOTS = 8;
/** Which dot stays hollow on "not-found": upper right, where the eye lands. */
const HOLLOW_DOT = 1;

type DotState = "lit" | "unlit" | "hollow";

export function dotStates(kind: ErrorKind): DotState[] {
  return Array.from({ length: DOTS }, (_, i): DotState => {
    switch (kind) {
      case "not-found":
        return i === HOLLOW_DOT ? "hollow" : "lit";
      case "link":
        return "hollow";
      case "denied":
        return "lit";
      default:
        return "unlit";
    }
  });
}

const DOT_CLASS: Record<DotState, string> = {
  lit: "bg-brand/70",
  unlit: "bg-muted-foreground/25",
  hollow: "border-[1.5px] border-brand/70 bg-transparent",
};

const SIZES = {
  page: { stage: 112, radius: 50, mark: "w-11 h-11", dot: 6 },
  section: { stage: 96, radius: 42, mark: "w-9 h-9", dot: 6 },
  inline: { stage: 56, radius: 24, mark: "w-5 h-5", dot: 4 },
} as const;

function SignalRing({ kind, layout }: { kind: ErrorKind; layout: ErrorLayout }) {
  const size = SIZES[layout];
  const states = dotStates(kind);
  const markTone = kind === "broken" ? "text-muted-foreground/70" : "text-brand";
  return (
    <div
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: size.stage, height: size.stage }}
      aria-hidden="true"
      data-error-kind={kind}
    >
      {/* Soft brand glow behind the mark, like the launch screen's. */}
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(closest-side,hsl(var(--brand)/0.16),transparent)]" />
      {states.map((state, i) => {
        const style: CSSProperties = {
          width: size.dot,
          height: size.dot,
          marginLeft: -size.dot / 2,
          marginTop: -size.dot / 2,
          transform: `rotate(${(i * 360) / DOTS}deg) translateY(-${size.radius}px)`,
        };
        return (
          <i
            key={i}
            className={`absolute left-1/2 top-1/2 rounded-full ${DOT_CLASS[state]}`}
            style={style}
            data-dot={state}
          />
        );
      })}
      <BrandMark className={`relative ${size.mark} ${markTone}`} />
    </div>
  );
}

const PRIMARY_CLASS =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-brand px-6 text-[15px] font-semibold text-background transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-default disabled:opacity-60";
const PRIMARY_INLINE_CLASS =
  "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full bg-brand px-5 text-sm font-semibold text-background transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-default disabled:opacity-60";
const SECONDARY_CLASS =
  "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full px-4 text-[15px] font-medium text-brand underline-offset-4 transition-colors hover:text-brand-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60";

function isExternal(href: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

function ActionControl({ action, className }: { action: ErrorAction; className: string }) {
  const content = (
    <>
      {action.icon}
      {action.label}
    </>
  );
  if (action.href && !action.disabled) {
    if (isExternal(action.href)) {
      return (
        <a href={action.href} className={className} onClick={action.onClick} data-testid={action.testId}>
          {content}
        </a>
      );
    }
    return (
      <Link href={action.href} className={className} onClick={action.onClick} data-testid={action.testId}>
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={action.disabled}
      className={className}
      data-testid={action.testId}
    >
      {content}
    </button>
  );
}

function Details({ detail, compact }: { detail: string; compact: boolean }) {
  return (
    <details className={`group w-full ${compact ? "max-w-[32ch]" : "max-w-[40ch]"} text-left`}>
      <summary className="mx-auto flex min-h-[44px] w-fit cursor-pointer list-none items-center gap-1 px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        Details
        <span className="inline-block transition-transform group-open:rotate-90" aria-hidden="true">›</span>
      </summary>
      <code className="mt-1 block max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
        {detail}
      </code>
    </details>
  );
}

const LAYOUT_CLASS: Record<ErrorLayout, string> = {
  page:
    "min-h-[70vh] px-4 pt-12 pb-[max(3rem,env(safe-area-inset-bottom))] gap-6",
  section: "min-h-[50vh] px-4 py-10 gap-5",
  inline: "rounded-2xl border border-border bg-card px-4 py-6 gap-3",
};

export function ErrorScreen({
  kind,
  title,
  body,
  primary,
  secondary,
  detail,
  layout = "page",
  children,
  testId,
  titleTestId,
  className,
}: ErrorScreenProps) {
  const inline = layout === "inline";
  const secondaries = secondary ? (Array.isArray(secondary) ? secondary : [secondary]) : [];
  const titleClass = inline
    ? "text-[15px] font-semibold leading-snug text-foreground [font-family:var(--font-display)]"
    : layout === "page"
      ? "text-[22px] sm:text-[28px] font-semibold leading-tight tracking-tight text-foreground [font-family:var(--font-display)]"
      : "text-[20px] sm:text-[24px] font-semibold leading-tight tracking-tight text-foreground [font-family:var(--font-display)]";
  const bodyClass = inline
    ? "max-w-[36ch] text-sm leading-relaxed text-muted-foreground"
    : "max-w-[36ch] text-[15px] leading-relaxed text-muted-foreground";
  const Heading = layout === "page" ? "h1" : layout === "section" ? "h2" : "p";

  return (
    <div
      role={kind === "broken" ? "alert" : undefined}
      className={`relative isolate flex w-full min-w-0 flex-col items-center justify-center text-center motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500 ${LAYOUT_CLASS[layout]} ${className ?? ""}`}
      data-testid={testId}
      data-error-screen={kind}
    >
      {layout === "page" && (
        // The maintenance page's top glow: a quiet brand wash, never a colour block.
        <div
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(70%_100%_at_50%_0%,hsl(var(--brand)/0.12),transparent_72%)]"
          aria-hidden="true"
        />
      )}
      <SignalRing kind={kind} layout={layout} />
      <div className={`flex flex-col items-center ${inline ? "gap-1" : "gap-2"}`}>
        <Heading className={titleClass} data-testid={titleTestId}>
          {title}
        </Heading>
        {body && <p className={bodyClass}>{body}</p>}
      </div>
      {children}
      {(primary || secondaries.length > 0) && (
        <div className={`flex flex-col items-center ${inline ? "gap-1" : "gap-2"}`}>
          {primary && <ActionControl action={primary} className={inline ? PRIMARY_INLINE_CLASS : PRIMARY_CLASS} />}
          {secondaries.length > 0 && (
            <div className="flex flex-wrap items-center justify-center">
              {secondaries.map((a, i) => (
                <ActionControl key={i} action={a} className={SECONDARY_CLASS} />
              ))}
            </div>
          )}
        </div>
      )}
      {detail && <Details detail={detail} compact={inline} />}
    </div>
  );
}

export default ErrorScreen;
