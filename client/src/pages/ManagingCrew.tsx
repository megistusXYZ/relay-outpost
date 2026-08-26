import { Link } from "wouter";
import {
  Users, UserPlus, Shield,
  ChevronRight, Image as ImageIcon, Play, Search,
  TrendingUp, Layers,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { WtfAlienIcon } from "@/components/icons/WtfAlienIcon";

import { StepCard } from "@/components/wtf/StepCard";

export default function ManagingCrew() {
  useDocumentTitle("Managing Your Crew & Orbit — Relay Outpost");

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
              Managing Your Crew & Orbit
            </h1>
            <p className="text-[10px] text-brand/40 dark:text-brand/30 font-bold uppercase tracking-[0.2em] mt-0.5 ml-0.5">your social graph</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-xl border border-border/30 dark:border-border/15 bg-white/50 dark:bg-muted/10 p-5">
          <p className="text-sm text-foreground/70 dark:text-muted-foreground leading-relaxed">
            Who you follow is more than a list — it shapes your whole experience. It decides what's in your feed, who your circle of trust vouches for, and the communities you're part of. This guide covers how following works, how your crew is organized, and how trust-aware sorting brings the best people to the surface.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <Users className="w-3.5 h-3.5 text-brand/70" />
            <span className="text-[11px] font-medium text-muted-foreground/60">Estimated time: 7 minutes</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <StepCard
          number={1}
          title="Following & Your Contact List"
          icon={UserPlus}
          description={
            <>
              <p>Following someone adds them to your <strong>follow list</strong> — saved to your relays so it goes everywhere you do:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Your follow list is portable — it moves with you across every Nostr app</li>
                <li>Following someone adds their posts to your home feed</li>
                <li>Your follow list is public — other users can see who you follow</li>
                <li>Unfollow anytime — the updated list is republished to your relays</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Unlike centralized platforms, your follow list belongs to you. No algorithm hides or promotes accounts — you see exactly who you follow.</p>
            </>
          }
        />

        <StepCard
          number={2}
          title="Your Following & Followers"
          icon={Users}
          description={
            <>
              <p>Your social connections live on the <strong>Network</strong> tab of your account:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li><strong>Following</strong> — Everyone you follow, with their profiles and trust level</li>
                <li><strong>Followers</strong> — People who follow you, with trust indicators</li>
                <li>Both views support search and filtering to find specific people</li>
                <li>A trust level is shown next to each person so you can see at a glance how connected they are to your circle</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Your following page is your crew. Your followers page is your orbit. Together, they're your network.</p>
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
                <div className="rounded-lg bg-muted/10 dark:bg-white/[0.03] border border-border/20 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-brand font-bold text-xs">Trust Tiers</span>
                  </div>
                  <p className="text-[12px] text-foreground/60 mt-0.5">People are grouped by trust level — from your closest, most-trusted connections to the broader network. Higher tiers appear first.</p>
                </div>
                <div className="rounded-lg bg-muted/10 dark:bg-white/[0.03] border border-border/20 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-brand font-bold text-xs">Trust Dots</span>
                  </div>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Color-coded dots next to profiles indicate their trust tier at a glance — making it easy to distinguish your inner circle from the wider orbit.</p>
                </div>
              </div>
              <p className="text-[12px] text-foreground/50">Trust sorting means the people closest to your circle surface first — no algorithm deciding who's "important."</p>
            </>
          }
        />

        <StepCard
          number={4}
          title="How Your Social Graph Shapes Your Feed"
          icon={TrendingUp}
          description={
            <>
              <p>Your follow list and trust levels directly influence what you see in your feed:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li><strong>Home feed</strong> — Posts from people you follow, ordered by time</li>
                <li><strong>Trust filtering</strong> — When enabled, Trust &amp; Safety hides content from untrusted accounts</li>
                <li><strong>Replies and interactions</strong> — Trust scores help surface meaningful replies over spam</li>
                <li><strong>Outpost feeds</strong> — Community posts are enriched with trust context from your network</li>
              </ul>
              <p className="text-[12px] text-foreground/50">The more intentionally you curate your follows, the better your feed becomes. Quality in, quality out.</p>
            </>
          }
        />

        <StepCard
          number={5}
          title="Discovering New People"
          icon={Search}
          description={
            <>
              <p>Growing your network is easy — and trust-aware:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Use <strong>Search</strong> to find people by name or verified username</li>
                <li>Browse profiles in Outpost communities to find aligned voices</li>
                <li>Check someone's followers and following to discover mutual connections</li>
                <li>Trust indicators show you how someone connects to your circle before you follow them</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Following someone new extends your circle of trust — their connections become part of your wider network.</p>
            </>
          }
        />

        <StepCard
          number={6}
          title="The Trust & Safety Connection"
          icon={Layers}
          description={
            <>
              <p>Your social graph feeds directly into Trust &amp; Safety — your Web of Trust control center:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>People you follow form the foundation of your trust network</li>
                <li>Their follows extend trust outward (configurable reach depth)</li>
                <li>Trust tiers are calculated based on how many hops away someone is</li>
                <li>You can adjust reach depth and tier thresholds in Trust &amp; Safety</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Think of it as concentric circles — your follows are the inner ring, their follows are the next ring, and so on. Trust &amp; Safety lets you decide how many rings to include.</p>
            </>
          }
        />
      </div>

      <div className="mt-10 mb-6">
        <div className="rounded-xl border border-border/30 dark:border-border/15 bg-gradient-to-br from-brand/[0.03] to-brand/[0.02] p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand/15 to-brand/10 border border-brand/15 flex items-center justify-center mx-auto mb-3">
            <Users className="w-6 h-6 text-brand/60" />
          </div>
          <h3 className="text-sm font-bold text-foreground/80 mb-1">Your network, your rules</h3>
          <p className="text-xs text-muted-foreground/50 max-w-sm mx-auto leading-relaxed mb-4">
            On Nostr, your social graph is yours. You own it, you control it, and it travels with you everywhere. Build intentionally — every follow strengthens your signal.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/account?tab=crew" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand/10 text-brand border border-brand/20 text-xs font-medium transition-all duration-200 hover:bg-brand/15">
              View Your Crew
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
