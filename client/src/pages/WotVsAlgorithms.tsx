import { Link } from "wouter";
import {
  Shield, Brain, Users,
  ChevronRight, Image as ImageIcon, Play,
  Heart, Sparkles, Scale,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { WtfAlienIcon } from "@/components/icons/WtfAlienIcon";

import { StepCard as SectionCard } from "@/components/wtf/StepCard";

export default function WotVsAlgorithms() {
  useDocumentTitle("How Web of Trust Replaces Algorithms — Relay Outpost");

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
              Web of Trust vs. Algorithms
            </h1>
            <p className="text-[10px] text-brand/40 dark:text-brand/30 font-bold uppercase tracking-[0.2em] mt-0.5 ml-0.5">from corporate curation to community trust</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-xl border border-border/30 dark:border-border/15 bg-white/50 dark:bg-muted/10 p-5">
          <p className="text-sm text-foreground/70 dark:text-muted-foreground leading-relaxed">
            Every social platform you've ever used has one thing in common: a secret algorithm deciding what you see. These algorithms aren't designed to inform you or connect you — they're designed to keep you scrolling. Web of Trust is the alternative: instead of a corporation deciding what matters, your own network of trusted people does. Here's how it works and why it changes everything.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <Shield className="w-3.5 h-3.5 text-emerald-500/70" />
            <span className="text-[11px] font-medium text-muted-foreground/60">Deep dive · 9 minute read</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <SectionCard
          number={1}
          title="How Algorithms Actually Work (And Who They Serve)"
          icon={Brain}
          description={
            <>
              <p>Platform algorithms aren't neutral. They have one job: <strong>maximize the time you spend on the platform</strong> so the company can sell more ads. Here's how they do it:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[13px] text-foreground/60">
                <li><strong>Outrage gets boosted</strong> — content that makes you angry gets more engagement, so the algorithm feeds you more of it. Research repeatedly finds outrage spreads farther.</li>
                <li><strong>Your feed is curated for addiction</strong> — variable reward patterns (like slot machines) keep you pulling to refresh. The next post might be amazing. It usually isn't. You keep scrolling anyway.</li>
                <li><strong>Creator reach is throttled</strong> — platforms deliberately suppress organic reach to push creators toward paid promotion. Your followers asked to see your content — and the platform hides it behind a paywall.</li>
                <li><strong>Echo chambers by design</strong> — the algorithm feeds you more of what you engage with, creating feedback loops that narrow your worldview over time.</li>
              </ul>
              <p className="text-[12px] text-foreground/50">The algorithm's customer is the advertiser, not you. You are the product being optimized.</p>
            </>
          }
        />

        <SectionCard
          number={2}
          title="What Is Web of Trust?"
          icon={Users}
          description={
            <>
              <p>Web of Trust (WoT) is a completely different approach to filtering information. Instead of a company deciding what you see, <strong>your own network of trusted people decides</strong>:</p>
              <div className="space-y-1.5 mt-2">
                <div className="rounded-lg bg-muted/10 dark:bg-white/[0.03] border border-border/20 px-3 py-2">
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold text-xs">The Core Idea</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">You trust certain people. Those people trust certain people. Trust flows through the network like word-of-mouth recommendations — the same way humans have built trust for thousands of years.</p>
                </div>
                <div className="rounded-lg bg-muted/10 dark:bg-white/[0.03] border border-border/20 px-3 py-2">
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold text-xs">How It's Calculated</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Your follow list is the starting point. People you follow get high trust. People they follow get lower trust. People three hops away get even less. The math creates concentric circles of trust radiating outward from you.</p>
                </div>
                <div className="rounded-lg bg-muted/10 dark:bg-white/[0.03] border border-border/20 px-3 py-2">
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold text-xs">No Central Authority</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Every person's WoT is unique. There's no global "trust score" — your trust network is shaped by your choices and your community.</p>
                </div>
              </div>
            </>
          }
        />

        <SectionCard
          number={3}
          title="Algorithm vs. WoT: Side by Side"
          icon={Scale}
          description={
            <>
              <div className="space-y-2 mt-1">
                <div className="grid grid-cols-3 gap-2 text-[11px] font-bold text-muted-foreground/60 uppercase tracking-wider px-1">
                  <span></span>
                  <span className="text-red-500/60">Algorithm</span>
                  <span className="text-emerald-500/60">Web of Trust</span>
                </div>
                {[
                  ["Who decides?", "A corporation", "You"],
                  ["Optimizes for", "Engagement (time on site)", "Trust (people you know)"],
                  ["Spam handling", "AI moderation (misses a lot)", "Community filtering"],
                  ["Content ranking", "What gets clicks", "What your network values"],
                  ["Transparency", "Black box, proprietary", "Open, auditable by you"],
                  ["Your data", "Harvested and sold", "Stays with you"],
                  ["Switching cost", "Lose everything", "Take everything with you"],
                ].map(([label, algo, wot], i) => (
                  <div key={i} className="grid grid-cols-3 gap-2 rounded-lg bg-muted/10 dark:bg-white/[0.03] border border-border/15 px-3 py-2">
                    <span className="text-[12px] font-semibold text-foreground/70">{label}</span>
                    <span className="text-[11px] text-red-500/70">{algo}</span>
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400">{wot}</span>
                  </div>
                ))}
              </div>
            </>
          }
        />

        <SectionCard
          number={4}
          title="How WoT Kills Spam (Without Censorship)"
          icon={Shield}
          description={
            <>
              <p>One of the biggest challenges on any open network is spam and abuse. Centralized platforms solve this with content moderation teams and AI filters — and they still fail constantly. WoT takes a radically different approach:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[13px] text-foreground/60">
                <li><strong>No trust score = invisible</strong> — if nobody in your extended network follows a spammer, their content simply doesn't appear in your feed. No ban needed.</li>
                <li><strong>Trust must be earned</strong> — new accounts start with zero trust. They become visible as real people in the network follow them. This is how real-world trust works too.</li>
                <li><strong>Bots can't fake it</strong> — a bot can create a million accounts, but none of them will have legitimate trust connections. WoT pushes them out of your feed.</li>
                <li><strong>Nobody is censored</strong> — spammers can still post. Their content still exists on relays. It just never reaches people who didn't ask for it. The difference: filtering at the edges (your choice) vs. filtering at the center (their choice).</li>
              </ul>
              <p className="text-[12px] text-foreground/50">WoT doesn't decide what's "allowed" — it lets you decide who's worth listening to. The result is the same (less spam), but the power dynamic is completely different.</p>
            </>
          }
        />

        <SectionCard
          number={5}
          title="Trust & Safety: WoT In Action"
          icon={Sparkles}
          description={
            <>
              <p>In Relay Outpost, <strong>Trust &amp; Safety</strong> is where your Web of Trust comes to life. It's your personal trust control center:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[13px] text-foreground/60">
                <li><strong>Trust tiers</strong> — people are organized into tiers based on how closely connected they are to your network. Highly Trusted is your inner circle; Low Trust is the far edge of your reach.</li>
                <li><strong>Adjustable reach</strong> — you control how many hops outward your trust extends. Tighter reach = less noise. Wider reach = more discovery.</li>
                <li><strong>Visual indicators</strong> — color-coded trust dots appear next to every profile, so you can instantly see how someone connects to your network.</li>
                <li><strong>Feed filtering</strong> — toggle WoT filtering on your feed to only see content from people within your trust network. Or turn it off for full discovery mode.</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Trust &amp; Safety gives you the controls that algorithms hide from you. Every knob and lever is transparent, adjustable, and under your control.</p>
            </>
          }
        />

        <SectionCard
          number={6}
          title="Why This Is the Future"
          icon={Heart}
          description={
            <>
              <p>As AI-generated content floods the internet and deepfakes become indistinguishable from reality, the question shifts from "what is true?" to <strong>"who do I trust?"</strong></p>
              <p>That's exactly the question WoT is built to answer:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[13px] text-foreground/60">
                <li><strong>AI can't forge trust</strong> — generating content is cheap, but building genuine social connections over time is something only real humans do</li>
                <li><strong>Verification through relationships</strong> — in a world where you can't trust content at face value, knowing who created it (and whether your network trusts them) becomes the only reliable signal</li>
                <li><strong>Scales without a company</strong> — WoT works without any central authority. It scales the same way human trust has always scaled: through networks of personal connections</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Algorithms were the answer to an old internet. WoT is the answer to the internet we're entering now — one where trust, not engagement, is the most valuable signal.</p>
            </>
          }
        />
      </div>

      <div className="mt-10 mb-6">
        <div className="rounded-xl border border-border/30 dark:border-border/15 bg-gradient-to-br from-emerald-500/[0.03] to-teal-500/[0.02] p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500/15 to-teal-500/10 border border-emerald-500/15 flex items-center justify-center mx-auto mb-3">
            <Shield className="w-6 h-6 text-emerald-500/60" />
          </div>
          <h3 className="text-sm font-bold text-foreground/80 mb-1">Trust over engagement</h3>
          <p className="text-xs text-muted-foreground/50 max-w-sm mx-auto leading-relaxed mb-4">
            Algorithms optimize for the platform's bottom line. WoT optimizes for what actually matters to you — the people you know, respect, and choose to listen to.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/shield-matrix" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-medium transition-all duration-200 hover:bg-emerald-500/15">
              Open Trust &amp; Safety
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
