import { Link } from "wouter";
import {
  Sparkles, Bot, ShoppingBag, Globe,
  ChevronRight, Image as ImageIcon, Play,
  Building2, Radio, Zap,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { WtfAlienIcon } from "@/components/icons/WtfAlienIcon";

import { StepCard as SectionCard } from "@/components/wtf/StepCard";

export default function WhereNostrIsHeading() {
  useDocumentTitle("Where Nostr Is Heading — Relay Outpost");

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-in fade-in duration-300">
      <div className="flex items-center gap-3 mb-1">
        {/* Chrome back owns the route (back-affordance.ts) — no hero dupe. */}
        <div className="flex items-center gap-2">
          <div className="relative shrink-0 -rotate-[10deg]">
            <WtfAlienIcon className="w-9 h-9 text-brand drop-shadow-[0_0_10px_rgba(109,40,217,0.4)] dark:drop-shadow-[0_0_12px_rgba(139,92,246,0.45)]" />
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-brand shadow-[0_0_6px_rgba(109,40,217,0.5)]" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-black uppercase tracking-[0.06em] leading-none text-brand dark:text-brand/90" style={{ fontStyle: "italic" }}>
              Where Nostr Is Heading
            </h1>
            <p className="text-[10px] text-brand/40 dark:text-brand/30 font-bold uppercase tracking-[0.2em] mt-0.5 ml-0.5">the next phase of the internet</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-xl border border-border/30 dark:border-border/15 bg-white/50 dark:bg-muted/10 p-5">
          <p className="text-sm text-foreground/70 dark:text-muted-foreground leading-relaxed">
            Nostr is still early. Right now it's mostly known as "the decentralized Twitter." But that dramatically undersells what's coming. The protocol is evolving fast, and what's being built on top of it goes far beyond social media. AI agents with verifiable identities. Decentralized marketplaces with instant settlement. Community-governed spaces that can't be captured by corporations. Here's the roadmap for the next phase of the internet.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <Sparkles className="w-3.5 h-3.5 text-pink-500/70" />
            <span className="text-[11px] font-medium text-muted-foreground/60">Deep dive · 10 minute read</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <SectionCard
          number={1}
          title="AI Agents on Nostr"
          icon={Bot}
          description={
            <>
              <p>The AI revolution has a trust problem. When an AI agent sends you a message, how do you know who built it, who controls it, or whether it's operating honestly? Nostr solves this:</p>
              <div className="space-y-1.5 mt-2">
                <div className="rounded-lg bg-muted/10 dark:bg-white/[0.03] border border-border/20 px-3 py-2">
                  <span className="text-pink-600 dark:text-pink-400 font-bold text-xs">Verifiable AI Identity</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">An AI agent can have its own Nostr key pair. Every message it sends is cryptographically signed — you can verify exactly which agent said what, and who operates it.</p>
                </div>
                <div className="rounded-lg bg-muted/10 dark:bg-white/[0.03] border border-border/20 px-3 py-2">
                  <span className="text-pink-600 dark:text-pink-400 font-bold text-xs">Agent-to-Agent Communication</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Nostr relays become the communication backbone for AI agents. Agents can discover each other, negotiate, and transact — all on an open network anyone can join.</p>
                </div>
                <div className="rounded-lg bg-muted/10 dark:bg-white/[0.03] border border-border/20 px-3 py-2">
                  <span className="text-pink-600 dark:text-pink-400 font-bold text-xs">Micropayments for AI Services</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Combined with Lightning, AI agents can charge per-request. Need a translation? Pay 10 sats. Need data analysis? Pay 100 sats. No API keys, no subscriptions, no corporate gatekeepers.</p>
                </div>
              </div>
              <p className="text-[12px] text-foreground/50">Imagine a world where your personal AI assistant has a Nostr identity, communicates with other agents over relays, and pays for services with Lightning — all without any company controlling the flow.</p>
            </>
          }
        />

        <SectionCard
          number={2}
          title="Decentralized Marketplaces"
          icon={ShoppingBag}
          description={
            <>
              <p>E-commerce on the internet runs through a handful of large marketplaces that decide who can sell and on what terms. Nostr enables something different:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[13px] text-foreground/60">
                <li><strong>Seller identity is portable</strong> — your reputation follows your key, not a platform account. Build trust once, sell everywhere.</li>
                <li><strong>Instant settlement</strong> — Lightning payments settle in seconds, not weeks. No 30-day payment holds.</li>
                <li><strong>Direct transactions</strong> — the sale is between buyer and seller, with Lightning handling the payment.</li>
                <li><strong>Community-curated discovery</strong> — instead of an algorithm promoting sponsored products, your Web of Trust surfaces products from sellers your network trusts.</li>
              </ul>
              <p className="text-[12px] text-foreground/50">This is already happening. Nostr-based marketplace protocols are being developed, and early versions are live. The next Amazon won't be a company — it'll be a protocol.</p>
            </>
          }
        />

        <SectionCard
          number={3}
          title="Value-for-Value Everything"
          icon={Zap}
          description={
            <>
              <p>The ad-supported internet created a perverse incentive: content is "free" because you pay with your attention and data. Lightning and Nostr enable a completely different model: <strong>value-for-value</strong>.</p>
              <ul className="list-disc list-inside space-y-1.5 text-[13px] text-foreground/60">
                <li><strong>Content creators</strong> can be supported directly by their audience — no ads or sponsors required.</li>
                <li><strong>Podcasters</strong> can receive small optional tips that listeners stream while they listen.</li>
                <li><strong>Developers</strong> can be funded directly by users of their open-source tools.</li>
                <li><strong>Tiny voluntary payments</strong> become practical — amounts far too small for credit card fees work fine on Lightning.</li>
              </ul>
              <p className="text-[12px] text-foreground/50">When you remove the ad model, you remove the incentive to manipulate attention. Content stops optimizing for outrage and starts optimizing for value.</p>
            </>
          }
        />

        <SectionCard
          number={4}
          title="Relay-Based Organizations"
          icon={Building2}
          description={
            <>
              <p>Communities are evolving beyond chat rooms. Relay-based organizations (think "DAOs but actually usable") are emerging:</p>
              <div className="space-y-1.5 mt-2">
                <div className="rounded-lg bg-muted/10 dark:bg-white/[0.03] border border-border/20 px-3 py-2">
                  <span className="text-pink-600 dark:text-pink-400 font-bold text-xs">Community Governance</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Relay operators can implement community-driven moderation and governance. Not through a smart contract nobody understands, but through clear, auditable relay policies.</p>
                </div>
                <div className="rounded-lg bg-muted/10 dark:bg-white/[0.03] border border-border/20 px-3 py-2">
                  <span className="text-pink-600 dark:text-pink-400 font-bold text-xs">Shared Infrastructure</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Multiple communities can share relay infrastructure while maintaining independent governance. Costs go down, resilience goes up.</p>
                </div>
                <div className="rounded-lg bg-muted/10 dark:bg-white/[0.03] border border-border/20 px-3 py-2">
                  <span className="text-pink-600 dark:text-pink-400 font-bold text-xs">Treasury Management</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Community treasuries funded by voluntary contributions, managed transparently with Bitcoin multi-sig wallets. Every sat accounted for, on-chain.</p>
                </div>
              </div>
              <p className="text-[12px] text-foreground/50">This isn't theoretical. Communities are already organizing around relays, pooling resources, and building shared infrastructure — without any corporation involved.</p>
            </>
          }
        />

        <SectionCard
          number={5}
          title="The Protocol Is Evolving"
          icon={Radio}
          description={
            <>
              <p>Nostr's design makes it uniquely adaptable. New capabilities are added through NIPs (Nostr Implementation Possibilities) — proposals that anyone can write and any client can implement:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[13px] text-foreground/60">
                <li><strong>Long-form content</strong> — articles, blogs, and wikis published to Nostr, owned by the author</li>
                <li><strong>Marketplace listings</strong> — buy and sell goods with Lightning, reputation tied to your key</li>
                <li><strong>Calendar events</strong> — decentralized event coordination (already live in Relay Outpost)</li>
                <li><strong>Live streaming</strong> — broadcasts with real-time zaps flowing from viewers to streamers</li>
                <li><strong>Music and audio</strong> — artists publishing directly to their audience, supported directly by their listeners</li>
                <li><strong>Encrypted group chat</strong> — private group messaging with the same cryptographic guarantees as DMs</li>
              </ul>
              <p className="text-[12px] text-foreground/50">The protocol grows organically. No product team decides what gets built — the community builds what it needs. That's why Nostr evolves faster than any corporate product roadmap.</p>
            </>
          }
        />

        <SectionCard
          number={6}
          title="Why This Is the Next Phase"
          icon={Globe}
          description={
            <>
              <p>The internet is going through a phase transition. The old model — centralized platforms controlling identity, content, and payments — is breaking down under its own weight:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[13px] text-foreground/60">
                <li><strong>AI makes content creation free</strong> — when anyone can generate unlimited text, images, and video, the scarce resource becomes trust and verification, not content</li>
                <li><strong>Data fragmentation accelerates</strong> — your digital life is scattered across 50+ platforms, each with their own login, each harvesting your data independently</li>
                <li><strong>Users are waking up</strong> — deplatforming, algorithmic manipulation, and data breaches are pushing mainstream users to seek alternatives</li>
              </ul>
              <p>Nostr and Bitcoin provide the two rails this new internet needs:</p>
              <div className="space-y-1.5 mt-2">
                <div className="rounded-lg bg-pink-500/[0.05] dark:bg-pink-500/[0.03] border border-pink-500/15 px-3 py-2">
                  <span className="text-pink-600 dark:text-pink-400 font-bold text-[11px]">Nostr: the identity and communication layer</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Verifiable identity, communication no single company can block, and data you can take anywhere — without any company in the middle.</p>
                </div>
                <div className="rounded-lg bg-amber-500/[0.05] dark:bg-amber-500/[0.03] border border-amber-500/15 px-3 py-2">
                  <span className="text-amber-600 dark:text-amber-400 font-bold text-[11px]">Bitcoin: the value transfer layer</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Instant, global payments anyone can send — from micropayments to major transactions, with no bank, no processor, and no borders.</p>
                </div>
              </div>
              <p className="text-[12px] text-foreground/50 mt-2">Together, they create an internet where you own your identity, control your data, communicate freely, and transact directly. That's not utopia — it's infrastructure. And it's being built right now.</p>
            </>
          }
        />
      </div>

      <div className="mt-10 mb-6">
        <div className="rounded-xl border border-border/30 dark:border-border/15 bg-gradient-to-br from-pink-500/[0.03] to-rose-500/[0.02] p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-pink-500/15 to-rose-500/10 border border-pink-500/15 flex items-center justify-center mx-auto mb-3">
            <Sparkles className="w-6 h-6 text-pink-500/60" />
          </div>
          <h3 className="text-sm font-bold text-foreground/80 mb-1">The future is being built now</h3>
          <p className="text-xs text-muted-foreground/50 max-w-sm mx-auto leading-relaxed mb-4">
            Every time you post, zap, or join an Outpost, you're using the infrastructure of the next internet. Not a prototype. Not a beta. The real thing — running on Nostr and Lightning, owned by nobody, available to everybody.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-pink-500/10 text-pink-600 dark:text-pink-400 border border-pink-500/20 text-xs font-medium transition-all duration-200 hover:bg-pink-500/15">
              Start Exploring
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
            <Link href="/help" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-muted/20 text-muted-foreground/70 border border-border/20 text-xs font-medium transition-all duration-200 hover:bg-muted/30">
              Back to Help &amp; Guides
            </Link>
          </div>
        </div>
      </div>

      <div className="border-t border-black/[0.06] dark:border-white/[0.04] mt-3 pt-4 pb-2 text-center">
        <p className="text-[10px] text-muted-foreground/30 font-medium uppercase tracking-wider">
          Relay Outpost — The Next Phase of the Internet
        </p>
      </div>
    </div>
  );
}
