import { publicPageTitle } from "@shared/public-pages";
import { Link } from "wouter";
import {
  Calendar,
  Search,
  Bell,
  PenLine,
  ChevronRight,
  Globe,
  Rss,
  Star,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { OttoMark } from "@/components/OttoMark";

import { StepCard } from "@/components/wtf/StepCard";

export default function UsingContentCalendar() {
  useDocumentTitle(publicPageTitle("/help/content-calendar"));

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-in fade-in duration-150">
      <div className="flex items-center gap-3 mb-1">
        {/* Chrome back owns the route (back-affordance.ts) — no hero dupe. */}
        <div className="flex items-center gap-2">
          <OttoMark size={40} label="Relay" className="shrink-0 text-foreground !w-9 !h-9 sm:!w-10 sm:!h-10" />
          <div>
            <h1 className="text-[24px] sm:text-[30px] font-semibold tracking-[-0.025em] leading-[1.1] text-foreground">
              Using the content calendar
            </h1>
            <p className="text-[14px] sm:text-[15px] text-muted-foreground mt-1">Your timeline</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-[20px] border border-border/60 bg-card p-5">
          <p className="text-[15px] text-foreground/75 leading-relaxed">
            The Content Calendar is your command center for everything happening on Nostr — community events, meetups, live streams, holidays, and your own scheduled posts. This guide walks you through discovering events, subscribing to feeds, setting reminders, and managing your publishing timeline.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <Calendar className="w-3.5 h-3.5 text-foreground/70" />
            <span className="text-[12px] font-medium text-muted-foreground">Estimated time: 7 minutes</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <StepCard
          number={1}
          title="Navigate the calendar view"
          icon={Calendar}
          description={
            <>
              <p>Open the <strong>Account</strong> page → <strong>Calendar</strong>. You'll see a monthly grid view with all your events, pins, and subscriptions:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li>Navigate between months using the arrow controls</li>
                <li>Tap any day to see its events in detail</li>
                <li>Color-coded dots indicate different event types</li>
                <li>Filter with the category chips — scheduled, published, events, holidays, feeds, and streams</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">The calendar pulls events from your connected relays and subscribed feeds — the more you're connected to, the more you'll see.</p>
            </>
          }
        />

        <StepCard
          number={2}
          title="Discover & search events"
          icon={Search}
          description={
            <>
              <p>Find events happening across the Nostr network:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li>Use the <strong>search panel</strong> to find events by keyword or topic</li>
                <li>Switch between <strong>All</strong> and <strong>Following</strong>, or narrow to a specific creator</li>
                <li>Discover meetups, conferences, live streams, and community gatherings</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Events here are open — anyone can create them, and they live on the relays you're connected to.</p>
            </>
          }
        />

        <StepCard
          number={3}
          title="RSVP & pin events"
          icon={Star}
          description={
            <>
              <p>Found something you want to attend? RSVP or pin it to your calendar:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li>Tap an event to view its full details — time, location, description</li>
                <li>Pin events to your personal calendar for quick access</li>
                <li>Pinned events show up on your calendar grid with visual indicators</li>
                <li>Unpin events anytime to declutter your view</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">RSVPs are published so hosts see a live "going" count; a quiet <em>pin</em> stays on this device only — pin when you want to track something without announcing it.</p>
            </>
          }
        />

        <StepCard
          number={4}
          title="Subscribe to event feeds"
          icon={Rss}
          description={
            <>
              <p>Stay updated by subscribing to event feeds from communities and creators:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li>Tap <strong>Subscriptions</strong> in the calendar's menu</li>
                <li>Add any public iCal/ICS feed URL</li>
                <li>Subscribed events automatically appear on your calendar</li>
                <li>Manage and remove subscriptions anytime</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Feed subscriptions let you aggregate events from multiple sources — conferences, meetup groups, communities, and more.</p>
            </>
          }
        />

        <StepCard
          number={5}
          title="Set reminders"
          icon={Bell}
          description={
            <>
              <p>Never miss an event with the built-in reminder system:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li>Pick a lead time — 10 minutes, 30 minutes, or 1 hour before</li>
                <li>Enable reminders per feed — each subscription has its own switch</li>
                <li>Reminders arrive as encrypted messages when it's time</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Each reminder is sealed for your eyes only before it's scheduled — the scheduler holds an encrypted envelope, never your plans.</p>
            </>
          }
        />

        <StepCard
          number={6}
          title="Create your own events"
          icon={PenLine}
          description={
            <>
              <p>Host a meetup, schedule a live stream, or create a community gathering:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li>Tap <strong>Create event</strong> on the calendar</li>
                <li>Set a title, description, date, time, and optional location</li>
                <li>Choose <strong>Public</strong> or <strong>Private</strong> — private events go straight to your invitees as encrypted messages and are never published</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Public events are portable and visible to anyone connected to the same relays; private ones exist only for the people you invited.</p>
            </>
          }
        />

        <StepCard
          number={7}
          title="Manage holidays & local events"
          icon={Globe}
          description={
            <>
              <p>The calendar includes a holiday layer so you can see what's happening in the real world too:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li>A built-in set of holidays ships with the calendar — hide any you don't want, one by one</li>
                <li>Holidays appear as subtle markers on your calendar grid</li>
                <li>Add your own recurring dates with <strong>Create event</strong></li>
                <li>Combine real-world dates with Nostr events for a complete view</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Having holidays alongside Nostr events helps you plan content and community events around real-world dates.</p>
            </>
          }
        />
      </div>

      <div className="mt-10 mb-6">
        <div className="rounded-[20px] border border-border/60 bg-card p-6 text-center">
          <div className="w-12 h-12 rounded-full dark:bg-foreground/[0.05] flex items-center justify-center mx-auto mb-3">
            <Calendar className="w-6 h-6 text-foreground/75" />
          </div>
          <h3 className="text-[17px] font-semibold text-foreground mb-1">Your timeline is set</h3>
          <p className="text-[14px] text-muted-foreground max-w-sm mx-auto leading-relaxed mb-5">
            The Content Calendar keeps you in sync with your communities — events, meetups, streams, and your own publishing schedule, all in one place.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/calendar" className="inline-flex items-center gap-1.5 h-11 px-5 rounded-full whitespace-nowrap bg-foreground text-background text-[15px] font-medium hover:bg-foreground/90 active:scale-[0.98] transition-colors duration-150">
              Open calendar
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
