import { useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import {
  Wrench, Wallet, Radio, Bookmark, BarChart3, Terminal, ScrollText, ChevronRight,
  Users, ShieldCheck, RefreshCw, HardDrive, VolumeX, KeyRound, Inbox,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { computeFollowHealth, countNeedingReview } from "@/lib/follow-health";
import { loadActivityCache } from "@/lib/follow-activity";
import { loadReviewed } from "@/lib/wot-history";

type ToolRow = { href: string; icon: LucideIcon; title: string; desc: string };

/** Destinations match the Settings → Tools section exactly. */
const TOOLS: ToolRow[] = [
  { href: "/account?tab=wallet", icon: Wallet, title: "Wallet", desc: "Lightning balance & zaps" },
  { href: "/relays", icon: Radio, title: "Relays", desc: "Where your posts go, health & blocks" },
  { href: "/account?tab=bookmarks", icon: Bookmark, title: "Bookmarks", desc: "Saved posts & articles" },
  { href: "/console/dashboard", icon: BarChart3, title: "Analytics", desc: "Engagement & reach" },
  { href: "/tickets", icon: Inbox, title: "Tickets", desc: "Support & feedback from your users" },
  { href: "/console", icon: Terminal, title: "Console", desc: "Raw relay queries" },
  { href: "/account?tab=flight_log", icon: ScrollText, title: "Flight Log", desc: "Your activity log" },
  { href: "/recover-follows", icon: Users, title: "Follow list", desc: "Health: recover, review flagged & inactive" },
  { href: "/trust-reviews", icon: ShieldCheck, title: "Trust reviews", desc: "Vouches from your network" },
  { href: "/account?tab=shield", icon: RefreshCw, title: "Recalculate trust", desc: "Refresh your web-of-trust scores" },
  { href: "/media-servers", icon: HardDrive, title: "Media servers", desc: "Where your images & videos live" },
  { href: "/muted", icon: VolumeX, title: "Muted", desc: "People & words you've hidden" },
];

/** Only local accounts hold an exportable, encrypted key to back up. */
const KEY_BACKUP_ROW: ToolRow = {
  href: "/key-backup", icon: KeyRound, title: "Back up your key", desc: "Download an encrypted backup",
};

export default function Tools() {
  const { pubkey, loginMethod, follows } = useNostrAuth();
  const { flagReporterCounts, wotEnabled, wotReady } = useGrapeRankScores();
  const [, setLocation] = useLocation();
  useDocumentTitle("Tools");

  // Calm "needs review" count for the Follow-list row: flagged (from WoT, when
  // ready) + already-cached gone-quiet results, minus reviewed. Read-only — never
  // triggers the heavy activity fetch here; that only runs on the health page.
  const followHealthCount = useMemo(() => {
    if (!pubkey || !follows || follows.length === 0) return 0;
    if (!wotEnabled || !wotReady) return 0;
    const health = computeFollowHealth({
      follows,
      self: pubkey,
      flagReporterCounts: flagReporterCounts ?? new Map(),
      lastPostAt: loadActivityCache(pubkey),
      reviewed: loadReviewed(pubkey),
      now: Math.floor(Date.now() / 1000),
    });
    return countNeedingReview(health);
  }, [pubkey, follows, flagReporterCounts, wotEnabled, wotReady]);

  // Key backup is gated to local accounts: NIP-07 extension and NIP-46 remote
  // signer logins have no exportable local key, so the row is hidden for them.
  const tools = useMemo<ToolRow[]>(
    () => (loginMethod === "local" ? [...TOOLS, KEY_BACKUP_ROW] : TOOLS),
    [loginMethod],
  );

  // Auth-gated like the Settings → Tools section: send signed-out users home.
  useEffect(() => {
    if (!pubkey) setLocation("/");
  }, [pubkey, setLocation]);

  if (!pubkey) return null;

  return (
    <div className="relative min-h-screen" data-testid="page-tools">
      {/* Atmospheric backdrop — matches the Help & Guides page feel */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 bottom-1/2 z-0 pointer-events-none bg-cover bg-center"
        style={{
          backgroundImage: "url(/images/tools-bg.webp)",
          opacity: 0.08,
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, #000 28%, rgba(0,0,0,0.55) 60%, transparent 88%)",
          maskImage: "linear-gradient(to bottom, transparent 0%, #000 28%, rgba(0,0,0,0.55) 60%, transparent 88%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-1/4 bottom-1/4 z-0 pointer-events-none bg-cover bg-center"
        style={{
          backgroundImage: "url(/images/landing/galaxy-bg.webp)",
          opacity: 0.06,
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.6) 35%, #000 50%, rgba(0,0,0,0.6) 65%, transparent 100%)",
          maskImage: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.6) 35%, #000 50%, rgba(0,0,0,0.6) 65%, transparent 100%)",
        }}
      />
      <div className="relative z-10 px-3 sm:px-4 py-4 sm:py-6 pb-[calc(7rem+env(safe-area-inset-bottom))]">
      <div className="max-w-2xl mx-auto">

        <div className="relative rounded-md overflow-hidden border border-border dark:border-brand/15 glass-settings-header shadow-sm dark:shadow-none mb-4 sm:mb-5">
          <div className="absolute inset-0 pointer-events-none glass-settings-header-glow" />
          <div className="relative p-4 sm:p-5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-md flex items-center justify-center shrink-0"
              style={{ background: "rgba(140, 100, 220, 0.12)", border: "1px solid rgba(140, 100, 220, 0.18)" }}
            >
              <Wrench className="w-5 h-5 text-brand/70" />
            </div>
            <h1 className="text-lg font-semibold text-foreground" data-testid="text-tools-title">
              Tools
            </h1>
          </div>
        </div>

        <div className="space-y-4 sm:space-y-5">
          {tools.map((t) => (
            <Link key={t.href} href={t.href}>
              <div className="group cursor-pointer rounded-md p-4 space-y-3 border border-border dark:border-brand/15 bg-card/40 dark:bg-brand/[0.03] shadow-sm dark:shadow-none transition-all duration-300 hover:border-brand/30 hover:shadow-[0_0_20px_rgba(139,92,246,0.08)]" data-testid={`link-tool-${t.title.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-accent dark:bg-brand/15 border border-border flex items-center justify-center">
                      <t.icon className="w-4 h-4 text-brand dark:text-brand/80" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground/90">{t.title}</p>
                      <p className="text-xs text-muted-foreground/55">{t.desc}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.href === "/recover-follows" && followHealthCount > 0 && (
                      <span
                        className="min-w-[1.25rem] h-5 px-1.5 inline-flex items-center justify-center rounded-full text-[11px] font-semibold bg-brand/15 text-brand"
                        aria-label={`${followHealthCount} follows need review`}
                        data-testid="badge-follow-health"
                      >
                        {followHealthCount}
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

      </div>
      </div>
    </div>
  );
}
