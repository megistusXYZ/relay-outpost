import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { MissionBriefing, ACCOUNT_BRIEFING } from "@/components/MissionBriefing";
import { ChevronRight, Pencil, Wallet, ShieldCheck, Wrench, UserPlus, Users, Settings, Sun, Moon, Eclipse, LogOut, Unplug, Fingerprint, CalendarDays, KeyRound, Award } from "lucide-react";
import { useKeyBackupNudge } from "@/hooks/use-key-backup";
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
import { ServerStackIcon } from "@/components/icons/ServerStackIcon";
import { useOperatedRelays } from "@/lib/operated-relays";
import { useRelaysNeedYou } from "@/contexts/NeedsYouContext";

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
      className={`w-full flex items-center gap-3.5 px-4 min-h-[54px] text-left transition-colors active:bg-foreground/[0.06] hover:bg-foreground/[0.04] ${danger ? "text-danger" : ""}`}
      data-testid={testId}
    >
      <span className={`shrink-0 ${danger ? "" : "text-foreground"}`}>{icon}</span>
      <span className="flex-1 text-[15px] font-medium">{label}</span>
      {trailing}
      {chevron && !danger && <ChevronRight className="w-4 h-4 text-foreground/30 shrink-0" />}
    </button>
  );
}

function Section({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      {label && <p className="px-1 text-[14px] font-medium text-muted-foreground">{label}</p>}
      <div className="rounded-[20px] border border-border/60 bg-card overflow-hidden divide-y divide-border/40">
        {children}
      </div>
    </div>
  );
}

export default function Account() {
  const [, navigate] = useLocation();
  const { pubkey, profile, loginMethod, logout } = useNostrAuth();
  const runsRelay = useOperatedRelays().length > 0;
  const relaysWaiting = useRelaysNeedYou().total;
  const { theme } = useTheme();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  // Secondary account-switcher surface (the Stories-menu identity chip is the
  // primary one). Read once per mount — switching reloads the app anyway.
  const [accounts] = useState<RegisteredAccount[]>(() => {
    try { return listAccounts(); } catch { return []; }
  });
  const otherAccounts = accounts.filter((a) => a.pubkey !== pubkey);
  const iaCollapsed = useIaCollapsed();
  const keyBackup = useKeyBackupNudge();
  useDocumentTitle("Account");

  // Signed-out users have no account to show.
  useEffect(() => { if (!pubkey) navigate("/login"); }, [pubkey, navigate]);

  const go = useCallback((path: string) => () => navigate(path), [navigate]);

  if (!pubkey) return null;

  const displayName = profile?.display_name || profile?.name || null;
  // Full npub for the profile route; `npub` below is the shortened DISPLAY form
  // and is not routable — reusing it here would 404 on "npub1vh5m...5mf3".
  const npubFull = formatNpub(pubkey);
  const npub = shortenNpub(npubFull);
  const lightningAddress = profile?.lud16 || null;
  const avatarUrl = profile?.picture;
  const loginMethodLabel = loginMethod === "bunker" ? "Signed in with a remote signer" : loginMethod === "extension" ? "Signed in with a browser extension" : null;
  const LoginMethodIcon = loginMethod === "bunker" ? Unplug : Fingerprint;

  return (
    <div className="mx-auto w-full max-w-lg md:max-w-2xl px-3 sm:px-4 md:px-6 pt-4 sm:pt-6 pb-[calc(2rem+env(safe-area-inset-bottom,0px))]">
      {/* No title block: pages open with their content (lib/page-titles.test.ts). */}
      <MissionBriefing pageId="account" steps={ACCOUNT_BRIEFING} />

      {/* Your face and your name, so this opens the page that IS your face and
          your name. It used to go to the edit form — the same place the "Edit
          profile" row one section below already goes, which made the card a
          duplicate of a nearby row and left no route at all to your own public
          profile from here. Editing is a thing you do to a profile; this card
          is the profile. */}
      <button
        onClick={go(`/profile/${npubFull}`)}
        className="w-full flex items-center gap-3.5 rounded-[20px] border border-border/60 bg-card p-4 mb-5 text-left transition-colors hover:bg-foreground/[0.04]"
        data-testid="button-account-profile"
      >
        <Avatar className="w-14 h-14 border border-border/60 shrink-0">
          <AvatarImage src={avatarUrl} alt={displayName || "Profile"} />
          <AvatarFallback className="text-base font-medium bg-foreground/[0.06] text-foreground">
            {(displayName || npub || "?").slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          {displayName && <p className="text-[17px] font-semibold leading-tight truncate">{displayName}</p>}
          <p className="text-[13px] text-muted-foreground truncate">{lightningAddress || npub}</p>
          {loginMethodLabel && (
            <span className="mt-1 flex items-center gap-1.5">
              <LoginMethodIcon className="w-3 h-3 text-muted-foreground/70" />
              <span className="text-[12px] text-muted-foreground">{loginMethodLabel}</span>
            </span>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-foreground/30 shrink-0" />
      </button>

      <div className="space-y-6">
        {/* Row order (owner call, 2026-08-18): things you DO first — identity,
            growth, money, plans — then the administration you visit rarely
            (Trust & safety, Tools) closing the group. Invite sits second
            because invites are how this network grows and it was buried at the
            bottom of the everyday half. */}
        <Section label="Your account">
          <Row icon={<Pencil className="w-5 h-5" />} label="Edit profile" onClick={go("/account?edit=profile")} testId="account-edit-profile" />
          <Row icon={<UserPlus className="w-5 h-5" />} label="Invite a friend" onClick={go("/account?invite=1")} testId="account-invite" />
          {/* The key is the only way back into this account elsewhere. The word
              is the state (status words, not pills): not saved, saved, or saved
              and checked — "checked" means Check it works read the file back. */}
          {keyBackup.status !== "none" && (
            <Row
              icon={<KeyRound className="w-5 h-5" />}
              label="Save your key"
              onClick={go("/key-backup")}
              trailing={
                <span className={`text-xs font-medium ${keyBackup.status === "not-saved" ? "text-amber-700 dark:text-amber-400" : "text-success"}`} data-testid="account-key-backup-status">
                  {keyBackup.status === "not-saved" ? "Not saved" : keyBackup.status === "saved" ? "Saved" : "Saved and checked"}
                </span>
              }
              testId="account-key-backup"
            />
          )}
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
          {/* The phone footer has no Relays tab (owner, 2026-10-04): this row is the way in, and says what's waiting. */}
          <Row icon={<ServerStackIcon className="w-5 h-5" />} label={runsRelay ? "Your relays" : "Run a relay"} onClick={go("/my-relays")} testId="account-relays"
            trailing={runsRelay && relaysWaiting > 0 ? <span className="text-[13px] font-medium text-brand tabular-nums" data-testid="account-relays-waiting">{relaysWaiting} waiting</span> : undefined} />
          <Row icon={<Award className="w-5 h-5" />} label="Your badges" onClick={go("/badges")} testId="account-badges" />
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
              trailing={<span className="text-[13px] text-muted-foreground">Switch</span>}
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
          {/* The theme has one home, Settings › Theme (owner, 2026-10-10): this
              row names the current one and opens it. It used to be a toggle whose
              label named the NEXT mode ("Black mode" meant "switch to black"). */}
          <Row
            icon={theme === "dark" ? <Moon className="w-5 h-5" /> : theme === "black" ? <Eclipse className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            label="Theme"
            onClick={go("/settings?section=appearance")}
            trailing={<span className="text-[14px] text-muted-foreground" data-testid="account-theme-value">{theme === "dark" ? "Dark" : theme === "black" ? "Black" : "Light"}</span>}
            testId="account-theme"
          />
        </Section>

        <Section label="Learn">
          <Row
            icon={<WhatsNewIcon className="w-5 h-5" />}
            label="What's new"
            onClick={go("/whats-new")}
            trailing={hasUnseenChangelog() ? <span className="w-2 h-2 rounded-full bg-brand" aria-label="new updates" /> : undefined}
            testId="account-whats-new"
          />
          <Row icon={<WtfAlienIcon className="w-5 h-5" />} label="Help & guides" onClick={go("/help")} testId="account-help" />
        </Section>

        {confirmSignOut ? (
          <div className="rounded-[20px] border border-border/60 bg-card p-4 space-y-3" data-testid="account-signout-confirm">
            <p className="text-[15px] font-medium">Sign out of this account?</p>
            <p className="text-[13px] text-muted-foreground -mt-1.5">{loginMethod === "local" ? "This device forgets your key. Keep your saved key file or password to sign back in." : "You can sign back in any time with the same signer."}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { logout(); navigate("/"); }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-11 rounded-full bg-destructive text-destructive-foreground text-[15px] font-medium hover:bg-destructive/90 active:scale-[0.98] transition"
                data-testid="button-account-confirm-signout"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
              <button
                onClick={() => setConfirmSignOut(false)}
                className="flex-1 inline-flex items-center justify-center h-11 rounded-full border border-foreground/25 text-[15px] font-medium hover:bg-foreground/[0.06] active:scale-[0.98] transition"
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
