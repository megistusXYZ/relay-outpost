import { publicPageTitle } from "@shared/public-pages";
import { Link } from "wouter";
import {
  Rocket,
  Users,
  Lock,
  ChevronRight,
  Building2,
  Globe,
  Crown,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { OttoMark } from "@/components/OttoMark";

import { StepCard as SectionCard } from "@/components/wtf/StepCard";

export default function RelayCommunities() {
  useDocumentTitle(publicPageTitle("/help/relay-communities"));

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-in fade-in duration-150">
      <div className="flex items-center gap-3 mb-1">
        {/* Chrome back owns the route (back-affordance.ts) — no hero dupe. */}
        <div className="flex items-center gap-2">
          <OttoMark size={40} label="Relay" className="shrink-0 text-foreground !w-9 !h-9 sm:!w-10 sm:!h-10" />
          <div>
            <h1 className="text-[24px] sm:text-[30px] font-semibold tracking-[-0.025em] leading-[1.1] text-foreground">
              Relay communities vs. platforms
            </h1>
            <p className="text-[14px] sm:text-[15px] text-muted-foreground mt-1">Why communities are the future</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-[20px] border border-border/60 bg-card p-5">
          <p className="text-[15px] text-foreground leading-relaxed">
            Every online community you've joined has the same fundamental flaw: it exists at the mercy of a company. Discord can ban your server. Reddit can quarantine your subreddit. Facebook can delete your group. You built the community — they own it. Communities flip this model entirely. Here's why relay-based communities are the future of how people organize online.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <Rocket className="w-3.5 h-3.5 text-foreground" />
            <span className="text-[12px] font-medium text-muted-foreground">Deep dive · 9 minute read</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <SectionCard
          number={1}
          title="The platform community trap"
          icon={Building2}
          description={
            <>
              <p>You've probably experienced this cycle before:</p>
              <ol className="list-decimal list-inside space-y-1.5 text-[14px] text-foreground">
                <li><strong>A platform launches</strong> — it's open, creator-friendly, and growing fast. Early users build vibrant communities.</li>
                <li><strong>The platform grows</strong> — more users, more features, everything feels like it's working.</li>
                <li><strong>Monetization starts</strong> — the company needs to make money. Ads appear. Organic reach drops. Premium features get paywalled.</li>
                <li><strong>Enshittification begins</strong> — the platform starts optimizing for advertisers over users. Quality declines. Power users leave. But your community is trapped there.</li>
              </ol>
              <p className="text-[12px] text-muted-foreground">This isn't a bug — it's the inevitable lifecycle of every venture-funded platform. The users who built the community have zero leverage because they can't take their community elsewhere.</p>
            </>
          }
        />

        <SectionCard
          number={2}
          title="What makes communities different"
          icon={Rocket}
          description={
            <>
              <p>A Community is a community built on a relay — a server that stores and forwards Nostr messages. Here's what makes it fundamentally different from a Discord server or a subreddit:</p>
              <div className="space-y-1.5 mt-2">
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[14px]">Community-Owned infrastructure</span>
                  <p className="text-[12px] text-foreground mt-0.5">The relay can be run by anyone — the community leader, a member, or a dedicated operator. No corporation sits between the community and its data.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[14px]">Portable members</span>
                  <p className="text-[12px] text-foreground mt-0.5">Members bring their identity (their Nostr key) from anywhere. They don't create a new account for your community — they connect with the identity they already have.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[14px]">Cross-App visibility</span>
                  <p className="text-[12px] text-foreground mt-0.5">Posts to a Community are visible from any Nostr client that supports relay communities — not locked to one app. Your community content lives on the open network.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[14px]">No lock-In by design</span>
                  <p className="text-[12px] text-foreground mt-0.5">No company owns the protocol. The relay operator sets the rules — and if they go bad, the community can move to another relay, and everyone's identity and connections survive the move.</p>
                </div>
              </div>
            </>
          }
        />

        <SectionCard
          number={3}
          title="Platform vs. community: the real differences"
          icon={Globe}
          description={
            <>
              <div className="space-y-2 mt-1">
                {[
                  ["If the platform shuts down", "Your community is gone forever", "Switch to another relay — your identity and connections persist"],
                  ["Content moderation", "One company's rules, applied globally", "Each relay sets its own rules — join ones that align with your values"],
                  ["Revenue model", "Ads, data harvesting, premium upsells", "Voluntary contributions and optional zaps"],
                  ["Member identity", "Platform-specific account (lost if banned)", "Cryptographic key (can't be taken away)"],
                  ["Data export", "Limited, often incomplete, changes at whim", "Your data is on relays you can read directly — it's never locked in"],
                ].map(([scenario, platform, outpost], i) => (
                  <div key={i} className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2.5">
                    <p className="text-[12px] font-bold text-foreground mb-1.5">{scenario}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex items-start gap-1.5">
                        <span className="text-[12px] font-bold text-danger shrink-0 mt-0.5">Platform</span>
                        <span className="text-[12px] text-foreground">{platform}</span>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <span className="text-[12px] font-bold text-success shrink-0 mt-0.5">Community</span>
                        <span className="text-[12px] text-success">{outpost}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          }
        />

        <SectionCard
          number={4}
          title="How community access works"
          icon={Lock}
          description={
            <>
              <p>Communities support different access models — from wide-open public spaces to invite-only communities:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[14px] text-foreground">
                <li><strong>Public Communities</strong> — anyone can join and post. Great for broad communities, open discussions, and growing your reach.</li>
                <li><strong>Approval joins</strong> — the <em>Let people in one at a time</em> door means new members wait for a yes. Joining one of these shows <strong>Request</strong> instead of Join.</li>
                <li><strong>Members only</strong> — a separate door that makes the space's rooms readable by members alone. A space can use either door, or both.</li>
                <li><strong>Paid relays</strong> — some relays advertise a payment requirement (shown as Paid in search results). Payment is arranged with the operator directly today.</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Admins set each room's doors in <strong>Room settings</strong>, and the relay itself enforces them — the people accountable to the community, not to shareholders.</p>
            </>
          }
        />

        <SectionCard
          number={5}
          title="For businesses: why this matters"
          icon={Crown}
          description={
            <>
              <p>If you run a business, the implications are huge. Every business that built on a platform learned this lesson the hard way:</p>
              <div className="space-y-1.5 mt-2">
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">Customer relationships are yours</span>
                  <p className="text-[12px] text-foreground mt-0.5">Your customer community exists on infrastructure you control. No platform can throttle your reach or force you to pay for access to your own audience.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">Direct support</span>
                  <p className="text-[12px] text-foreground mt-0.5">Customers can support you directly, with nothing skimmed off in between — every contribution goes 100% to you.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <span className="text-foreground font-semibold text-[13px]">Verifiable identity</span>
                  <p className="text-[12px] text-foreground mt-0.5">Your business identity is a cryptographic key. Customers can verify that announcements actually came from you — not from a scammer impersonating your brand.</p>
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground">Communities give businesses the direct relationship with customers that platforms have been intermediating (and taxing) for the last 15 years.</p>
            </>
          }
        />

        <SectionCard
          number={6}
          title="The future of online communities"
          icon={Users}
          description={
            <>
              <p>We're watching a fundamental shift in how communities organize online:</p>
              <ul className="list-disc list-inside space-y-1.5 text-[14px] text-foreground">
                <li><strong>Communities as infrastructure</strong> — instead of renting space on a platform, communities own their own relay. The infrastructure belongs to the people who use it.</li>
                <li><strong>Interoperable by default</strong> — a member of one Community can seamlessly interact with another. No more siloed communities trapped inside separate apps.</li>
                <li><strong>Value flows to creators</strong> — zaps let community members directly support the people creating value. No ads. No sponsorships. 100% goes to them.</li>
                <li><strong>AI can't fake belonging</strong> — in a world flooding with AI-generated content, real communities with real trust networks become the most valuable signal of authenticity.</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Communities aren't a new Discord or a new Reddit. They're a new model — one where the community's interests and the infrastructure's incentives are finally aligned.</p>
            </>
          }
        />
      </div>

      <div className="mt-10 mb-6">
        <div className="rounded-[20px] border border-border/60 bg-card p-6 text-center">
          <div className="w-12 h-12 rounded-full dark:bg-foreground/[0.05] flex items-center justify-center mx-auto mb-3">
            <Rocket className="w-6 h-6 text-foreground" />
          </div>
          <h3 className="text-[17px] font-semibold text-foreground mb-1">Communities with no lock-in</h3>
          <p className="text-[14px] text-muted-foreground max-w-sm mx-auto leading-relaxed mb-5">
            Communities put community ownership where it belongs — with the community. If a server disappears, your identity and connections survive — move to another relay and keep going. No algorithm can hide your voice.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/outposts" className="inline-flex items-center gap-1.5 h-11 px-5 rounded-full whitespace-nowrap bg-foreground text-background text-[15px] font-medium hover:bg-foreground/90 active:scale-[0.98] transition">
              Explore Communities
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
