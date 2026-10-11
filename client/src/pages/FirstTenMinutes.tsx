import { Link } from "wouter";
import {
  Rocket, LogIn, UserCircle, Radio, PenLine,
  Zap, Shield, Image as ImageIcon, Play, ChevronRight,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { WtfAlienIcon } from "@/components/icons/WtfAlienIcon";

import { StepCard } from "@/components/wtf/StepCard";

export default function FirstTenMinutes() {
  useDocumentTitle("Your First 10 Minutes — Relay Outpost");

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
            <h1
              className="text-lg sm:text-xl font-black uppercase tracking-[0.06em] leading-none text-brand dark:text-brand/90"
              style={{ fontStyle: "italic" }}
            >
              Your First 10 Minutes
            </h1>
            <p className="text-[10px] text-brand/40 dark:text-brand/30 font-bold uppercase tracking-[0.2em] mt-0.5 ml-0.5">quick-start walkthrough</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-xl border border-border/30 dark:border-border/15 bg-white/50 dark:bg-muted/10 p-5">
          <p className="text-sm text-foreground/70 dark:text-muted-foreground leading-relaxed">
            Welcome to Relay Outpost. This guide walks you through everything you need to know in your first 10 minutes — from signing in to publishing your first post and exploring the network. No prior experience needed.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <Rocket className="w-3.5 h-3.5 text-emerald-500/70" />
            <span className="text-[11px] font-medium text-muted-foreground/60">Estimated time: 10 minutes</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <StepCard
          number={1}
          title="Sign In"
          icon={LogIn}
          description={
            <>
              <p>Tap <strong>Get Started</strong> on the landing screen. You have a few options:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li><strong>Create account</strong> — a new account in about thirty seconds. It starts in your space: your communities and the people you follow, nothing else, until you open the wider network. The last step is <strong>Save your key</strong>: save the file, then tap <strong>Check it works</strong>.</li>
                <li><strong>Signer app (QR)</strong> — On a phone, scan a QR code with a signer app like Amber. The most secure way in, and the one we suggest on mobile.</li>
                <li><strong>Browser Extension</strong> — On desktop with a key manager (like Alby or nos2x), this is the fastest way in.</li>
                <li><strong>Use existing account</strong> — paste the key from another app, the same one in your key file.</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Your key never leaves your device. You own your account, always.</p>
            </>
          }
        />

        <StepCard
          number={2}
          title="Set Up Your Profile"
          icon={UserCircle}
          description={
            <>
              <p>Open the <strong>Account</strong> page (your face, at the bottom of the bar) and tap <strong>Edit profile</strong>:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Add a display name and bio</li>
                <li>Upload a profile picture</li>
                <li>Set a Lightning address so people can zap you</li>
                <li>Add a verified username (optional, but adds credibility)</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Your profile lives on the relays you publish to — it works in any compatible app.</p>
            </>
          }
        />

        <StepCard
          number={3}
          title="Explore Your Feed & Follow People"
          icon={Radio}
          description={
            <>
              <p>Your home feed shows posts from people you follow across your connected relays. To start building your network:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Browse <strong>Discover</strong> and the <strong>For you</strong> feed to find interesting voices</li>
                <li>Follow people whose content resonates with you</li>
                <li>Check out Communities — relay-based communities built around shared interests</li>
              </ul>
              <p className="text-[12px] text-foreground/50">The more you follow, the richer your feed becomes. Quality over quantity — your Web of Trust will help filter the noise.</p>
            </>
          }
        />

        <StepCard
          number={4}
          title="Publish Your First Post"
          icon={PenLine}
          description={
            <>
              <p>Ready to broadcast? Tap the <strong>center button</strong> in the bottom bar and write your first note.</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Write a short introduction — tell the network who you are</li>
                <li>Add #hashtags to help others discover your post</li>
                <li>Attach images or media if you'd like</li>
                <li>Mention other people by typing @ and their name</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Your post will be broadcast to all your connected relays. No algorithms decide who sees it — it's out there for your network.</p>
            </>
          }
        />

        <StepCard
          number={5}
          title="Send Your First Zap"
          icon={Zap}
          description={
            <>
              <p>See a post you like? Zap it. Zaps are tiny, optional Bitcoin tips over Lightning — real appreciation instead of empty likes.</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Open the <strong>Account</strong> page → <strong>Wallet</strong> to connect your own wallet app (Alby, Coinos, Zeus, LNbits), or get an npub.cash address so people can tip you right away</li>
                <li>Tap the zap icon on any post</li>
                <li>Choose an amount and send</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Even a small zap carries more weight than a thousand likes. It's value-for-value — the economic engine of the open internet.</p>
            </>
          }
        />

        <StepCard
          number={6}
          title="Choose how careful"
          icon={Shield}
          description={
            <>
              <p>Trust &amp; safety decides how the app treats people you don't know, based on who you and your friends trust, not on a company's algorithm.</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Open the <strong>Account</strong> page → <strong>Trust &amp; safety</strong></li>
                <li>Pick <strong>Careful</strong>, <strong>Balanced</strong> or <strong>See everything</strong></li>
                <li>New accounts start on Balanced; the first time you open the wider network it goes to Careful</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Loosen it when you're ready. Pictures from people outside your space stay blurred until you tap them.</p>
            </>
          }
        />
      </div>

      <div className="mt-10 mb-6">
        <div className="rounded-xl border border-border/30 dark:border-border/15 bg-gradient-to-br from-emerald-500/[0.03] to-brand/[0.02] p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500/15 to-brand/10 border border-emerald-500/15 flex items-center justify-center mx-auto mb-3">
            <Rocket className="w-6 h-6 text-emerald-500/60" />
          </div>
          <h3 className="text-sm font-bold text-foreground/80 mb-1">You're all set</h3>
          <p className="text-xs text-muted-foreground/50 max-w-sm mx-auto leading-relaxed mb-4">
            That's the essentials. From here, explore Communities, set up Trust &amp; Safety, connect a wallet, and make Relay Outpost your home on the open social web.
          </p>
          <Link
            href="/help"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand/10 text-brand border border-brand/20 text-xs font-medium transition-all duration-200 hover:bg-brand/15"
          >
            Back to Help &amp; Guides
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
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
