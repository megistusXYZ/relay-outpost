import { Link } from "wouter";
import {
  Calendar, Search, Bell, PenLine,
  ChevronRight, Image as ImageIcon, Play, Globe,
  Rss, Star,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { WtfAlienIcon } from "@/components/icons/WtfAlienIcon";

import { StepCard } from "@/components/wtf/StepCard";

export default function UsingContentCalendar() {
  useDocumentTitle("Using the Content Calendar — Relay Outpost");

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
              Using the Content Calendar
            </h1>
            <p className="text-[10px] text-brand/40 dark:text-brand/30 font-bold uppercase tracking-[0.2em] mt-0.5 ml-0.5">your mission timeline</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-xl border border-border/30 dark:border-border/15 bg-white/50 dark:bg-muted/10 p-5">
          <p className="text-sm text-foreground/70 dark:text-muted-foreground leading-relaxed">
            The Content Calendar is your command center for everything happening on Nostr — community events, meetups, live streams, holidays, and your own scheduled posts. This guide walks you through discovering events, subscribing to feeds, setting reminders, and managing your publishing timeline.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <Calendar className="w-3.5 h-3.5 text-cyan-500/70" />
            <span className="text-[11px] font-medium text-muted-foreground/60">Estimated time: 7 minutes</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <StepCard
          number={1}
          title="Navigate the Calendar View"
          icon={Calendar}
          description={
            <>
              <p>Open the <strong>You</strong> tab → <strong>Calendar</strong>. You'll see a monthly grid view with all your events, pins, and subscriptions:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Navigate between months using the arrow controls</li>
                <li>Tap any day to see its events in detail</li>
                <li>Color-coded dots indicate different event types</li>
                <li>Filter with the category chips — scheduled, published, events, holidays, feeds, and streams</li>
              </ul>
              <p className="text-[12px] text-foreground/50">The calendar pulls events from your connected relays and subscribed feeds — the more you're connected to, the more you'll see.</p>
            </>
          }
        />

        <StepCard
          number={2}
          title="Discover & Search Events"
          icon={Search}
          description={
            <>
              <p>Find events happening across the Nostr network:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Use the <strong>search panel</strong> to find events by keyword or topic</li>
                <li>Switch between <strong>All</strong> and <strong>Following</strong>, or narrow to a specific creator</li>
                <li>Discover meetups, conferences, live streams, and community gatherings</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Events here are open — anyone can create them, and they live on the relays you're connected to.</p>
            </>
          }
        />

        <StepCard
          number={3}
          title="RSVP & Pin Events"
          icon={Star}
          description={
            <>
              <p>Found something you want to attend? RSVP or pin it to your calendar:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Tap an event to view its full details — time, location, description</li>
                <li>Pin events to your personal calendar for quick access</li>
                <li>Pinned events show up on your calendar grid with visual indicators</li>
                <li>Unpin events anytime to declutter your view</li>
              </ul>
              <p className="text-[12px] text-foreground/50">RSVPs are published so hosts see a live "going" count; a quiet <em>pin</em> stays on this device only — pin when you want to track something without announcing it.</p>
            </>
          }
        />

        <StepCard
          number={4}
          title="Subscribe to Event Feeds"
          icon={Rss}
          description={
            <>
              <p>Stay updated by subscribing to event feeds from communities and creators:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Tap <strong>Subscriptions</strong> in the calendar's menu</li>
                <li>Add any public iCal/ICS feed URL</li>
                <li>Subscribed events automatically appear on your calendar</li>
                <li>Manage and remove subscriptions anytime</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Feed subscriptions let you aggregate events from multiple sources — conferences, meetup groups, Community communities, and more.</p>
            </>
          }
        />

        <StepCard
          number={5}
          title="Set Reminders"
          icon={Bell}
          description={
            <>
              <p>Never miss an event with the built-in reminder system:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Pick a lead time — 10 minutes, 30 minutes, or 1 hour before</li>
                <li>Enable reminders per feed — each subscription has its own switch</li>
                <li>Reminders arrive as encrypted messages when it's time</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Each reminder is sealed for your eyes only before it's scheduled — the scheduler holds an encrypted envelope, never your plans.</p>
            </>
          }
        />

        <StepCard
          number={6}
          title="Create Your Own Events"
          icon={PenLine}
          description={
            <>
              <p>Host a meetup, schedule a live stream, or create a community gathering:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Tap <strong>Create event</strong> on the calendar</li>
                <li>Set a title, description, date, time, and optional location</li>
                <li>Choose <strong>Public</strong> or <strong>Private</strong> — private events go straight to your invitees as encrypted messages and are never published</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Public events are portable and visible to anyone connected to the same relays; private ones exist only for the people you invited.</p>
            </>
          }
        />

        <StepCard
          number={7}
          title="Manage Holidays & Local Events"
          icon={Globe}
          description={
            <>
              <p>The calendar includes a holiday layer so you can see what's happening in the real world too:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>A built-in set of holidays ships with the calendar — hide any you don't want, one by one</li>
                <li>Holidays appear as subtle markers on your calendar grid</li>
                <li>Add your own recurring dates with <strong>Create event</strong></li>
                <li>Combine real-world dates with Nostr events for a complete view</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Having holidays alongside Nostr events helps you plan content and community events around real-world dates.</p>
            </>
          }
        />
      </div>

      <div className="mt-10 mb-6">
        <div className="rounded-xl border border-border/30 dark:border-border/15 bg-gradient-to-br from-cyan-500/[0.03] to-brand/[0.02] p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500/15 to-brand/10 border border-cyan-500/15 flex items-center justify-center mx-auto mb-3">
            <Calendar className="w-6 h-6 text-cyan-500/60" />
          </div>
          <h3 className="text-sm font-bold text-foreground/80 mb-1">Your timeline is set</h3>
          <p className="text-xs text-muted-foreground/50 max-w-sm mx-auto leading-relaxed mb-4">
            The Content Calendar keeps you in sync with your communities — events, meetups, streams, and your own publishing schedule, all in one place.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/calendar" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 text-xs font-medium transition-all duration-200 hover:bg-cyan-500/15">
              Open Calendar
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
