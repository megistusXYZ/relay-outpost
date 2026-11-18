import { Link } from "wouter";
import {
  Users,
  UserPlus,
  Shield,
  ChevronRight,
  Search,
  TrendingUp,
  Layers,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { OttoMark } from "@/components/OttoMark";

import { StepCard } from "@/components/wtf/StepCard";

export default function ManagingCrew() {
  useDocumentTitle("Your people — Relay Outpost");

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-in fade-in duration-150">
      <div className="flex items-center gap-3 mb-1">
        {/* Chrome back owns the route (back-affordance.ts) — no hero dupe. */}
        <div className="flex items-center gap-2">
          <OttoMark size={40} label="Otto" className="shrink-0 text-foreground !w-9 !h-9 sm:!w-10 sm:!h-10" />
          <div>
            <h1 className="text-[24px] sm:text-[30px] font-semibold tracking-[-0.025em] leading-[1.1] text-foreground">
              Your people
            </h1>
            <p className="text-[14px] sm:text-[15px] text-muted-foreground mt-1">Who you follow, who follows you</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-[20px] border border-border/60 bg-card p-5">
          <p className="text-[15px] text-foreground/75 leading-relaxed">
            Who you follow is more than a list — it shapes your whole experience. It decides what's in your feed, who your circle of trust vouches for, and the communities you're part of. This guide covers how following works, how your crew is organized, and how trust-aware sorting brings the best people to the surface.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <Users className="w-3.5 h-3.5 text-foreground/70" />
            <span className="text-[12px] font-medium text-muted-foreground">Estimated time: 7 minutes</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <StepCard
          number={1}
          title="Following & your contact list"
          icon={UserPlus}
          description={
            <>
              <p>Following someone adds them to your <strong>follow list</strong> — saved to your relays so it goes everywhere you do:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li>Your follow list is portable — it moves with you across every Nostr app</li>
                <li>Following someone adds their posts to your home feed</li>
                <li>Your follow list is public — other users can see who you follow</li>
                <li>Unfollow anytime — the updated list is republished to your relays</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Unlike centralized platforms, your follow list belongs to you. No algorithm hides or promotes accounts — you see exactly who you follow.</p>
            </>
          }
        />

        <StepCard
          number={2}
          title="Your following & followers"
          icon={Users}
          description={
            <>
              <p>Your social connections live on the <strong>Network</strong> tab of your account:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li><strong>Following</strong> — Everyone you follow, with their profiles and trust level</li>
                <li><strong>Followers</strong> — People who follow you, with trust indicators</li>
                <li>Both views support search and filtering to find specific people</li>
                <li>A trust level is shown next to each person so you can see at a glance how connected they are to your circle</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Your following page lists the people you follow. Your followers page lists who follows you. Together, they're your network.</p>
            </>
          }
        />

        <StepCard
          number={3}
          title="Trust-aware sorting"
          icon={Shield}
          description={
            <>
              <p>Relay Outpost doesn't just list your connections — it sorts them by trust, based on how connected each person is to your circle:</p>
              <div className="space-y-1.5 mt-2">
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground font-semibold text-[14px]">Trust tiers</span>
                  </div>
                  <p className="text-[12px] text-foreground/60 mt-0.5">People are grouped by trust level — from your closest, most-trusted connections to the broader network. Higher tiers appear first.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground font-semibold text-[14px]">Trust dots</span>
                  </div>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Color-coded dots next to profiles indicate their trust tier at a glance — making it easy to tell your inner circle from the wider network.</p>
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground">Trust sorting means the people closest to your circle surface first — no algorithm deciding who's "important."</p>
            </>
          }
        />

        <StepCard
          number={4}
          title="How your social graph shapes your feed"
          icon={TrendingUp}
          description={
            <>
              <p>Your follow list and trust levels directly influence what you see in your feed:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li><strong>Home feed</strong> — Posts from people you follow, ordered by time</li>
                <li><strong>Trust filtering</strong> — When enabled, Trust &amp; safety hides content from untrusted accounts</li>
                <li><strong>Replies and interactions</strong> — Trust scores help surface meaningful replies over spam</li>
                <li><strong>Community feeds</strong> — Community posts are enriched with trust context from your network</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">The more intentionally you curate your follows, the better your feed becomes. Quality in, quality out.</p>
            </>
          }
        />

        <StepCard
          number={5}
          title="Discovering new people"
          icon={Search}
          description={
            <>
              <p>Growing your network is easy — and trust-aware:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li>Use <strong>Search</strong> to find people by name or verified username</li>
                <li>Browse profiles in your communities to find people worth hearing from</li>
                <li>Check someone's followers and following to discover mutual connections</li>
                <li>Trust indicators show you how someone connects to your circle before you follow them</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Following someone new extends your circle of trust — their connections become part of your wider network.</p>
            </>
          }
        />

        <StepCard
          number={6}
          title="The Trust & safety connection"
          icon={Layers}
          description={
            <>
              <p>Your social graph feeds directly into Trust &amp; safety, where you choose how careful to be:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li>People you follow form the foundation of your trust network</li>
                <li>The people they follow count for a little less: friends of friends</li>
                <li>A stranger is someone nobody in that circle vouches for</li>
                <li>How strict that is comes down to one choice in Trust &amp; safety: <strong>Careful</strong>, <strong>Balanced</strong> or <strong>See everything</strong></li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Think of it as rings: the people you follow are the inner ring, their people the next, and so on. Your choice in Trust &amp; safety is how many rings get in.</p>
            </>
          }
        />
      </div>

      <div className="mt-10 mb-6">
        <div className="rounded-[20px] border border-border/60 bg-card p-6 text-center">
          <div className="w-12 h-12 rounded-full dark:bg-foreground/[0.05] flex items-center justify-center mx-auto mb-3">
            <Users className="w-6 h-6 text-foreground/75" />
          </div>
          <h3 className="text-[17px] font-semibold text-foreground mb-1">Your network, your rules</h3>
          <p className="text-[14px] text-muted-foreground max-w-sm mx-auto leading-relaxed mb-5">
            On Nostr, your social graph is yours. You own it, you control it, and it travels with you everywhere. Build intentionally — every follow shapes what you see.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/account?tab=crew" className="inline-flex items-center gap-1.5 h-11 px-5 rounded-full whitespace-nowrap bg-foreground text-background text-[15px] font-medium hover:bg-foreground/90 active:scale-[0.98] transition">
              See who you follow
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
