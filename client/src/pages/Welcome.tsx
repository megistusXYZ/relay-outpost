/**
 * The one-time welcome a brand-new account sees after signing up
 * (lib/ia-landing.ts postAuthLandingPath). It exists because the first screen
 * used to be an empty inbox: someone with no contacts saw "No conversations
 * yet" and nothing that said what the app is for or where to begin.
 *
 * Your space first (owner, 2026-10-10): the first act is to MAKE something
 * — name a community, invite a friend. The wider network (public
 * communities, people to follow) stands behind its door until the person
 * opens it; with the wider network on, those two starts are offered too.
 * Seen once per account on this device (lib/welcome.ts); the invite "say hi"
 * card still appears over it for invited arrivals.
 */
import { useEffect, useState, type ReactNode } from "react";
import { InviteAcceptCard } from "@/components/InviteAcceptCard";
import { useLocation } from "wouter";
import { ChevronRight, Compass, MessagesSquare, UserPlus, Users } from "lucide-react";
import { OttoMark } from "@/components/OttoMark";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { markWelcomed } from "@/lib/welcome";
import { CHATS_PATH } from "@/lib/ia-landing";
import { useWiderNetwork } from "@/lib/network-mode";
import { WiderNetworkDoor } from "@/components/wider-network/WiderNetworkDoor";
import { CreateOutpostDialog } from "@/components/concord/CreateOutpostDialog";

function Start({ icon, title, desc, onClick, testId }: {
  icon: ReactNode; title: string; desc: string; onClick: () => void; testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3.5 px-4 py-3.5 min-h-[64px] text-left transition-colors active:bg-foreground/[0.06] hover:bg-foreground/[0.04] dark:hover:bg-white/[0.03]"
      data-testid={testId}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold">{title}</span>
        <span className="block text-[14px] text-muted-foreground">{desc}</span>
      </span>
      <ChevronRight className="w-4 h-4 text-muted-foreground/60 shrink-0" />
    </button>
  );
}

export default function Welcome() {
  const [, navigate] = useLocation();
  const { pubkey, profile } = useNostrAuth();
  const widerNetworkOn = useWiderNetwork(pubkey);
  const [naming, setNaming] = useState(false);
  useDocumentTitle("Welcome");

  // Seen: the next sign-in lands on Chats as usual.
  useEffect(() => { if (pubkey) markWelcomed(pubkey); }, [pubkey]);

  const name = (profile?.display_name || profile?.name || "").trim();
  const go = (path: string) => () => navigate(path);

  return (
    <div className="mx-auto w-full max-w-lg md:max-w-2xl px-3 sm:px-4 md:px-6 pt-6 md:pt-10 pb-[calc(2rem+env(safe-area-inset-bottom,0px))]" data-testid="welcome-page">
      {/* Otto greets: this is the one screen where the face says hello before anything else. */}
      <OttoMark size={48} className="-ml-1 text-foreground" label="Otto says hello" />
      <h1 className="mt-4 text-[34px] md:text-[40px] leading-[1.05] font-semibold tracking-[-0.035em] [text-wrap:balance]">
        {name ? `Welcome, ${name}.` : "Welcome."}
      </h1>
      <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground max-w-[60ch] [text-wrap:pretty]">
        This is your space: your communities and the people you choose. Private messages and
        group chats are end-to-end encrypted, and your account is yours: no email, and no company can lock you out.
      </p>

      {/* An invited arrival's "Say hi" is the first card, in the flow, so it
          never covers the paragraph above (owner, 2026-10-10). */}
      <div className="mt-6">
        <InviteAcceptCard inline />
      </div>

      <p className="mt-8 mb-2 px-1 text-[14px] font-medium text-muted-foreground">Make it yours</p>
      <div className="rounded-[20px] border border-border/60 bg-card overflow-hidden divide-y divide-border/40">
        <Start icon={<OttoMark size={22} face={false} />} title="Name your community"
          desc="A private place for your people. You pick who's in it." onClick={() => setNaming(true)} testId="welcome-create-community" />
        <Start icon={<UserPlus className="w-5 h-5" />} title="Invite a friend"
          desc="Chats are better with people you know. Send them a link." onClick={go("/account?invite=1")} testId="welcome-invite" />
        {widerNetworkOn && (
          <>
            <Start icon={<Compass className="w-5 h-5" />} title="Join a community"
              desc="Public communities around shared interests. Drop in and say hello." onClick={go("/outposts")} testId="welcome-communities" />
            <Start icon={<Users className="w-5 h-5" />} title="Follow a few people"
              desc="Fill your feed with people worth hearing from." onClick={go("/discover")} testId="welcome-follow" />
          </>
        )}
      </div>

      {!widerNetworkOn && (
        <div className="mt-4">
          <WiderNetworkDoor compact testId="wider-network-door-welcome" />
        </div>
      )}

      <button
        type="button"
        onClick={go(CHATS_PATH)}
        className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full border border-foreground/25 px-5 text-[15px] font-medium text-foreground hover:bg-foreground/[0.06] transition-colors"
        data-testid="welcome-skip"
      >
        <MessagesSquare className="w-4 h-4" /> Take me to my chats
      </button>

      {/* Lands in the new community with its invite open (CreateOutpostDialog's own default). */}
      <CreateOutpostDialog open={naming} onOpenChange={setNaming} />
    </div>
  );
}
