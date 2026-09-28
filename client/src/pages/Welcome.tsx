/**
 * The one-time welcome a brand-new account sees after signing up
 * (lib/ia-landing.ts postAuthLandingPath). It exists because the first screen
 * used to be an empty inbox: someone with no contacts saw "No conversations
 * yet" and nothing that said what the app is for or where to begin.
 *
 * It says what Relay Outpost is in two sentences, then offers three starts that
 * work with zero contacts. Seen once per account on this device (lib/welcome.ts);
 * the invite "say hi" card still appears over it for invited arrivals.
 */
import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { ChevronRight, Compass, MessagesSquare, UserPlus, Users } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { markWelcomed } from "@/lib/welcome";
import { CHATS_PATH } from "@/lib/ia-landing";

function Start({ icon, title, desc, onClick, testId }: {
  icon: ReactNode; title: string; desc: string; onClick: () => void; testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3.5 px-4 py-3.5 min-h-[64px] text-left transition-colors active:bg-primary/[0.06] hover:bg-primary/[0.04] dark:hover:bg-white/[0.03]"
      data-testid={testId}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{desc}</span>
      </span>
      <ChevronRight className="w-4 h-4 text-muted-foreground/30 shrink-0" />
    </button>
  );
}

export default function Welcome() {
  const [, navigate] = useLocation();
  const { pubkey, profile } = useNostrAuth();
  useDocumentTitle("Welcome");

  // Seen: the next sign-in lands on Chats as usual.
  useEffect(() => { if (pubkey) markWelcomed(pubkey); }, [pubkey]);

  const name = (profile?.display_name || profile?.name || "").trim();
  const go = (path: string) => () => navigate(path);

  return (
    <div className="mx-auto w-full max-w-lg md:max-w-2xl px-3 sm:px-4 md:px-6 pt-6 md:pt-10 pb-[calc(2rem+env(safe-area-inset-bottom,0px))]" data-testid="welcome-page">
      <h1 className="text-2xl font-semibold tracking-tight [text-wrap:balance]">
        {name ? `Welcome, ${name}.` : "Welcome."}
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground max-w-[60ch]">
        Relay Outpost keeps your chats, group chats and communities in one place. Private messages and
        group chats are end-to-end encrypted, and your account is yours: no email, and no company can lock you out.
      </p>

      <p className="mt-8 mb-1.5 px-1 text-[11px] font-mono uppercase tracking-[0.15em] text-muted-foreground/60">Where to start</p>
      <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden divide-y divide-border/25">
        <Start icon={<UserPlus className="w-5 h-5" />} title="Invite a friend"
          desc="Chats are better with people you know. Send them a link." onClick={go("/account?invite=1")} testId="welcome-invite" />
        <Start icon={<Compass className="w-5 h-5" />} title="Join a community"
          desc="Public rooms around shared interests. Drop in and say hello." onClick={go("/outposts")} testId="welcome-communities" />
        <Start icon={<Users className="w-5 h-5" />} title="Follow a few people"
          desc="Fill your feed with people worth hearing from." onClick={go("/discover")} testId="welcome-follow" />
      </div>

      <button
        type="button"
        onClick={go(CHATS_PATH)}
        className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        data-testid="welcome-skip"
      >
        <MessagesSquare className="w-4 h-4" /> Take me to my chats
      </button>
    </div>
  );
}
