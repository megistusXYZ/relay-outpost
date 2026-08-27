import { useEffect } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { WhatsNewIcon } from "@/components/icons/WhatsNewIcon";
import { CHANGELOG, markChangelogSeen, type ChangeType } from "@/lib/changelog";

const TYPE_STYLES: Record<ChangeType, { label: string; className: string }> = {
  new: { label: "New", className: "text-brand bg-brand/12 border-brand/20" },
  improved: { label: "Improved", className: "text-sky-700 dark:text-sky-300 bg-sky-500/12 border-sky-500/20" },
  fixed: { label: "Fixed", className: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/12 border-emerald-500/20" },
};

function formatDate(iso: string): string {
  try {
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function WhatsNew() {
  useDocumentTitle("What's New — Relay Outpost");

  // Clear the "unseen" indicator once the user has viewed the latest entries.
  useEffect(() => { markChangelogSeen(); }, []);

  return (
    <div className="h-dvh overflow-y-auto">
      <div className="relative">
        {/* Astronaut space backdrop — header flourish, anchored TOP and faded out downward so the
            dense changelog below stays fully legible. Light line-art on black: mix-blend screen drops
            the black to transparent (no dark block in light mode) and keeps only the faint lines in
            BOTH themes. */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 z-0 h-[500px] sm:h-[620px] pointer-events-none bg-cover bg-top opacity-[0.12] dark:opacity-[0.12]"
          style={{
            backgroundImage: "url(/images/whatsnew-bg.webp)",
            mixBlendMode: "screen",
            WebkitMaskImage: "linear-gradient(to bottom, #000 0%, #000 30%, rgba(0,0,0,0.4) 64%, transparent 92%)",
            maskImage: "linear-gradient(to bottom, #000 0%, #000 30%, rgba(0,0,0,0.4) 64%, transparent 92%)",
          }}
        />
        <div className="relative z-10 max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-in fade-in duration-300" data-testid="page-whats-new">
        {/* No hero back here: the app chrome's back is 50px above this line
            and owns the route (back-affordance.ts parentRouteOf). */}
        <div className="flex items-center gap-3 mb-1">
          <div className="flex items-center gap-2">
            <WhatsNewIcon className="w-6 h-6 text-brand dark:text-brand/80" />
            <div>
              <h1 className="text-lg sm:text-xl font-black uppercase tracking-[0.06em] leading-none text-brand dark:text-brand/90" style={{ fontStyle: "italic" }}>
                What's New
              </h1>
              <p className="text-[10px] text-brand/40 dark:text-brand/30 font-bold uppercase tracking-[0.2em] mt-0.5 ml-0.5">
                what we've been shipping
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-5">
          {CHANGELOG.map((entry) => (
            <section
              key={entry.date}
              className="overflow-hidden rounded-md border border-border/40 dark:border-brand/15 bg-card/30 dark:bg-white/[0.015]"
              data-testid={`changelog-entry-${entry.date}`}
            >
              {/* Log group header */}
              <div className="flex items-center justify-between gap-3 border-b border-border/40 dark:border-brand/12 bg-foreground/[0.025] dark:bg-white/[0.02] px-3.5 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-[1px] bg-brand shadow-[0_0_6px_rgba(139,92,246,0.5)]" />
                  <h2 className="truncate text-[13px] font-semibold tracking-tight text-foreground/90">{entry.title || "Update"}</h2>
                </div>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.15em] tabular-nums text-muted-foreground/50" data-testid={`changelog-version-${entry.version}`}>
                  v{entry.version} · {formatDate(entry.date)}
                </span>
              </div>

              {/* Log rows — hairline-separated, fixed tag gutter (CRM/terminal feel) */}
              <ul className="divide-y divide-border/30 dark:divide-white/[0.05]">
                {entry.changes.map((c, i) => {
                  const t = TYPE_STYLES[c.type];
                  return (
                    <li
                      key={i}
                      className="flex items-start gap-3 px-3.5 py-2.5 transition-colors hover:bg-foreground/[0.025] dark:hover:bg-white/[0.025]"
                      data-testid={`changelog-row-${entry.date}-${i}`}
                    >
                      <span className="flex w-[64px] shrink-0 sm:w-[72px]">
                        <span className={`rounded-[3px] border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider ${t.className}`}>
                          {t.label}
                        </span>
                      </span>
                      <span className="flex-1 text-[13px] leading-relaxed text-foreground/80 dark:text-foreground/75">{c.text}</span>
                    </li>
                  );
                })}
              </ul>

              {/* Release call-to-action (e.g. the open-source repo) — change
                  text is plain prose, so a real link gets a real row. */}
              {entry.link && (
                <div className="border-t border-border/40 dark:border-brand/12 px-3.5 py-2.5">
                  <a
                    href={entry.link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-brand hover:text-brand-strong transition-colors"
                    data-testid={`changelog-link-${entry.version}`}
                  >
                    {entry.link.label}
                    <span aria-hidden>↗</span>
                  </a>
                </div>
              )}

              {/* Community voice — the human reason(s) behind the release. */}
              {entry.feedback && (() => {
                const sparks = Array.isArray(entry.feedback) ? entry.feedback : [entry.feedback];
                return (
                  <figure className="border-t border-border/40 dark:border-brand/12 bg-brand/[0.035]/[0.05] px-3.5 py-3">
                    <figcaption className="mb-1.5 flex items-center gap-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-brand/70 dark:text-brand/60">
                      <span className="h-1 w-1 rounded-full bg-brand/70" />
                      What sparked this
                    </figcaption>
                    <div className="space-y-2.5">
                      {sparks.map((fb, i) => (
                        <div key={i}>
                          <blockquote className="border-l-2 border-brand/30 pl-3 text-[12.5px] italic leading-relaxed text-foreground/75 dark:text-foreground/70">
                            “{fb.quote}”
                          </blockquote>
                          <figcaption className="mt-1.5 pl-3 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/45">
                            {fb.attribution}
                          </figcaption>
                        </div>
                      ))}
                    </div>
                  </figure>
                );
              })()}
            </section>
          ))}
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground/50">
          Have an idea or found a bug?{" "}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("relay-outpost:open-feedback", { detail: { initialType: "idea" } }))}
            className="font-medium text-brand underline decoration-dotted underline-offset-2 transition-colors hover:text-brand-strong"
            data-testid="link-whats-new-feedback"
          >
            Send feedback
          </button>{" "}
          — we read everything.
        </p>
        </div>
      </div>
    </div>
  );
}
