import { Link } from "wouter";
import {
  Radio, Search, Users, PenLine, Settings,
  Shield, ChevronRight, Image as ImageIcon, Play, Globe,
  MessageCircle, Layers, Eye,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { WtfAlienIcon } from "@/components/icons/WtfAlienIcon";
import { OutpostIcon } from "@/components/icons/OutpostIcon";

import { StepCard } from "@/components/wtf/StepCard";

export default function SettingUpOutpost() {
  useDocumentTitle("Setting Up Your Community — Relay Outpost");

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
              Setting Up Your Community
            </h1>
            <p className="text-[10px] text-brand/40 dark:text-brand/30 font-bold uppercase tracking-[0.2em] mt-0.5 ml-0.5">build your home base</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-xl border border-border/30 dark:border-border/15 bg-white/50 dark:bg-muted/10 p-5">
          <p className="text-sm text-foreground/70 dark:text-muted-foreground leading-relaxed">
            A community is built around a relay — your crew's home base on the open social web. This guide walks you through discovering communities, joining your first Community, and making it your own. Whether you're looking for a niche interest group or building one from scratch, this is where it starts.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <OutpostIcon className="w-3.5 h-3.5 text-brand/70" />
            <span className="text-[11px] font-medium text-muted-foreground/60">Estimated time: 8 minutes</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <StepCard
          number={1}
          title="Discover Communities"
          icon={Search}
          description={
            <>
              <p>Communities spread person to person — you find them through people, not a catalog:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Open an <strong>invite link</strong> a friend sends you — that's the front door</li>
                <li>Tap a community on someone's <strong>profile</strong> (shared ones say "You're both here")</li>
                <li>Search a name or paste a relay address into the <strong>Communities</strong> page's search bar</li>
                <li>Preview a Community's timeline before joining</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Communities are built on relays — each one is its own independent community with its own culture and rules.</p>
            </>
          }
        />

        <StepCard
          number={2}
          title="Join Your First Community"
          icon={Users}
          description={
            <>
              <p>Found a community that resonates? Joining is one tap. Here's what happens:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Open the Community and tap <strong>Join</strong> in its header — private communities say <strong>Request</strong>, and the operator approves</li>
                <li>The relay is added to your relay list automatically</li>
                <li>You'll start seeing Community content in your feeds</li>
                <li>Your posts can now be broadcast to that community's relay</li>
              </ul>
              <p className="text-[12px] text-foreground/50">You can join as many Communities as you like — each one adds a new dimension to your network.</p>
            </>
          }
        />

        <StepCard
          number={3}
          title="Explore Community Sections"
          icon={Layers}
          description={
            <>
              <p>Every Community is more than just a feed. Each one comes with built-in sections designed for different types of interaction:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li><strong>Posts</strong> — The main feed of posts from community members</li>
                <li><strong>Discussions</strong> — Topic threads with upvotes, like a forum</li>
                <li><strong>Chat</strong> — Real-time group chat rooms for live conversation</li>
                <li><strong>Articles</strong> — The community's knowledge base and curated long-form reads</li>
                <li><strong>About</strong> — Community info, rules, and relay details</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Each section serves a different purpose — explore them all to get the full picture of your community.</p>
            </>
          }
        />

        <StepCard
          number={4}
          title="Post to Your Community"
          icon={PenLine}
          description={
            <>
              <p>Ready to contribute? When you're inside a Community, your posts are broadcast to that community's relay.</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Write a note in the Community's timeline — it goes to members of that relay</li>
                <li>Start a Wave to kick off a threaded discussion</li>
                <li>Drop into a Room for real-time chat</li>
                <li>Use #hashtags to help your posts get discovered</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Your content reaches the right people in the right context — no company deciding who sees it.</p>
            </>
          }
        />

        <StepCard
          number={5}
          title="Manage Your Relay Connection"
          icon={Settings}
          description={
            <>
              <p>Each Community is powered by a relay. Understanding your relay connection gives you more control:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>View your connected relays on the <strong>Relays</strong> page</li>
                <li>Set read/write preferences per relay</li>
                <li>Monitor relay health and connection status</li>
                <li>Remove or pause relay connections anytime</li>
              </ul>
              <p className="text-[12px] text-foreground/50">You're always in control of which relays you connect to — your data, your choice.</p>
            </>
          }
        />

        <StepCard
          number={6}
          title="Run Your Own Community (optional)"
          icon={Globe}
          description={
            <>
              <p>Most people simply <strong>join</strong> communities — that's the whole experience. But if you run a relay (or want to), you can host your own. <Link href="/help/relay-communities" className="text-brand underline underline-offset-2">Learn how relay communities work →</Link></p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Add your relay's address on the <strong>Communities</strong> page — it becomes your Community</li>
                <li>Open <strong>Manage</strong> inside your Community to configure it</li>
                <li>Set each room's name, description, and picture in <strong>Room settings</strong> — and its doors: <strong>Let people in one at a time</strong> and <strong>Members only</strong></li>
                <li>Invite members with <strong>Invite a friend</strong> and start building your community</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Running your own relay is the technical path — it gives you complete control over your community's data and moderation. No relay? Just join the communities you love.</p>
            </>
          }
        />

        <StepCard
          number={7}
          title="Use Relay Control"
          icon={Eye}
          description={
            <>
              <p>For relay operators, <strong>Relay Control</strong> is your command dashboard:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Monitor relay performance and connected users</li>
                <li>Manage access controls and moderation</li>
                <li>Review event logs and relay health metrics</li>
                <li>Configure relay settings and policies</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Relay Control gives operators full visibility into their relay — the backbone of their Community community.</p>
            </>
          }
        />
      </div>

      <div className="mt-10 mb-6">
        <div className="rounded-xl border border-border/30 dark:border-border/15 bg-gradient-to-br from-brand/[0.03] to-brand/[0.02] p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand/15 to-brand/10 border border-brand/15 flex items-center justify-center mx-auto mb-3">
            <OutpostIcon className="w-6 h-6 text-brand/60" />
          </div>
          <h3 className="text-sm font-bold text-foreground/80 mb-1">Your Community awaits</h3>
          <p className="text-xs text-muted-foreground/50 max-w-sm mx-auto leading-relaxed mb-4">
            Whether you're joining an existing community or building your own, Communities are where the open social web comes alive. Find your people, share your signal, build your home.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              href="/outposts"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand/10 text-brand border border-brand/20 text-xs font-medium transition-all duration-200 hover:bg-brand/15"
            >
              Browse Communities
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              href="/help"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-muted/20 text-muted-foreground/70 border border-border/20 text-xs font-medium transition-all duration-200 hover:bg-muted/30"
            >
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
