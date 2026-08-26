import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { ChevronRight, Pencil, Wallet, ShieldCheck, Wrench, UserPlus, Users, Settings, Sun, Moon, Eclipse, LogOut, Unplug, Fingerprint, CalendarDays } from "lucide-react";
import {
  listAccounts,
  switchAccount,
  beginAddAccount,
  accountDisplayName,
  type RegisteredAccount,
} from "@/lib/account-registry";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { WhatsNewIcon } from "@/components/icons/WhatsNewIcon";
import { WtfAlienIcon } from "@/components/icons/WtfAlienIcon";
import { hasUnseenChangelog } from "@/lib/changelog";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useTheme } from "@/hooks/use-theme";
import { formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useIaCollapsed } from "@/lib/ia-prefs";

/**
 * Account menu (/account/menu) — the grouped-rows replacement for the sidebar's
 * account dropdown, which rendered as a cramped floating popover over the menu.
 * Reached on ALL breakpoints by tapping the sidebar profile row (the old desktop
 * dropdown popup was removed in favour of this page). Same actions and
 * destinations; laid out as scannable iOS-Settings-style sections. On desktop it
 * renders inside the normal app layout as a centered max-width column. The
 * account dashboard itself lives at /account.
 */
function Row({ icon, label, onClick, danger, trailing, chevron = true, testId }: {
  icon: ReactNode; label: string; onClick: () => void; danger?: boolean; trailing?: ReactNode; chevron?: boolean; testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3.5 px-4 min-h-[52px] text-left transition-colors active:bg-primary/[0.06] hover:bg-primary/[0.04] dark:hover:bg-white/[0.03] ${danger ? "text-red-500 dark:text-red-400" : ""}`}
      data-testid={testId}
    >
      <span className={`shrink-0 ${danger ? "" : "text-muted-foreground"}`}>{icon}</span>
      <span className="flex-1 text-sm font-medium">{label}</span>
      {trailing}
      {chevron && !danger && <ChevronRight className="w-4 h-4 text-muted-foreground/30 shrink-0" />}
    </button>
  );
}

function Section({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      {label && <p className="px-1 text-[11px] font-mono uppercase tracking-[0.15em] text-muted-foreground/50">{label}</p>}
      <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden divide-y divide-border/25">
        {children}
      </div>
    </div>
  );
}

export default function Account() {
  const [, navigate] = useLocation();
  const { pubkey, profile, loginMethod, logout } = useNostrAuth();
  const { toggleTheme, theme } = useTheme();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  // Secondary account-switcher surface (the Stories-menu identity chip is the
  // primary one). Read once per mount — switching reloads the app anyway.
  const [accounts] = useState<RegisteredAccount[]>(() => {
    try { return listAccounts(); } catch { return []; }
  });
  const otherAccounts = accounts.filter((a) => a.pubkey !== pubkey);
  const iaCollapsed = useIaCollapsed();
  useDocumentTitle("Account");

  // Signed-out users have no account to show.
  useEffect(() => { if (!pubkey) navigate("/login"); }, [pubkey, navigate]);

  const go = useCallback((path: string) => () => navigate(path), [navigate]);
  const toggleThemeAnimated = useCallback(() => {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce && typeof doc.startViewTransition === "function") {
      // Guarded like OrbitMenu's toggle: a WebKit "invalid state" throw must
      // fall back to the direct flip, never leave the theme un-toggled.
      try { doc.startViewTransition(() => toggleTheme()); } catch { toggleTheme(); }
    } else toggleTheme();
  }, [toggleTheme]);

  if (!pubkey) return null;

  const displayName = profile?.display_name || profile?.name || null;
  // Full npub for the profile route; `npub` below is the shortened DISPLAY form
  // and is not routable — reusing it here would 404 on "npub1vh5m...5mf3".
  const npubFull = formatNpub(pubkey);
  const npub = shortenNpub(npubFull);
  const lightningAddress = profile?.lud16 || null;
  const avatarUrl = profile?.picture;
  const loginMethodLabel = loginMethod === "bunker" ? "NIP-46" : loginMethod === "extension" ? "NIP-07" : null;
  const LoginMethodIcon = loginMethod === "bunker" ? Unplug : Fingerprint;

  return (
    <div className="mx-auto w-full max-w-lg md:max-w-2xl px-3 sm:px-4 md:px-6 pt-2 md:pt-6 pb-[calc(2rem+env(safe-area-inset-bottom,0px))]">
      {/* Title — the app's top bar already provides the single Back button. */}
      <div className="flex items-center h-12">
        <h1 className="text-lg font-brand uppercase tracking-widest">Account</h1>
      </div>

      {/* Your face and your name, so this opens the page that IS your face and
          your name. It used to go to the edit form — the same place the "Edit
          profile" row one section below already goes, which made the card a
          duplicate of a nearby row and left no route at all to your own public
          profile from here. Editing is a thing you do to a profile; this card
          is the profile. */}
      <button
        onClick={go(`/profile/${npubFull}`)}
        className="w-full flex items-center gap-3 rounded-xl border border-border/40 bg-card/40 p-3 mt-1 mb-4 text-left transition-colors hover:bg-primary/[0.04]"
        data-testid="button-account-profile"
      >
        <Avatar className="w-12 h-12 border border-border shrink-0">
          <AvatarImage src={avatarUrl} alt={displayName || "Profile"} />
          <AvatarFallback className="text-sm bg-muted text-muted-foreground">
            {(displayName || npub || "?").slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          {displayName && <p className="text-sm font-semibold truncate">{displayName}</p>}
          <p className="text-xs text-muted-foreground truncate">{lightningAddress || npub}</p>
          {loginMethodLabel && (
            <span className="mt-0.5 flex items-center gap-1">
              <LoginMethodIcon className="w-2.5 h-2.5 text-muted-foreground/50" />
              <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/50">{loginMethodLabel}</span>
            </span>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground/30 shrink-0" />
      </button>

      <div className="space-y-5">
        {/* Row order (owner call, 2026-08-18): things you DO first — identity,
            growth, money, plans — then the administration you visit rarely
            (Trust & safety, Tools) closing the group. Invite sits second
            because invites are how this network grows and it was buried at the
            bottom of the everyday half. */}
        <Section label="Your account">
          <Row icon={<Pencil className="w-5 h-5" />} label="Edit profile" onClick={go("/account?edit=profile")} testId="account-edit-profile" />
          <Row icon={<UserPlus className="w-5 h-5" />} label="Invite a friend" onClick={go("/account?invite=1")} testId="account-invite" />
          <Row icon={<Wallet className="w-5 h-5" />} label="Wallet" onClick={go("/account?tab=wallet")} testId="account-wallet" />
          {/* Calendar's re-point, and it was the ONLY genuine orphan of the
              collapse: with simplified navigation on, /calendar left the nav and
              landed nowhere — not in the four destinations, not in the launcher,
              not here. The only remaining links were the page itself and a guide
              page, so the sole way back was typing the URL.
              Collapsed-only on purpose: the expanded IA still carries Calendar
              as a top-level destination, and listing it in both places is the
              duplicate-destination problem this stage keeps removing. */}
          {iaCollapsed && (
            <Row icon={<CalendarDays className="w-5 h-5" />} label="Calendar" onClick={go("/calendar")} testId="account-calendar" />
          )}
          <Row icon={<ShieldCheck className="w-5 h-5" />} label="Trust & safety" onClick={go("/account?tab=shield")} testId="account-trust-safety" />
          <Row icon={<Wrench className="w-5 h-5" />} label="Tools" onClick={go("/tools")} testId="account-tools" />
        </Section>

        <Section label="Switch account">
          {otherAccounts.map((acct) => (
            <Row
              key={acct.pubkey}
              icon={
                acct.picture ? (
                  <Avatar className="w-5 h-5">
                    <AvatarImage src={acct.picture} alt={accountDisplayName(acct)} />
                    <AvatarFallback className="text-[9px]">{accountDisplayName(acct).slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                ) : (
                  <Users className="w-5 h-5" />
                )
              }
              label={accountDisplayName(acct)}
              onClick={() => switchAccount(acct.pubkey, { toastMessage: `Switched to ${accountDisplayName(acct)}` })}
              chevron={false}
              trailing={<span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50">Switch</span>}
              testId={`account-switch-${acct.pubkey.slice(0, 8)}`}
            />
          ))}
          <Row
            icon={<UserPlus className="w-5 h-5" />}
            label="Add account"
            onClick={() => { beginAddAccount(); navigate("/login"); }}
            chevron={false}
            testId="account-add-account"
          />
        </Section>

        <Section label="App">
          <Row icon={<Settings className="w-5 h-5" />} label="App settings" onClick={go("/settings")} testId="account-settings" />
          <Row
            icon={theme === "dark" ? <Eclipse className="w-5 h-5" /> : theme === "black" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            label={theme === "dark" ? "Black mode" : theme === "black" ? "Light mode" : "Dark mode"}
            onClick={toggleThemeAnimated}
            chevron={false}
            testId="account-theme"
          />
        </Section>

        <Section label="Learn">
          <Row
            icon={<WhatsNewIcon className="w-5 h-5" />}
            label="What's new"
            onClick={go("/whats-new")}
            trailing={hasUnseenChangelog() ? <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-label="new updates" /> : undefined}
            testId="account-whats-new"
          />
          <Row icon={<WtfAlienIcon className="w-5 h-5" />} label="Help & Guides" onClick={go("/help")} testId="account-help" />
        </Section>

        {confirmSignOut ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3 space-y-2.5" data-testid="account-signout-confirm">
            <p className="text-[11px] font-brand uppercase tracking-[0.15em] text-red-500 dark:text-red-400">Sign out?</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { logout(); navigate("/"); }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-lg bg-red-500/20 border border-red-500/40 text-red-500 dark:text-red-400 font-brand uppercase tracking-[0.15em] text-[11px] hover:bg-red-500/30 transition-colors"
                data-testid="button-account-confirm-signout"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign out
              </button>
              <button
                onClick={() => setConfirmSignOut(false)}
                className="flex-1 inline-flex items-center justify-center h-10 rounded-lg bg-muted/40 border border-border/50 font-brand uppercase tracking-[0.15em] text-[11px] hover:bg-muted/60 transition-colors"
                data-testid="button-account-cancel-signout"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <Section>
            <Row icon={<LogOut className="w-5 h-5" />} label="Sign out" onClick={() => setConfirmSignOut(true)} danger chevron={false} testId="account-sign-out" />
          </Section>
        )}
      </div>
    </div>
  );
}
