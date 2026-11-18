import { Link } from "wouter";
import {
  Search,
  Users,
  PenLine,
  Settings,
  ChevronRight,
  Globe,
  Layers,
  Eye,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { OttoMark } from "@/components/OttoMark";
import { OutpostIcon } from "@/components/icons/OutpostIcon";

import { StepCard } from "@/components/wtf/StepCard";

export default function SettingUpOutpost() {
  useDocumentTitle("Setting up your community — Relay Outpost");

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-in fade-in duration-150">
      <div className="flex items-center gap-3 mb-1">
        {/* Chrome back owns the route (back-affordance.ts) — no hero dupe. */}
        <div className="flex items-center gap-2">
          <OttoMark size={40} label="Relay" className="shrink-0 text-foreground !w-9 !h-9 sm:!w-10 sm:!h-10" />
          <div>
            <h1
              className="text-[24px] sm:text-[30px] font-semibold tracking-[-0.025em] leading-[1.1] text-foreground"
            >
              Setting up your community
            </h1>
            <p className="text-[14px] sm:text-[15px] text-muted-foreground mt-1">Your people, your place</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-[20px] border border-border/60 bg-card p-5">
          <p className="text-[15px] text-foreground/75 leading-relaxed">
            A community is a private place for your people: group chats with rooms, end-to-end encrypted, where you pick who's in it. This guide starts with making your own, then covers finding and joining other people's, and opening up to the wider network when you choose.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <OutpostIcon className="w-3.5 h-3.5 text-foreground/70" />
            <span className="text-[12px] font-medium text-muted-foreground">Estimated time: 8 minutes</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <StepCard
          number={1}
          title="Name your community"
          icon={OutpostIcon}
          description={
            <>
              <p>The quickest way to a place of your own, and the first thing a new account is offered:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li>On <strong>Welcome</strong>, or from your <strong>Account</strong> page, tap <strong>Name your community</strong></li>
                <li>Give it a name. That's it: it exists, end-to-end encrypted, with you as its owner</li>
                <li>The invite opens by itself. Send the link, or invite a person directly. Only people with an invite can join</li>
                <li>Add rooms as it grows; everything in it stays between its members</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">The community depends on your key, so the page reminds you to save it until you have.</p>
            </>
          }
        />

        <StepCard
          number={2}
          title="Discover communities"
          icon={Search}
          description={
            <>
              <p>Communities spread person to person — you find them through people, not a catalog:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li>Open an <strong>invite link</strong> a friend sends you — that's the front door</li>
                <li>Tap a community on someone's <strong>profile</strong> (shared ones say "You're both here")</li>
                <li>Search a name or paste a relay address into the <strong>Communities</strong> page's search bar</li>
                <li>Preview a Community's timeline before joining</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Communities are built on relays — each one is its own independent community with its own culture and rules.</p>
            </>
          }
        />

        <StepCard
          number={3}
          title="Join your first community"
          icon={Users}
          description={
            <>
              <p>Found a community that resonates? Joining is one tap. Here's what happens:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li>Open the Community and tap <strong>Join</strong> in its header — private communities say <strong>Request</strong>, and the operator approves</li>
                <li>The relay is added to your relay list automatically</li>
                <li>You'll start seeing Community content in your feeds</li>
                <li>Your posts now go to that community's relay</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">You can join as many Communities as you like — each one adds a new dimension to your network.</p>
            </>
          }
        />

        <StepCard
          number={4}
          title="Explore community sections"
          icon={Layers}
          description={
            <>
              <p>Every Community is more than just a feed. Each one comes with built-in sections designed for different types of interaction:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li><strong>Posts</strong> — The main feed of posts from community members</li>
                <li><strong>Discussions</strong> — Topic threads with upvotes, like a forum</li>
                <li><strong>Chat</strong> — Real-time group chat rooms for live conversation</li>
                <li><strong>Articles</strong> — The community's knowledge base and curated long-form reads</li>
                <li><strong>About</strong> — Community info, rules, and relay details</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Each section serves a different purpose — explore them all to get the full picture of your community.</p>
            </>
          }
        />

        <StepCard
          number={5}
          title="Post to your community"
          icon={PenLine}
          description={
            <>
              <p>Ready to contribute? When you're inside a Community, your posts go to that community's relay.</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li>Write a post in the Community's timeline — it goes to members of that relay</li>
                <li>Start a post to kick off a threaded discussion</li>
                <li>Drop into a Room for real-time chat</li>
                <li>Use #hashtags to help your posts get discovered</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Your content reaches the right people in the right context — no company deciding who sees it.</p>
            </>
          }
        />

        <StepCard
          number={6}
          title="Manage your relay connection"
          icon={Settings}
          description={
            <>
              <p>Each Community is powered by a relay. Understanding your relay connection gives you more control:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li>View your connected relays on the <strong>Relays</strong> page</li>
                <li>Set read/write preferences per relay</li>
                <li>Monitor relay health and connection status</li>
                <li>Remove or pause relay connections anytime</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">You're always in control of which relays you connect to — your data, your choice.</p>
            </>
          }
        />

        <StepCard
          number={7}
          title="Run your own community (optional)"
          icon={Globe}
          description={
            <>
              <p>Most people simply <strong>join</strong> communities — that's the whole experience. But if you run a relay (or want to), you can host your own. <Link href="/help/relay-communities" className="text-brand underline underline-offset-2">Learn how relay communities work →</Link></p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li>Add your relay's address on the <strong>Communities</strong> page — it becomes your Community</li>
                <li>Open <strong>Manage</strong> inside your Community to configure it</li>
                <li>Set each room's name, description, and picture in <strong>Room settings</strong> — and its doors: <strong>Let people in one at a time</strong> and <strong>Members only</strong></li>
                <li>Invite members with <strong>Invite a friend</strong> and start building your community</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Running your own relay is the technical path — it gives you complete control over your community's data and moderation. No relay? Just join the communities you love.</p>
            </>
          }
        />

        <StepCard
          number={8}
          title="Use the console"
          icon={Eye}
          description={
            <>
              <p>For relay operators, <strong>the console</strong> is where you run your community:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li>Monitor relay performance and connected users</li>
                <li>Manage access controls and moderation</li>
                <li>Review event logs and relay health metrics</li>
                <li>Configure relay settings and policies</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">The console gives operators full visibility into their relay, the server behind a public community.</p>
            </>
          }
        />
      </div>

      <div className="mt-10 mb-6">
        <div className="rounded-[20px] border border-border/60 bg-card p-6 text-center">
          <div className="w-12 h-12 rounded-full dark:bg-foreground/[0.05] flex items-center justify-center mx-auto mb-3">
            <OutpostIcon className="w-6 h-6 text-foreground/75" />
          </div>
          <h3 className="text-[17px] font-semibold text-foreground mb-1">Your Community awaits</h3>
          <p className="text-[14px] text-muted-foreground max-w-sm mx-auto leading-relaxed mb-5">
            Whether you're joining an existing community or building your own, Communities are where the open social web comes alive. Find your people, share your signal, build your home.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/outposts"
              className="inline-flex items-center gap-1.5 h-11 px-5 rounded-full whitespace-nowrap bg-foreground text-background text-[15px] font-medium hover:bg-foreground/90 active:scale-[0.98] transition"
            >
              Browse Communities
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              href="/help"
              className="inline-flex items-center gap-1.5 h-11 px-5 rounded-full whitespace-nowrap border border-foreground/25 text-foreground text-[15px] font-medium hover:bg-foreground/[0.06] active:scale-[0.98] transition"
            >
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
