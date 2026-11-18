import { Link } from "wouter";
import {
  Shield,
  Brain,
  Users,
  ChevronRight,
  Heart,
  Sparkles,
  Scale,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { OttoMark } from "@/components/OttoMark";

import { StepCard as SectionCard } from "@/components/wtf/StepCard";

export default function WotVsAlgorithms() {
  useDocumentTitle("Web of Trust vs. algorithms — Relay Outpost");

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-in fade-in duration-150">
      <div className="flex items-center gap-3 mb-1">
        {/* Chrome back owns the route (back-affordance.ts) — no hero dupe. */}
        <div className="flex items-center gap-2">
          <OttoMark size={40} label="Relay" className="shrink-0 text-foreground !w-9 !h-9 sm:!w-10 sm:!h-10" />
          <div>
            <h1 className="text-[24px] sm:text-[30px] font-semibold tracking-[-0.025em] leading-[1.1] text-foreground">
              Web of Trust vs. algorithms
            </h1>
            <p className="text-[14px] sm:text-[15px] text-muted-foreground mt-1">From corporate curation to community trust</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-[20px] border border-border/60 bg-card p-5">
          <p className="text-[15px] text-foreground/75 leading-relaxed">
            Every social platform you've ever used has one thing in common: a secret algorithm deciding what you see. These algorithms aren't designed to inform you or connect you — they're designed to keep you scrolling. Web of Trust is the alternative: instead of a corporation deciding what matters, your own network of trusted people does. Here's how it works and why it changes everything.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <Shield className="w-3.5 h-3.5 text-success" />
            <span className="text-[12px] font-medium text-muted-foreground">Deep dive · 9 minute read</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <SectionCard
          number={1}
          title="How algorithms actually work (and who they serve)"
          icon={Brain}
          description={
            <>
              <p>Platform algorithms aren't neutral. They have one job: <strong>maximize the time you spend on the platform</strong> so the company can sell more ads. Here's how they do it:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[14px] text-foreground/70">
                <li><strong>Outrage gets boosted</strong> — content that makes you angry gets more engagement, so the algorithm feeds you more of it. Research repeatedly finds outrage spreads farther.</li>
                <li><strong>Your feed is curated for addiction</strong> — variable reward patterns (like slot machines) keep you pulling to refresh. The next post might be amazing. It usually isn't. You keep scrolling anyway.</li>
                <li><strong>Creator reach is throttled</strong> — platforms deliberately suppress organic reach to push creators toward paid promotion. Your followers asked to see your content — and the platform hides it behind a paywall.</li>
                <li><strong>Echo chambers by design</strong> — the algorithm feeds you more of what you engage with, creating feedback loops that narrow your worldview over time.</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">The algorithm's customer is the advertiser, not you. You are the product being optimized.</p>
            </>
          }
        />

        <SectionCard
          number={2}
          title="What is Web of Trust?"
          icon={Users}
          description={
            <>
              <p>Web of Trust is a completely different approach to filtering information. Instead of a company deciding what you see, <strong>your own network of trusted people decides</strong>:</p>
              <div className="space-y-1.5 mt-2">
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">The core idea</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">You trust certain people. Those people trust certain people. Trust flows through the network like word-of-mouth recommendations — the same way humans have built trust for thousands of years.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">How it's calculated</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Your follow list is the starting point. People you follow get high trust. People they follow get lower trust. Friends of friends of friends get even less. The math creates concentric circles of trust radiating outward from you.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">No central authority</span>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Every person's Web of Trust is unique. There's no global "trust score" — your trust network is shaped by your choices and your community.</p>
                </div>
              </div>
            </>
          }
        />

        <SectionCard
          number={3}
          title="Algorithm vs. Web of Trust: side by side"
          icon={Scale}
          description={
            <>
              <div className="space-y-2 mt-1">
                <div className="grid grid-cols-3 gap-2 text-[12px] font-bold text-muted-foreground px-1">
                  <span></span>
                  <span className="text-danger">Algorithm</span>
                  <span className="text-success">Web of Trust</span>
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
                  <div key={i} className="grid grid-cols-3 gap-2 rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                    <span className="text-[12px] font-semibold text-foreground/70">{label}</span>
                    <span className="text-[12px] text-danger">{algo}</span>
                    <span className="text-[12px] text-success">{wot}</span>
                  </div>
                ))}
              </div>
            </>
          }
        />

        <SectionCard
          number={4}
          title="How Web of Trust kills spam (without censorship)"
          icon={Shield}
          description={
            <>
              <p>One of the biggest challenges on any open network is spam and abuse. Centralized platforms solve this with content moderation teams and AI filters — and they still fail constantly. Web of Trust takes a radically different approach:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[14px] text-foreground/70">
                <li><strong>No trust score = invisible</strong> — if nobody in your extended network follows a spammer, their content simply doesn't appear in your feed. No ban needed.</li>
                <li><strong>Trust must be earned</strong> — new accounts start with zero trust. They become visible as real people in the network follow them. This is how real-world trust works too.</li>
                <li><strong>Bots can't fake it</strong> — a bot can create a million accounts, but none of them will have legitimate trust connections. Web of Trust pushes them out of your feed.</li>
                <li><strong>Nobody is censored</strong> — spammers can still post. Their content still exists on relays. It just never reaches people who didn't ask for it. The difference: filtering at the edges (your choice) vs. filtering at the center (their choice).</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Web of Trust doesn't decide what's "allowed" — it lets you decide who's worth listening to. The result is the same (less spam), but the power dynamic is completely different.</p>
            </>
          }
        />

        <SectionCard
          number={5}
          title="Trust & safety: it in action"
          icon={Sparkles}
          description={
            <>
              <p>In Relay Outpost, <strong>Trust &amp; safety</strong> is where your Web of Trust comes to life. It's your personal trust control center:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[14px] text-foreground/70">
                <li><strong>Trust tiers</strong> — people are organized into tiers based on how closely connected they are to your network. Highly Trusted is your inner circle; Low Trust is the far edge of your reach.</li>
                <li><strong>Adjustable</strong> — <strong>Careful</strong>, <strong>Balanced</strong> or <strong>See everything</strong>, in Trust &amp; safety. Tighter means less noise; wider means more discovery.</li>
                <li><strong>Visual indicators</strong> — color-coded trust dots appear next to every profile, so you can instantly see how someone connects to your network.</li>
                <li><strong>Feed filtering</strong> — choose how careful to be in Trust &amp; safety, so you only see people within your trust network. Or turn it off for full discovery mode.</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Trust &amp; safety gives you the controls that algorithms hide from you. Every knob and lever is transparent, adjustable, and under your control.</p>
            </>
          }
        />

        <SectionCard
          number={6}
          title="Why this is the future"
          icon={Heart}
          description={
            <>
              <p>As AI-generated content floods the internet and deepfakes become indistinguishable from reality, the question shifts from "what is true?" to <strong>"who do I trust?"</strong></p>
              <p>That's exactly the question Web of Trust is built to answer:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[14px] text-foreground/70">
                <li><strong>AI can't forge trust</strong> — generating content is cheap, but building genuine social connections over time is something only real humans do</li>
                <li><strong>Verification through relationships</strong> — in a world where you can't trust content at face value, knowing who created it (and whether your network trusts them) becomes the only reliable signal</li>
                <li><strong>Scales without a company</strong> — Web of Trust works without any central authority. It scales the same way human trust has always scaled: through networks of personal connections</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Algorithms were the answer to an old internet. Web of Trust is the answer to the internet we're entering now — one where trust, not engagement, is the most valuable signal.</p>
            </>
          }
        />
      </div>

      <div className="mt-10 mb-6">
        <div className="rounded-[20px] border border-border/60 bg-card p-6 text-center">
          <div className="w-12 h-12 rounded-full dark:bg-foreground/[0.05] flex items-center justify-center mx-auto mb-3">
            <Shield className="w-6 h-6 text-foreground/75" />
          </div>
          <h3 className="text-[17px] font-semibold text-foreground mb-1">Trust over engagement</h3>
          <p className="text-[14px] text-muted-foreground max-w-sm mx-auto leading-relaxed mb-5">
            Algorithms optimize for the platform's bottom line. Web of Trust optimizes for what actually matters to you — the people you know, respect, and choose to listen to.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/shield-matrix" className="inline-flex items-center gap-1.5 h-11 px-5 rounded-full whitespace-nowrap bg-foreground text-background text-[15px] font-medium hover:bg-foreground/90 active:scale-[0.98] transition-colors duration-150">
              Open Trust &amp; Safety
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
