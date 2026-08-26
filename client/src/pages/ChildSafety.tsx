/**
 * Child Safety Standards — the public page Google Play's Child Safety
 * Standards declaration points at (store QA 1.4). Guest-accessible at
 * /child-safety, routed beside /terms and /privacy outside the auth wall.
 *
 * Written to the same bar as the rest of the store-safe copy: every
 * commitment here is one a decentralized CLIENT can actually keep. We
 * promise action on our surfaces, our defaults, and infrastructure we
 * operate — and escalation (NCMEC, law enforcement, relay operators)
 * beyond them. We never claim the power to delete content from relays
 * we don't run, because a reviewer — or a court — can check.
 */
import { ArrowLeft, ShieldAlert, Flag, Eye, Scale, Mail, Compass } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useGoBack } from "@/hooks/use-go-back";
import { openFeedbackDrawer } from "@/lib/nip34-feedback";

const LAST_UPDATED = "August 18, 2026";
// No email on this page by design (owner call, 2026-08-18): Play's designated
// child-safety contact is a CONSOLE form field submitted to Google at listing
// time — it is not required to be published here. Until a dedicated address
// exists, reports route through the in-app mechanisms below.

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/30 dark:border-border/15 bg-white/60 dark:bg-muted/10 p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand/10 to-brand/10 border border-brand/10 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-brand" />
        </div>
        <h2 className="text-sm font-bold text-foreground/90 uppercase tracking-wider">{title}</h2>
      </div>
      <div className="text-[13px] text-foreground/80 dark:text-foreground/75 leading-relaxed space-y-2">
        {children}
      </div>
    </section>
  );
}

export default function ChildSafety() {
  useDocumentTitle("Child Safety Standards — Relay Outpost");
  const goBack = useGoBack();

  return (
    <div className="h-dvh overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-in fade-in duration-300" data-testid="page-child-safety">
        <div className="flex items-center gap-3 mb-1">
          <button type="button" onClick={() => goBack("/")} className="text-muted-foreground/50 hover:text-foreground transition-colors" data-testid="link-back-child-safety" aria-label="Back">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-7 h-7 text-brand dark:text-brand/80" />
            <div>
              <h1 className="text-lg sm:text-xl font-black uppercase tracking-[0.06em] leading-none text-brand dark:text-brand/90" style={{ fontStyle: "italic" }}>
                Child Safety Standards
              </h1>
              <p className="text-[10px] text-brand/40 dark:text-brand/30 font-bold uppercase tracking-[0.2em] mt-0.5 ml-0.5">
                zero tolerance, clearly stated
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 mb-6 rounded-xl border border-border/30 dark:border-border/15 bg-white/50 dark:bg-muted/10 p-5">
          <p className="text-sm text-foreground/85 dark:text-foreground/80 leading-relaxed">
            Relay Outpost has <strong>zero tolerance for child sexual abuse and exploitation (CSAE)</strong>.
            Content that sexualizes, exploits, or endangers minors is prohibited by our{" "}
            <a href="/terms" className="text-brand hover:underline">Terms</a> and has no home in this app.
            This page explains the standards we hold, how to report violations, and exactly what happens when you do.
          </p>
          <p className="text-[11px] text-muted-foreground/70 mt-3 pt-3 border-t border-border/20">
            Last updated {LAST_UPDATED}
          </p>
        </div>

        <div className="space-y-4">
          <Section icon={ShieldAlert} title="What is prohibited">
            <p>
              Using Relay Outpost to create, share, request, link to, or advertise child sexual abuse
              material (CSAM), or to sexualize, groom, solicit, traffic, or otherwise exploit or endanger
              minors, is prohibited without exception. There is no appeal path for this category.
            </p>
          </Section>

          <Section icon={Compass} title="What Relay Outpost is — and what that changes">
            <p>
              Relay Outpost is a client onto the open Nostr network. Most of the servers ("relays") that
              store content are operated by independent third parties, and no single company — including us —
              can delete content from the entire network.
            </p>
            <p>
              That changes <em>how</em> we act, not <em>whether</em> we act. Within the app and infrastructure
              we control, we remove and block decisively. Beyond them, we escalate: to the operators of the
              relays hosting the material, and to the authorities the law designates.
            </p>
          </Section>

          <Section icon={Flag} title="How to report">
            <ul className="list-disc list-inside space-y-1.5">
              <li>Every post, profile, and media item has <strong>Report</strong> in its menu — including inside direct-message conversations.</li>
              <li>In-app reports publish an open-standard report (NIP-56) that reaches the moderators of the communities the reported account belongs to, and are reviewed by the Relay Outpost team.</li>
              <li>
                You can also reach the Relay Outpost team directly through{" "}
                <button type="button" onClick={() => openFeedbackDrawer()} className="text-brand hover:underline" data-testid="button-child-safety-feedback">
                  Send Feedback
                </button>
                {" "}(also under Settings; sign-in required) — feedback can be sent privately, end-to-end encrypted.
              </li>
            </ul>
            <p className="text-[12px] text-foreground/60">
              If you believe a child is in immediate danger, contact your local law enforcement first.
            </p>
          </Section>

          <Section icon={Eye} title="What happens when CSAE is reported">
            <ul className="list-disc list-inside space-y-1.5">
              <li><strong>Review.</strong> CSAE reports are treated as the highest-priority category and reviewed promptly.</li>
              <li><strong>Removal from our surfaces.</strong> Confirmed CSAE content and the accounts behind it are excluded from Relay Outpost's feeds, search, and discovery through our moderation systems.</li>
              <li><strong>Removal at the source where we can.</strong> On relays and infrastructure we or our partners operate, the content is deleted and the account is banned. For content hosted on third-party relays, we notify the operator.</li>
              <li><strong>Escalation.</strong> We report apparent CSAM to the National Center for Missing &amp; Exploited Children (NCMEC) in accordance with applicable law, and we cooperate with law enforcement.</li>
            </ul>
          </Section>

          <Section icon={Scale} title="Prevention and compliance">
            <ul className="list-disc list-inside space-y-1.5">
              <li>Sensitive-content filtering is <strong>on by default</strong> and can only be disabled behind an age screen and an explicit confirmation.</li>
              <li>Curated surfaces (Discover, starter follows, featured communities) exclude flagged and labelled-sensitive content entirely.</li>
              <li>Blocking, muting, and network-level trust filtering are built in and apply across every feed.</li>
              <li>We comply with applicable child safety laws, including CSAM reporting obligations.</li>
            </ul>
          </Section>

          <Section icon={Mail} title="Contact">
            <p>
              Users can reach the team through the in-app report and feedback channels above. Relay
              operators, app stores, and authorities are provided a designated child-safety contact
              through the channels those parties require (for example, the app-store console and the
              contact details published on our store listings).
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}
