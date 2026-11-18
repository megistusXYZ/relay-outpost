import { Link } from "wouter";
import {
  Sparkles,
  Bot,
  ShoppingBag,
  Globe,
  ChevronRight,
  Building2,
  Radio,
  Zap,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { OttoMark } from "@/components/OttoMark";

import { StepCard as SectionCard } from "@/components/wtf/StepCard";

export default function WhereNostrIsHeading() {
  useDocumentTitle("Where Nostr is heading — Relay Outpost");

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-in fade-in duration-150">
      <div className="flex items-center gap-3 mb-1">
        {/* Chrome back owns the route (back-affordance.ts) — no hero dupe. */}
        <div className="flex items-center gap-2">
          <OttoMark size={40} label="Otto" className="shrink-0 text-foreground !w-9 !h-9 sm:!w-10 sm:!h-10" />
          <div>
            <h1 className="text-[24px] sm:text-[30px] font-semibold tracking-[-0.025em] leading-[1.1] text-foreground">
              Where Nostr is heading
            </h1>
            <p className="text-[14px] sm:text-[15px] text-muted-foreground mt-1">The next phase of the internet</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-[20px] border border-border/60 bg-card p-5">
          <p className="text-[15px] text-foreground/75 leading-relaxed">
            Nostr is still early. Right now it's mostly known as "the decentralized Twitter." But that dramatically undersells what's coming. The protocol is evolving fast, and what's being built on top of it goes far beyond social media. AI agents with verifiable identities. Decentralized marketplaces with instant settlement. Community-governed spaces that can't be captured by corporations. Here's the roadmap for the next phase of the internet.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <Sparkles className="w-3.5 h-3.5 text-foreground/70" />
            <span className="text-[12px] font-medium text-muted-foreground">Deep dive · 10 minute read</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <SectionCard
          number={1}
          title="AI agents on Nostr"
          icon={Bot}
          description={
            <>
              <p>The AI revolution has a trust problem. When an AI agent sends you a message, how do you know who built it, who controls it, or whether it's operating honestly? Nostr solves this:</p>
              <div className="space-y-1.5 mt-2">
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">Verifiable AI identity</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">An AI agent can have its own Nostr key pair. Every message it sends is cryptographically signed — you can verify exactly which agent said what, and who operates it.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">Agent-to-agent communication</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Nostr relays become the communication backbone for AI agents. Agents can discover each other, negotiate, and transact — all on an open network anyone can join.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">Micropayments for AI services</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Combined with Lightning, AI agents can charge per-request. Need a translation? Pay 10 sats. Need data analysis? Pay 100 sats. No API keys, no subscriptions, no corporate gatekeepers.</p>
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground">Imagine a world where your personal AI assistant has a Nostr identity, communicates with other agents over relays, and pays for services with Lightning — all without any company controlling the flow.</p>
            </>
          }
        />

        <SectionCard
          number={2}
          title="Decentralized marketplaces"
          icon={ShoppingBag}
          description={
            <>
              <p>E-commerce on the internet runs through a handful of large marketplaces that decide who can sell and on what terms. Nostr enables something different:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[14px] text-foreground/70">
                <li><strong>Seller identity is portable</strong> — your reputation follows your key, not a platform account. Build trust once, sell everywhere.</li>
                <li><strong>Instant settlement</strong> — Lightning payments settle in seconds, not weeks. No 30-day payment holds.</li>
                <li><strong>Direct transactions</strong> — the sale is between buyer and seller, with Lightning handling the payment.</li>
                <li><strong>Community-curated discovery</strong> — instead of an algorithm promoting sponsored products, your Web of Trust surfaces products from sellers your network trusts.</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">This is already happening. Nostr-based marketplace protocols are being developed, and early versions are live. The next Amazon won't be a company — it'll be a protocol.</p>
            </>
          }
        />

        <SectionCard
          number={3}
          title="Value-for-value everything"
          icon={Zap}
          description={
            <>
              <p>The ad-supported internet created a perverse incentive: content is "free" because you pay with your attention and data. Lightning and Nostr enable a completely different model: <strong>value-for-value</strong>.</p>
              <ul className="list-disc list-inside space-y-1.5 text-[14px] text-foreground/70">
                <li><strong>Content creators</strong> can be supported directly by their audience — no ads or sponsors required.</li>
                <li><strong>Podcasters</strong> can receive small optional tips that listeners stream while they listen.</li>
                <li><strong>Developers</strong> can be funded directly by users of their open-source tools.</li>
                <li><strong>Tiny voluntary payments</strong> become practical — amounts far too small for credit card fees work fine on Lightning.</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">When you remove the ad model, you remove the incentive to manipulate attention. Content stops optimizing for outrage and starts optimizing for value.</p>
            </>
          }
        />

        <SectionCard
          number={4}
          title="Relay-based organizations"
          icon={Building2}
          description={
            <>
              <p>Communities are evolving beyond chat rooms. Relay-based organizations (think "DAOs but actually usable") are emerging:</p>
              <div className="space-y-1.5 mt-2">
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">Community governance</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Relay operators can implement community-driven moderation and governance. Not through a smart contract nobody understands, but through clear, auditable relay policies.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">Shared infrastructure</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Multiple communities can share relay infrastructure while maintaining independent governance. Costs go down, resilience goes up.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">Treasury management</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Community treasuries funded by voluntary contributions, managed transparently with Bitcoin multi-sig wallets. Every sat accounted for, on-chain.</p>
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground">This isn't theoretical. Communities are already organizing around relays, pooling resources, and building shared infrastructure — without any corporation involved.</p>
            </>
          }
        />

        <SectionCard
          number={5}
          title="The protocol is evolving"
          icon={Radio}
          description={
            <>
              <p>Nostr's design makes it uniquely adaptable. New capabilities are added through NIPs (Nostr Implementation Possibilities) — proposals that anyone can write and any client can implement:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[14px] text-foreground/70">
                <li><strong>Long-form content</strong> — articles, blogs, and wikis published to Nostr, owned by the author</li>
                <li><strong>Marketplace listings</strong> — buy and sell goods with Lightning, reputation tied to your key</li>
                <li><strong>Calendar events</strong> — decentralized event coordination (already live in Relay Outpost)</li>
                <li><strong>Live streaming</strong> — broadcasts with real-time zaps flowing from viewers to streamers</li>
                <li><strong>Music and audio</strong> — artists publishing directly to their audience, supported directly by their listeners</li>
                <li><strong>Encrypted group chat</strong> — private group messaging with the same cryptographic guarantees as DMs</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">The protocol grows organically. No product team decides what gets built — the community builds what it needs. That's why Nostr evolves faster than any corporate product roadmap.</p>
            </>
          }
        />

        <SectionCard
          number={6}
          title="Why this is the next phase"
          icon={Globe}
          description={
            <>
              <p>The internet is going through a phase transition. The old model — centralized platforms controlling identity, content, and payments — is breaking down under its own weight:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[14px] text-foreground/70">
                <li><strong>AI makes content creation free</strong> — when anyone can generate unlimited text, images, and video, the scarce resource becomes trust and verification, not content</li>
                <li><strong>Data fragmentation accelerates</strong> — your digital life is scattered across 50+ platforms, each with their own login, each harvesting your data independently</li>
                <li><strong>Users are waking up</strong> — deplatforming, algorithmic manipulation, and data breaches are pushing mainstream users to seek alternatives</li>
              </ul>
              <p>Nostr and Bitcoin provide the two rails this new internet needs:</p>
              <div className="space-y-1.5 mt-2">
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">Nostr: the identity and communication layer</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Verifiable identity, communication no single company can block, and data you can take anywhere — without any company in the middle.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">Bitcoin: the value transfer layer</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Instant, global payments anyone can send — from micropayments to major transactions, with no bank, no processor, and no borders.</p>
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground mt-2">Together, they create an internet where you own your identity, control your data, communicate freely, and transact directly. That's not utopia — it's infrastructure. And it's being built right now.</p>
            </>
          }
        />
      </div>

      <div className="mt-10 mb-6">
        <div className="rounded-[20px] border border-border/60 bg-card p-6 text-center">
          <div className="w-12 h-12 rounded-full dark:bg-foreground/[0.05] flex items-center justify-center mx-auto mb-3">
            <Sparkles className="w-6 h-6 text-foreground/75" />
          </div>
          <h3 className="text-[17px] font-semibold text-foreground mb-1">The future is being built now</h3>
          <p className="text-[14px] text-muted-foreground max-w-sm mx-auto leading-relaxed mb-5">
            Every time you post, zap, or join a Community, you're using the infrastructure of the next internet. Not a prototype. Not a beta. The real thing — running on Nostr and Lightning, owned by nobody, available to everybody.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/" className="inline-flex items-center gap-1.5 h-11 px-5 rounded-full whitespace-nowrap bg-foreground text-background text-[15px] font-medium hover:bg-foreground/90 active:scale-[0.98] transition-colors duration-150">
              Start exploring
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
