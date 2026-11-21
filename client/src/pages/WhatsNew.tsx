import { publicPageTitle } from "@shared/public-pages";
import { useEffect } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";

import { CHANGELOG, markChangelogSeen, type ChangeType } from "@/lib/changelog";

// Status words, not pills (owner): the kind of change is a plain coloured word.
const TYPE_STYLES: Record<ChangeType, { label: string; className: string }> = {
  new: { label: "New", className: "text-brand" },
  improved: { label: "Improved", className: "text-muted-foreground" },
  fixed: { label: "Fixed", className: "text-success" },
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
  useDocumentTitle(publicPageTitle("/whats-new"));

  // Clear the "unseen" indicator once the user has viewed the latest entries.
  useEffect(() => { markChangelogSeen(); }, []);

  return (
    <div className="h-dvh overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 pb-8 animate-in fade-in duration-150" data-testid="page-whats-new">
        {/* No hero back or title: the app chrome's back owns the route
            (back-affordance.ts), and pages open with their content
            (lib/page-titles.test.ts). */}
        <div className="space-y-4">
          {CHANGELOG.map((entry) => (
            <section
              // The version, not the date: two releases can go out on one day
              // (1.10.0 and 1.11.0 did), and a shared key lets React drop or
              // double a row.
              key={entry.version}
              className="overflow-hidden rounded-[20px] border border-border/60 bg-card"
              data-testid={`changelog-entry-${entry.version}`}
            >
              {/* Log group header */}
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 sm:px-5 pt-4 pb-2">
                <h2 className="min-w-0 text-[18px] font-semibold tracking-[-0.015em] text-foreground">{entry.title || "Update"}</h2>
                <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground" data-testid={`changelog-version-${entry.version}`}>
                  v{entry.version} · {formatDate(entry.date)}
                </span>
              </div>

              {/* Log rows — hairline-separated, fixed tag gutter (CRM/terminal feel) */}
              <ul className="divide-y divide-border/40 px-4 sm:px-5 pb-1">
                {entry.changes.map((c, i) => {
                  const t = TYPE_STYLES[c.type];
                  return (
                    <li
                      key={i}
                      className="flex items-baseline gap-3 py-3"
                      data-testid={`changelog-row-${entry.date}-${i}`}
                    >
                      <span className={`w-[68px] shrink-0 sm:w-[76px] text-[13px] font-medium ${t.className}`}>
                        {t.label}
                      </span>
                      <span className="flex-1 text-[15px] leading-relaxed text-foreground/85">{c.text}</span>
                    </li>
                  );
                })}
              </ul>

              {/* Release call-to-action (e.g. the open-source repo) — change
                  text is plain prose, so a real link gets a real row. */}
              {entry.link && (
                <div className="border-t border-border/40 px-4 sm:px-5 py-3">
                  <a
                    href={entry.link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[14px] font-medium text-brand hover:text-brand-strong transition-colors"
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
                  <figure className="border-t border-border/40 bg-foreground/[0.025] px-4 sm:px-5 py-4">
                    <figcaption className="mb-2 text-[13px] font-medium text-muted-foreground">
                      What sparked this
                    </figcaption>
                    <div className="space-y-2.5">
                      {sparks.map((fb, i) => (
                        <div key={i}>
                          <blockquote className="border-l-2 border-foreground/20 pl-3 text-[15px] leading-relaxed text-foreground/80">
                            “{fb.quote}”
                          </blockquote>
                          <figcaption className="mt-1.5 pl-3 text-[13px] font-medium text-muted-foreground">
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

        <p className="mt-8 text-center text-[14px] text-muted-foreground">
          Have an idea or found a bug?{" "}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("relay-outpost:open-feedback", { detail: { initialType: "idea" } }))}
            className="font-medium text-brand underline underline-offset-2 transition-colors hover:text-brand-strong"
            data-testid="link-whats-new-feedback"
          >
            Send feedback
          </button>{" "}
          — we read everything.
        </p>
        </div>
    </div>
  );
}
