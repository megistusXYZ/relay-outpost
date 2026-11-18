import { Link } from "wouter";
import {
  Globe,
  Shield,
  Database,
  ChevronRight,
  AlertTriangle,
  Building2,
  Eye,
  Unplug,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { OttoMark } from "@/components/OttoMark";

import { StepCard as SectionCard } from "@/components/wtf/StepCard";

export default function WhyDecentralization() {
  useDocumentTitle("Why decentralization matters — Relay Outpost");

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-in fade-in duration-150">
      <div className="flex items-center gap-3 mb-1">
        {/* Chrome back owns the route (back-affordance.ts) — no hero dupe. */}
        <div className="flex items-center gap-2">
          <OttoMark size={40} label="Relay" className="shrink-0 text-foreground !w-9 !h-9 sm:!w-10 sm:!h-10" />
          <div>
            <h1 className="text-[24px] sm:text-[30px] font-semibold tracking-[-0.025em] leading-[1.1] text-foreground">
              Why decentralization matters
            </h1>
            <p className="text-[14px] sm:text-[15px] text-muted-foreground mt-1">The case for owning your identity</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-[20px] border border-border/60 bg-card p-5">
          <p className="text-[15px] text-foreground/75 leading-relaxed">
            Imagine building a house on rented land. You furnish it, invite friends over, build a community around it. Then one day the landlord changes the rules, raises the rent, or tears it down. That's what centralized platforms do with your digital life. This deep dive explains why decentralization isn't just a technical upgrade — it's a fundamental shift in who owns the internet.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <Globe className="w-3.5 h-3.5 text-foreground/70" />
            <span className="text-[12px] font-medium text-muted-foreground">Deep dive · 10 minute read</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <SectionCard
          number={1}
          title="The problem: you don't own anything"
          icon={Building2}
          description={
            <>
              <p>Right now, a handful of companies control how billions of people communicate, create, and connect:</p>
              <div className="space-y-1.5 mt-2">
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <p className="text-[12px] text-foreground/60"><strong className="text-danger">Your content?</strong> Lives on their servers. They can delete it, suppress it, or change who sees it — without telling you.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <p className="text-[12px] text-foreground/60"><strong className="text-danger">Your audience?</strong> You built it on their platform. They can throttle your reach anytime — and they do, to sell you ads.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <p className="text-[12px] text-foreground/60"><strong className="text-danger">Your identity?</strong> Tied to an email and a password they control. One ban, one hack, one policy change — and you disappear.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <p className="text-[12px] text-foreground/60"><strong className="text-danger">Your data?</strong> Harvested, profiled, and sold. You are the product being monetized.</p>
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground mt-2">This isn't a conspiracy — it's the business model. When a service is free, you're paying with your data, your attention, and your autonomy.</p>
            </>
          }
        />

        <SectionCard
          number={2}
          title="The real-world consequences"
          icon={AlertTriangle}
          description={
            <>
              <p>This isn't abstract. People lose their livelihoods, their communities, and their digital histories every day:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[14px] text-foreground/70">
                <li><strong>Creators deplatformed overnight</strong> — years of content, followers, and income vanished because an algorithm flagged them or a policy changed</li>
                <li><strong>Businesses that built on Facebook</strong> saw their organic reach drop from 16% to under 2% once Meta decided to monetize the feed</li>
                <li><strong>Entire communities erased</strong> — when a subreddit gets banned, a Discord gets shut down, or a Facebook Group gets deleted, the community has zero recourse</li>
                <li><strong>Data breaches at scale</strong> — centralized databases are honeypots. One breach exposes millions of people's private information</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">The centralized model creates a single point of failure — and that point of failure is controlled by someone else's quarterly earnings report.</p>
            </>
          }
        />

        <SectionCard
          number={3}
          title="What decentralization actually means"
          icon={Globe}
          description={
            <>
              <p>Decentralization sounds technical, but the concept is simple: <strong>no single entity controls the system</strong>. Here's what that looks like in practice:</p>
              <div className="space-y-1.5 mt-2">
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">No central server</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Your data lives across many relays, not one company's database. If one goes down, your data still exists everywhere else.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">No central authority</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Nobody can ban you from Nostr. Individual relays can refuse your data, but you can always move to another relay or run your own.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">No central identity provider</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Your identity is a cryptographic key pair that you generate yourself. No signup, no email, no phone number, no third party involved.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">No central algorithm</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">You choose what you see. Your feed is based on who you follow and what your Web of Trust recommends — not what maximizes ad revenue.</p>
                </div>
              </div>
            </>
          }
        />

        <SectionCard
          number={4}
          title="How Nostr makes it real"
          icon={Database}
          description={
            <>
              <p>Other projects have tried decentralization before. Nostr succeeds where they failed because it's <strong>radically simple</strong>:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[14px] text-foreground/70">
                <li><strong>Simple protocol</strong> — Nostr uses JSON messages signed with cryptographic keys. That's it. No blockchain, no token, no consensus mechanism.</li>
                <li><strong>Relays are dumb</strong> — they just store and forward messages. The intelligence lives in the clients (apps like Relay Outpost), which means innovation happens fast.</li>
                <li><strong>Portability by design</strong> — your follow list, your profile, your posts — everything travels with your key. Switch apps anytime without losing anything.</li>
                <li><strong>Open to everyone</strong> — anyone can build a client, run a relay, or create a new event type. No API keys, no app store approval, no terms of service.</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Think of Nostr like email but for everything — messaging, social media, payments, identity, and more. Just as nobody owns email, nobody owns Nostr.</p>
            </>
          }
        />

        <SectionCard
          number={5}
          title="Why this matters now"
          icon={Eye}
          description={
            <>
              <p>We're at an inflection point. AI-generated content is flooding every platform, making it nearly impossible to know what's real. Centralized systems can't solve this — they're part of the problem:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[14px] text-foreground/70">
                <li><strong>Verification is broken</strong> — blue checkmarks are for sale, bots are indistinguishable from humans, and deepfakes are getting cheaper by the month</li>
                <li><strong>Trust is collapsing</strong> — when platforms manipulate what you see, you can't trust that what reaches you is authentic or representative</li>
                <li><strong>Data fragmentation</strong> — your digital life is scattered across dozens of platforms, each with their own login, their own rules, their own agenda</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Nostr solves this with cryptographic signatures. Every post is signed by the author's key — verifiably, permanently, unforgedly. When you see a post on Nostr, you can mathematically prove who wrote it. No platform needed.</p>
            </>
          }
        />

        <SectionCard
          number={6}
          title="What you actually get"
          icon={Shield}
          description={
            <>
              <p>Decentralization isn't just philosophy — it translates into real, tangible benefits you feel every day:</p>
              <div className="space-y-1.5 mt-2">
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-success font-semibold text-[13px]">No single off-switch</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">No single entity can delete your account or remove your content. Your voice persists across the network.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-success font-semibold text-[13px]">Your audience is portable</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Your followers follow your key, not a platform account. Switch apps, change relays — your audience comes with you.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-success font-semibold text-[13px]">Support goes straight to you</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">With Lightning zaps, your audience can send you optional support instantly — and 100% of it goes to you.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-success font-semibold text-[13px]">Privacy is the default</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">No ad tracking, no behavioral profiles, no selling your data. Relay Outpost strips metadata from your uploads and encrypts your DMs end-to-end.</p>
                </div>
              </div>
            </>
          }
        />

        <SectionCard
          number={7}
          title="The internet is changing"
          icon={Unplug}
          description={
            <>
              <p>The first phase of the internet was open — anyone could publish a website, send an email, build a business. Then the platforms took over and locked everything inside their own walls.</p>
              <p>Now we're entering the <strong>next phase</strong> — where the openness of the early internet returns, but with modern tools: cryptographic identity, instant global payments, and community-governed spaces.</p>
              <p>Nostr and Bitcoin are the rails this new internet runs on:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li><strong>Nostr</strong> handles identity, communication, and data — without any company in the middle</li>
                <li><strong>Bitcoin's Lightning Network</strong> handles value transfer — instant, global, and open to everyone</li>
                <li><strong>Together</strong> they create a system where you can communicate, create, transact, and build communities without asking anyone's permission</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">This isn't a future prediction. It's happening right now. You're using it. Relay Outpost is built on these rails — and it's just the beginning.</p>
            </>
          }
        />
      </div>

      <div className="mt-10 mb-6">
        <div className="rounded-[20px] border border-border/60 bg-card p-6 text-center">
          <div className="w-12 h-12 rounded-full dark:bg-foreground/[0.05] flex items-center justify-center mx-auto mb-3">
            <Globe className="w-6 h-6 text-foreground/75" />
          </div>
          <h3 className="text-[17px] font-semibold text-foreground mb-1">Your internet, your rules</h3>
          <p className="text-[14px] text-muted-foreground max-w-sm mx-auto leading-relaxed mb-5">
            Decentralization means nobody stands between you and your digital life. Not a corporation, not a government, not an algorithm. Just you and the people you choose to connect with.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/help/data-sovereignty" className="inline-flex items-center gap-1.5 h-11 px-5 rounded-full whitespace-nowrap bg-foreground text-background text-[15px] font-medium hover:bg-foreground/90 active:scale-[0.98] transition-colors duration-150">
              Your Keys, Your Identity
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
