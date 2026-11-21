import { publicPageTitle } from "@shared/public-pages";
import { Link } from "wouter";
import {
  Key,
  Shield,
  Fingerprint,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Database,
  Globe,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { OttoMark } from "@/components/OttoMark";

import { StepCard as SectionCard } from "@/components/wtf/StepCard";

export default function DataSovereignty() {
  useDocumentTitle(publicPageTitle("/help/data-sovereignty"));

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-in fade-in duration-150">
      <div className="flex items-center gap-3 mb-1">
        {/* Chrome back owns the route (back-affordance.ts) — no hero dupe. */}
        <div className="flex items-center gap-2">
          <OttoMark size={40} label="Relay" className="shrink-0 text-foreground !w-9 !h-9 sm:!w-10 sm:!h-10" />
          <div>
            <h1 className="text-[24px] sm:text-[30px] font-semibold tracking-[-0.025em] leading-[1.1] text-foreground">
              Owning your data & keys
            </h1>
            <p className="text-[14px] sm:text-[15px] text-muted-foreground mt-1">You own your identity. period.</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-[20px] border border-border/60 bg-card p-5">
          <p className="text-[15px] text-foreground/75 leading-relaxed">
            On every platform you've ever used, your identity is a database row controlled by someone else. They can change it, freeze it, or delete it. On Nostr, your identity is a cryptographic key pair — and it belongs to you in the most literal, mathematical sense possible. No company issued it. No company can revoke it. Here's why that changes everything.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <Key className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
            <span className="text-[12px] font-medium text-muted-foreground">Deep dive · 8 minute read</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <SectionCard
          number={1}
          title="The password illusion"
          icon={AlertTriangle}
          description={
            <>
              <p>Think about how identity works on the internet today. Every account you have follows the same pattern:</p>
              <ol className="list-decimal list-inside space-y-1.5 text-[14px] text-foreground/70">
                <li>You give a company your email (and often your phone number, real name, date of birth)</li>
                <li>You create a password — which they store (hopefully hashed, but not always)</li>
                <li>They give you an account — a database row on their servers</li>
                <li>You build your digital life inside their system — posts, followers, messages, history</li>
              </ol>
              <p className="text-[12px] text-muted-foreground mt-2">Here's the problem: <strong>you never owned any of it</strong>. That "account" is their property. Your username, your follower count, your post history — all of it lives on their servers, governed by their terms of service, which they can change at any time.</p>
              <p className="text-[12px] text-muted-foreground">"Forgot your password?" isn't a convenience — it's proof that the company controls your identity, not you.</p>
            </>
          }
        />

        <SectionCard
          number={2}
          title="How Nostr keys work"
          icon={Key}
          description={
            <>
              <p>On Nostr, your identity is two things:</p>
              <div className="space-y-1.5 mt-2">
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">Public key (npub)</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">This is your identity — like your username, but unguessable and unforgeable. You share it freely. Anyone can use it to find you, follow you, or verify that a post came from you.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">Private key (nsec)</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">This is your proof of identity — like your password, but better. It never gets sent to any server. It signs your messages locally, proving you wrote them. Only you have it. Only you can use it.</p>
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground">These keys are generated mathematically using cryptography. No company creates them for you. No server stores them. They're born on your device and they stay with you.</p>
              <p className="text-[12px] text-muted-foreground">Think of it like having a passport that no government issued — one that's mathematically impossible to forge, and that you carry with you everywhere.</p>
            </>
          }
        />

        <SectionCard
          number={3}
          title="What your key does (it's more than login)"
          icon={Fingerprint}
          description={
            <>
              <p>Your private key isn't just a password replacement. It's a universal tool that does several things at once:</p>
              <div className="space-y-1.5 mt-2">
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3 h-3 text-muted-foreground" />
                    <span className="text-foreground font-semibold text-[13px]">Identity</span>
                  </div>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Your public key is your universal identity across every Nostr app. No signup forms, no email verification, no phone numbers.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3 h-3 text-muted-foreground" />
                    <span className="text-foreground font-semibold text-[13px]">Authentication</span>
                  </div>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Your key is your login. Walk into any Nostr app with your key and you're instantly you — with your profile, follows, and history intact.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3 h-3 text-muted-foreground" />
                    <span className="text-foreground font-semibold text-[13px]">Proof of authorship</span>
                  </div>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Every post you publish is cryptographically signed. Anyone can mathematically verify that you wrote it — not a bot, not an impersonator, not an AI. You.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3 h-3 text-muted-foreground" />
                    <span className="text-foreground font-semibold text-[13px]">Encryption</span>
                  </div>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Your key encrypts and decrypts your private messages. End-to-end, with no third party involved — the same key that signs your posts also protects your DMs.</p>
                </div>
              </div>
            </>
          }
        />

        <SectionCard
          number={4}
          title='Why "No Recovery" Is a Feature'
          icon={Shield}
          description={
            <>
              <p>The first thing people ask: "What if I lose my key?" And it's a valid concern. But here's the important reframe:</p>
              <p><strong>"Forgot password" means someone else controls your identity.</strong></p>
              <p>When you click "Forgot Password" on Gmail or Facebook, you're asking the company to verify you through some other channel (email, SMS, ID check) and grant you access again. That means they have the power to grant — or deny — access to your identity at any time.</p>
              <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2 mt-2">
                <p className="text-[12px] text-foreground/60">On Nostr, nobody can "reset" your key because nobody else has it. This is the same model that secures Bitcoin wallets — and it's the reason billions of dollars of value can be stored without any bank, company, or government involved.</p>
              </div>
              <p className="text-[12px] text-muted-foreground mt-2">In practice, key management is getting easier every year. Browser extensions like Alby store your key safely. Hardware signers keep it offline. And future standards will add social recovery (trusted friends can help you restore access) without giving up control.</p>
            </>
          }
        />

        <SectionCard
          number={5}
          title="Owning your data in practice"
          icon={Database}
          description={
            <>
              <p>Owning your keys means owning your data. Here's what that looks like day to day:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[14px] text-foreground/70">
                <li><strong>Switch apps freely</strong> — log into any Nostr client and your entire profile, posts, and follow list appear instantly. No export/import dance.</li>
                <li><strong>Choose your storage</strong> — your data lives on the relays you choose. Run your own relay for complete control of your data, or use public ones for convenience.</li>
                <li><strong>Verifiable everything</strong> — every post carries your cryptographic signature. In an age of deepfakes and AI-generated content, this is the only way to prove authorship.</li>
                <li><strong>No data harvesting</strong> — there's no central database of your behavior. Relays see your posts, but no single entity builds a profile of your entire digital life.</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">This is what "owning your data" actually means — not a "Download My Data" button that gives you a zip file of JSON. Real ownership. Real portability. Real freedom to move anywhere.</p>
            </>
          }
        />

        <SectionCard
          number={6}
          title="Leaving cleanly: vanish from relays"
          icon={AlertTriangle}
          description={
            <>
              <p>
                A real non-custodial product has to make leaving as easy as joining.
                When you want to walk away, Nostr has a protocol-native answer: a
                NIP-62 "Request to Vanish". You sign one kind-62 event with your own
                key and every compliant relay you broadcast to will delete your
                history.
              </p>
              <p className="text-[12px] text-muted-foreground">
                You can run this yourself from{" "}
                <Link href="/settings/danger" className="text-brand underline underline-offset-2 hover:no-underline">
                  Settings → Advanced &amp; danger zone → Vanish from relays
                </Link>
                . Relay Outpost also wipes your encrypted key, resume-signup draft, and
                bunker config from this device the moment at least one relay accepts.
                Caveat: non-compliant relays and clients that already cached your
                posts may still hold copies — no client can reach into someone
                else's database.
              </p>
            </>
          }
        />

        <SectionCard
          number={7}
          title="For the bigger picture: why keys matter for everyone"
          icon={Globe}
          description={
            <>
              <p>Cryptographic identity isn't just for privacy enthusiasts. It solves problems that affect everyone:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[14px] text-foreground/70">
                <li><strong>Businesses</strong> — can publish verifiable communications. Customers can confirm that an announcement, policy update, or product listing actually came from the company.</li>
                <li><strong>Journalists</strong> — can prove authorship of their work. No more fake articles attributed to real reporters.</li>
                <li><strong>AI verification</strong> — as AI generates more content, cryptographic signatures become the only way to distinguish human-authored from machine-generated content.</li>
                <li><strong>Cross-border identity</strong> — your key works everywhere, with no government involvement. Useful for the 1 billion+ people worldwide who lack official identification.</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">We're moving toward an internet where "who said this?" is the most important question. Nostr keys answer it mathematically — not with a checkmark anyone can buy.</p>
            </>
          }
        />
      </div>

      <div className="mt-10 mb-6">
        <div className="rounded-[20px] border border-border/60 bg-card p-6 text-center">
          <div className="w-12 h-12 rounded-full dark:bg-foreground/[0.05] flex items-center justify-center mx-auto mb-3">
            <Key className="w-6 h-6 text-foreground/75" />
          </div>
          <h3 className="text-[17px] font-semibold text-foreground mb-1">Your key, your identity, your data</h3>
          <p className="text-[14px] text-muted-foreground max-w-sm mx-auto leading-relaxed mb-5">
            For the first time in internet history, you can own your identity without asking anyone's permission. One key pair. Every app. Forever yours.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/settings/danger" className="inline-flex items-center gap-1.5 h-11 px-5 rounded-full whitespace-nowrap bg-foreground text-background text-[15px] font-medium hover:bg-foreground/90 active:scale-[0.98] transition-colors duration-150">
              View Your Keys
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
            <Link href="/help" className="inline-flex items-center gap-1.5 h-11 px-5 rounded-full whitespace-nowrap border border-foreground/25 text-foreground text-[15px] font-medium hover:bg-foreground/[0.06] active:scale-[0.98] transition">
              Back to Help &amp; guides
            </Link>
          </div>
        </div>
      </div>

      <div className="border-t border-border/60 mt-3 pt-4 pb-2 text-center">
        <p className="text-[13px] text-muted-foreground font-medium">
          Relay Outpost — the next phase of the internet
        </p>
      </div>
    </div>
  );
}
