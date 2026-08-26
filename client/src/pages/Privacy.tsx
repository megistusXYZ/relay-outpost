import { Link } from "wouter";
import { ArrowLeft, ShieldCheck, Key, Radio, Database, Eye, FileText, FlaskConical } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useGoBack } from "@/hooks/use-go-back";

const LAST_UPDATED = "June 15, 2026";

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

export default function Privacy() {
  useDocumentTitle("Privacy — Relay Outpost");
  const goBack = useGoBack();

  return (
    <div className="h-dvh overflow-y-auto">
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-in fade-in duration-300" data-testid="page-privacy">
      <div className="flex items-center gap-3 mb-1">
        <button type="button" onClick={() => goBack("/")} className="text-muted-foreground/50 hover:text-foreground transition-colors" data-testid="link-back-privacy" aria-label="Back">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-7 h-7 text-brand dark:text-brand/80" />
          <div>
            <h1 className="text-lg sm:text-xl font-black uppercase tracking-[0.06em] leading-none text-brand dark:text-brand/90" style={{ fontStyle: "italic" }}>
              Privacy
            </h1>
            <p className="text-[10px] text-brand/40 dark:text-brand/30 font-bold uppercase tracking-[0.2em] mt-0.5 ml-0.5">
              what we touch, and what we don't
            </p>
          </div>
        </div>
      </div>

      {/* Public-beta notice — set expectations honestly. */}
      <div className="mt-6 rounded-xl border border-amber-500/30 dark:border-amber-500/20 bg-amber-500/[0.06] p-4 flex items-start gap-3">
        <FlaskConical className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[13px] text-foreground/80 dark:text-foreground/75 leading-relaxed">
          <strong>Public beta.</strong> Relay Outpost is new and still evolving. Some features are experimental, and this page may change as the app grows. Whatever happens, your account lives in your key — keep a backup of it.
        </p>
      </div>

      <div className="mt-4 mb-6 rounded-xl border border-border/30 dark:border-border/15 bg-white/50 dark:bg-muted/10 p-5">
        <p className="text-sm text-foreground/85 dark:text-foreground/80 leading-relaxed">
          The short version: almost everything you do happens between your device and the relays you choose — not on our servers. Your posts are signed on your device and sent straight to those relays. This page explains the few places our infrastructure does sit in the middle, and what we do (and don't) do there.
        </p>
        <p className="text-[11px] text-muted-foreground/70 mt-3 pt-3 border-t border-border/20">
          Last updated {LAST_UPDATED} · Written in plain language on purpose
        </p>
      </div>

      {/* At a glance — scannable summary before the detail. */}
      <div className="mb-6 rounded-xl border border-brand/20 dark:border-brand/12 bg-brand/[0.04] p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand/80 dark:text-brand/70 mb-3">At a glance</p>
        <ul className="space-y-2 text-[13px] text-foreground/85 dark:text-foreground/80">
          {[
            "Your private key never reaches our servers.",
            "Relay Outpost doesn't show ads or track your activity.",
            "Direct messages are end-to-end encrypted.",
            "What you post to Nostr is public by design.",
          ].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-brand shrink-0" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-4">
        <Section icon={Eye} title="What we don't do">
          <ul className="list-disc list-inside space-y-1.5">
            <li>We don't hold your private key. Depending on how you signed in, it lives in this browser (encrypted by a passphrase only you know), in a separate signer extension, or on a remote signer you've connected — never on our servers.</li>
            <li>We don't read or store the contents of your direct messages. End-to-end encrypted messages pass through relays, not us.</li>
            <li>We don't build profiles of you across the relays you visit.</li>
            <li>We don't sell or share personal data with advertisers or data brokers. There are no ads.</li>
            <li>We don't run third-party analytics or tracking scripts on the client.</li>
          </ul>
        </Section>

        <Section icon={Database} title="Where our server sits in the middle">
          <p>The web app is served by a small backend, and a handful of features route through it. When they do, here's what happens:</p>
          <ul className="list-disc list-inside space-y-1.5">
            <li><strong>Access logs.</strong> Like any web server, ours briefly records the IP address and path of each request for operational reasons (debugging, abuse prevention). These logs rotate on a short window and aren't used to profile individuals.</li>
            <li><strong>Link previews & NIP-05 checks.</strong> When the app shows a link card or verifies a profile's name, our server fetches that page or the domain's verification file so your browser doesn't have to. Results are cached briefly, not kept long-term.</li>
            <li><strong>Media uploads.</strong> Images, audio, and video you upload go to the media host you've configured, signed with your key. We don't keep a copy.</li>
            <li><strong>Text-to-speech.</strong> If you have a post read aloud, the text is sent to a speech backend and played back. We don't retain the audio.</li>
            <li><strong>Discovery & relay health.</strong> Trending feeds come from public Nostr events that were already broadcast openly; relay checks use only public relay URLs.</li>
          </ul>
        </Section>

        <Section icon={Radio} title="Data on Nostr itself">
          <p>Nostr is a public, open network. Anything you publish — posts, reactions, your follow list, your profile — is signed by your key and broadcast to the relays you chose. From there it can be stored, copied, and read by anyone who can reach those relays.</p>
          <p>Relays are run by independent operators. Each one decides what it stores, for how long, and with whom. Choosing your relays is choosing the neighborhood your signal travels through.</p>
          <p>Direct messages are end-to-end encrypted, but metadata like who you messaged and when can still be visible to relays.</p>
        </Section>

        <Section icon={Key} title="Your controls">
          <ul className="list-disc list-inside space-y-1.5">
            <li>Change or add relays any time from Settings.</li>
            <li>Remove the local account from this device in Settings — your key and its encrypted passphrase are deleted from this browser.</li>
            <li>Start fresh with a new key. Old posts stay on the relays that stored them (that's how Nostr works), but new activity is signed by the new key.</li>
            <li>Export your key whenever you like — it was always yours to leave with.</li>
          </ul>
        </Section>

        <Section icon={FileText} title="Transparency & changes">
          <p>We aim to keep this honest and current. When something material changes, we'll note it in the app. Small edits (typos, clarifications) may happen without notice.</p>
        </Section>

        <Section icon={ShieldCheck} title="Contact">
          <p>Privacy questions? Reach the Relay Outpost team over Nostr, or via the contact link in the app footer.</p>
        </Section>
      </div>

      <div className="mt-8 flex flex-wrap gap-3 text-[11px] text-muted-foreground/70">
        <Link href="/terms" className="hover:text-foreground transition-colors underline decoration-dotted" data-testid="link-to-covenant">
          Terms
        </Link>
        <span className="text-muted-foreground/30">·</span>
        <Link href="/settings" className="hover:text-foreground transition-colors underline decoration-dotted" data-testid="link-to-settings">
          Settings
        </Link>
      </div>
    </div>
    </div>
  );
}
