import { Link } from "wouter";
import {
  Shield, Key, Globe, Users, Zap,
  Radio, Lock, Server, Eye, Check, X as XIcon,
  Minus, ChevronRight,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { OttoMark } from "@/components/OttoMark";

type Rating = "strong" | "partial" | "weak" | "none";

interface ComparisonRow {
  feature: string;
  tooltip: string;
  nostr: Rating;
  bluesky: Rating;
  mastodon: Rating;
  farcaster: Rating;
}

const COMPARISON_DATA: ComparisonRow[] = [
  {
    feature: "You own your identity",
    tooltip: "Your account is a cryptographic keypair you control — no company can ban, delete, or impersonate you",
    nostr: "strong",
    bluesky: "partial",
    mastodon: "weak",
    farcaster: "partial",
  },
  {
    feature: "Censorship resistant",
    tooltip: "No single entity can silence you — your posts propagate across independent relays/servers",
    nostr: "strong",
    bluesky: "weak",
    mastodon: "partial",
    farcaster: "weak",
  },
  {
    feature: "Portable follows & data",
    tooltip: "Move your followers, posts, and social graph between apps without losing anything",
    nostr: "strong",
    bluesky: "partial",
    mastodon: "weak",
    farcaster: "partial",
  },
  {
    feature: "Native payments (zaps)",
    tooltip: "Send optional support (Bitcoin/Lightning) directly to creators — it goes 100% to them",
    nostr: "strong",
    bluesky: "none",
    mastodon: "none",
    farcaster: "partial",
  },
  {
    feature: "Web of Trust filtering",
    tooltip: "Spam and content are filtered by your real social network — not a corporate algorithm optimizing for ads",
    nostr: "strong",
    bluesky: "weak",
    mastodon: "weak",
    farcaster: "weak",
  },
  {
    feature: "Encrypted DMs",
    tooltip: "End-to-end encrypted private messages — the platform can't read your conversations",
    nostr: "strong",
    bluesky: "none",
    mastodon: "weak",
    farcaster: "none",
  },
  {
    feature: "Protocol simplicity",
    tooltip: "How easy it is for developers to build new clients and tools on the protocol",
    nostr: "strong",
    bluesky: "partial",
    mastodon: "weak",
    farcaster: "partial",
  },
  {
    feature: "Community relays / servers",
    tooltip: "Run your own relay or server to create a community space you fully control",
    nostr: "strong",
    bluesky: "none",
    mastodon: "strong",
    farcaster: "weak",
  },
  {
    feature: "Account recovery",
    tooltip: "Can you get back into your account if you lose access? Social recovery, email reset, etc.",
    nostr: "weak",
    bluesky: "strong",
    mastodon: "strong",
    farcaster: "partial",
  },
  {
    feature: "Onboarding ease",
    tooltip: "How easy it is for a non-technical person to create an account and start using the network",
    nostr: "partial",
    bluesky: "strong",
    mastodon: "partial",
    farcaster: "weak",
  },
  {
    feature: "Content moderation tools",
    tooltip: "Tools available for community moderators and relay operators to manage harmful content",
    nostr: "partial",
    bluesky: "strong",
    mastodon: "strong",
    farcaster: "partial",
  },
  {
    feature: "Media & rich content",
    tooltip: "Support for images, video, long-form articles, live streaming, and other rich media formats",
    nostr: "partial",
    bluesky: "strong",
    mastodon: "partial",
    farcaster: "partial",
  },
  {
    feature: "Truly decentralized",
    tooltip: "No single company controls the network infrastructure — it works even if any one entity disappears",
    nostr: "strong",
    bluesky: "weak",
    mastodon: "partial",
    farcaster: "weak",
  },
  {
    feature: "Interop with other protocols",
    tooltip: "Can you communicate with users on other networks and protocols?",
    nostr: "partial",
    bluesky: "weak",
    mastodon: "strong",
    farcaster: "weak",
  },
];

function RatingIcon({ rating }: { rating: Rating }) {
  switch (rating) {
    case "strong":
      return <Check className="w-3.5 h-3.5 text-success" />;
    case "partial":
      return <Minus className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />;
    case "weak":
      return <Minus className="w-3.5 h-3.5 text-foreground/70" />;
    case "none":
      return <XIcon className="w-3.5 h-3.5 text-danger" />;
  }
}

function RatingLabel({ rating }: { rating: Rating }) {
  const labels: Record<Rating, string> = {
    strong: "Yes",
    partial: "Partial",
    weak: "Limited",
    none: "No",
  };
  const colors: Record<Rating, string> = {
    strong: "text-success",
    partial: "text-amber-700 dark:text-amber-400",
    weak: "text-orange-700 dark:text-orange-400",
    none: "text-danger",
  };
  return <span className={`text-[12px] font-bold ${colors[rating]}`}>{labels[rating]}</span>;
}

interface ProtocolCardProps {
  name: string;
  tagline: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  bgColor: string;
  borderColor: string;
  architecture: string;
  identity: string;
  launched: string;
  strength: string;
  weakness: string;
}

function ProtocolCard({ name, tagline, icon: Icon, iconColor, bgColor, borderColor, architecture, identity, launched, strength, weakness }: ProtocolCardProps) {
  return (
    <div className={`rounded-[20px] border ${borderColor} ${bgColor} p-4 transition-colors duration-150`}>
      <div className="flex items-center gap-2.5 mb-2.5">
        <div className={`w-8 h-8 rounded-full dark:bg-foreground/[0.05] flex items-center justify-center shrink-0`}>
          <Icon className={`w-4 h-4 ${iconColor}`} />
        </div>
        <div>
          <h3 className="text-[16px] font-semibold text-foreground">{name}</h3>
          <p className="text-[12px] text-muted-foreground">{tagline}</p>
        </div>
      </div>
      <div className="space-y-1.5 text-[12px]">
        <div className="flex gap-2">
          <span className="text-muted-foreground shrink-0 w-20">Architecture</span>
          <span className="text-foreground/70">{architecture}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-muted-foreground shrink-0 w-20">Identity</span>
          <span className="text-foreground/70">{identity}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-muted-foreground shrink-0 w-20">Launched</span>
          <span className="text-foreground/70">{launched}</span>
        </div>
        <div className="mt-2 pt-2 border-t border-border/20 space-y-1">
          <div className="flex gap-2">
            <span className="text-success shrink-0 w-20 font-medium">Strength</span>
            <span className="text-foreground/70">{strength}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-amber-700 dark:text-amber-400 shrink-0 w-20 font-medium">Trade-off</span>
            <span className="text-foreground/70">{weakness}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CountBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = Math.round((count / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] font-bold text-foreground/70 w-20 shrink-0">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-foreground/[0.06] overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[12px] font-bold text-muted-foreground w-8 text-right">{count}/{total}</span>
    </div>
  );
}

export default function NostrVsAlternatives() {
  useDocumentTitle("Nostr vs. the alternatives — Relay Outpost");

  const totals = COMPARISON_DATA.reduce(
    (acc, row) => {
      const count = (protocol: Rating) => protocol === "strong" ? 1 : 0;
      acc.nostr += count(row.nostr);
      acc.bluesky += count(row.bluesky);
      acc.mastodon += count(row.mastodon);
      acc.farcaster += count(row.farcaster);
      return acc;
    },
    { nostr: 0, bluesky: 0, mastodon: 0, farcaster: 0 },
  );
  const total = COMPARISON_DATA.length;

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-in fade-in duration-150">
      <div className="flex items-center gap-3 mb-1">
        {/* Chrome back owns the route (back-affordance.ts) — no hero dupe. */}
        <div className="flex items-center gap-2">
          <OttoMark size={40} label="Relay" className="shrink-0 text-foreground !w-9 !h-9 sm:!w-10 sm:!h-10" />
          <div>
            <h1 className="text-[24px] sm:text-[30px] font-semibold tracking-[-0.025em] leading-[1.1] text-foreground">
              Nostr vs. the alternatives
            </h1>
            <p className="text-[14px] sm:text-[15px] text-muted-foreground mt-1">An honest comparison</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-[20px] border border-border/60 bg-card p-5">
          <p className="text-[15px] text-foreground/75 leading-relaxed">
            The "decentralized social" space has several serious contenders. Each protocol makes different trade-offs between control, usability, independence, and features. This isn't about declaring a winner — it's about understanding those trade-offs so you can decide what matters most to you.
          </p>
          <p className="text-[15px] text-foreground/75 leading-relaxed mt-3">
            We built Relay Outpost on Nostr because we believe <strong className="text-foreground/90">true ownership of identity and data</strong> is the foundation everything else should be built on. But we'll be honest about where Nostr still has ground to cover.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <Globe className="w-3.5 h-3.5 text-foreground/70" />
            <span className="text-[12px] font-medium text-muted-foreground">Comparison · 8 minute read</span>
          </div>
        </div>
      </div>

      <section className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Server className="w-4 h-4 text-foreground/70" />
          <h2 className="text-[15px] font-semibold text-foreground">The protocols</h2>
          <div className="flex-1 h-px bg-border/60" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ProtocolCard
            name="Nostr"
            tagline="Notes and Other Stuff Transmitted by Relays"
            icon={Radio}
            iconColor="text-foreground/75"
            bgColor="bg-card"
            borderColor="border-border/60"
            architecture="Relay network (you choose your relays)"
            identity="Cryptographic keypair (you own it)"
            launched="2020"
            strength="Complete control — you own your keys, data, and identity outright"
            weakness="Steeper learning curve; key management responsibility falls on you"
          />
          <ProtocolCard
            name="Bluesky"
            tagline="AT Protocol (Authenticated Transfer)"
            icon={Globe}
            iconColor="text-foreground/75"
            bgColor="bg-card"
            borderColor="border-border/60"
            architecture="Federated (PDS servers + central relay)"
            identity="DID-based (portable, but company-managed)"
            launched="2023"
            strength="Polished UX; familiar Twitter-like experience; strong moderation tooling"
            weakness="Centralized relay (Big Graph Service) is a single point of control"
          />
          <ProtocolCard
            name="Mastodon"
            tagline="ActivityPub / Fediverse"
            icon={Users}
            iconColor="text-foreground/75"
            bgColor="bg-card"
            borderColor="border-border/60"
            architecture="Federated instances (each server is independent)"
            identity="Server-based (@user@instance.social)"
            launched="2016"
            strength="Mature ecosystem; strong community moderation; interop with wider Fediverse"
            weakness="Identity tied to your instance — if it shuts down, you lose your handle"
          />
          <ProtocolCard
            name="Farcaster"
            tagline="Sufficiently decentralized social"
            icon={Shield}
            iconColor="text-foreground/75"
            bgColor="bg-card"
            borderColor="border-border/60"
            architecture="Hybrid (onchain IDs + offchain hubs)"
            identity="Onchain Ethereum ID (requires fee to register)"
            launched="2022"
            strength="Crypto-native; composable with Ethereum ecosystem; quality community"
            weakness="Paywall to join; heavily dependent on Warpcast client; small network"
          />
        </div>
      </section>

      <section className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Eye className="w-4 h-4 text-foreground/70" />
          <h2 className="text-[15px] font-semibold text-foreground">Scorecard</h2>
          <div className="flex-1 h-px bg-border/60" />
        </div>

        <div className="rounded-[20px] border border-border/60 bg-card p-4 mb-4">
          <div className="space-y-2.5">
            <CountBar label="Nostr" count={totals.nostr} total={total} color="bg-brand" />
            <CountBar label="Bluesky" count={totals.bluesky} total={total} color="bg-foreground/35" />
            <CountBar label="Mastodon" count={totals.mastodon} total={total} color="bg-foreground/35" />
            <CountBar label="Farcaster" count={totals.farcaster} total={total} color="bg-foreground/35" />
          </div>
          <p className="text-[12px] text-muted-foreground mt-3 text-center">Full marks across {total} categories (Strong = full mark)</p>
        </div>

        <div className="rounded-[20px] border border-border/30 dark:border-border/15 overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] bg-foreground/[0.03] border-b border-border/60">
            <div className="px-3 py-2.5 text-[13px] font-bold text-muted-foreground">Feature</div>
            <div className="px-2.5 py-2.5 text-[13px] font-semibold text-foreground/80 text-center w-16 sm:w-20">Nostr</div>
            <div className="px-2.5 py-2.5 text-[13px] font-semibold text-foreground/80 text-center w-16 sm:w-20">Bluesky</div>
            <div className="px-2.5 py-2.5 text-[13px] font-semibold text-foreground/80 text-center w-16 sm:w-20">Mast.</div>
            <div className="px-2.5 py-2.5 text-[13px] font-semibold text-foreground/80 text-center w-16 sm:w-20">Farc.</div>
          </div>
          {COMPARISON_DATA.map((row, i) => (
            <div
              key={row.feature}
              className={`grid grid-cols-[1fr_auto_auto_auto_auto] ${i % 2 === 0 ? "bg-transparent" : "bg-foreground/[0.02]"} ${i < COMPARISON_DATA.length - 1 ? "border-b border-border/10 dark:border-border/5" : ""}`}
              title={row.tooltip}
            >
              <div className="px-3 py-2.5 flex items-center">
                <span className="text-[12px] text-foreground/70 leading-tight">{row.feature}</span>
              </div>
              <div className="px-2.5 py-2.5 flex flex-col items-center justify-center gap-0.5 w-16 sm:w-20">
                <RatingIcon rating={row.nostr} />
                <RatingLabel rating={row.nostr} />
              </div>
              <div className="px-2.5 py-2.5 flex flex-col items-center justify-center gap-0.5 w-16 sm:w-20">
                <RatingIcon rating={row.bluesky} />
                <RatingLabel rating={row.bluesky} />
              </div>
              <div className="px-2.5 py-2.5 flex flex-col items-center justify-center gap-0.5 w-16 sm:w-20">
                <RatingIcon rating={row.mastodon} />
                <RatingLabel rating={row.mastodon} />
              </div>
              <div className="px-2.5 py-2.5 flex flex-col items-center justify-center gap-0.5 w-16 sm:w-20">
                <RatingIcon rating={row.farcaster} />
                <RatingLabel rating={row.farcaster} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Key className="w-4 h-4 text-foreground/70" />
          <h2 className="text-[15px] font-semibold text-foreground">The real differences</h2>
          <div className="flex-1 h-px bg-border/60" />
        </div>

        <div className="space-y-3">
          <div className="rounded-[20px] border border-border/60 bg-card p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-full dark:bg-foreground/[0.05] flex items-center justify-center shrink-0">
                <Key className="w-4 h-4 text-foreground/75" />
              </div>
              <h3 className="text-[16px] font-semibold text-foreground">Identity: owned vs. rented</h3>
            </div>
            <p className="text-[12px] text-foreground/60 leading-relaxed">
              On Nostr, your identity is a cryptographic keypair. Period. No company issued it, no company can revoke it. If every Nostr app disappeared tomorrow, your identity would still work — you'd just need a new app to use it. Bluesky's DIDs are <em>conceptually</em> portable but practically managed by the Bluesky PLC server. Mastodon ties your identity to a server admin. Farcaster puts your ID on Ethereum — ownable but at a cost. Only Nostr gives you full ownership of your identity, with no company in the middle.
            </p>
          </div>

          <div className="rounded-[20px] border border-border/60 bg-card p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-full dark:bg-foreground/[0.05] flex items-center justify-center shrink-0">
                <Shield className="w-4 h-4 text-foreground/70" />
              </div>
              <h3 className="text-[16px] font-semibold text-foreground">Censorship: architecture matters</h3>
            </div>
            <p className="text-[12px] text-foreground/60 leading-relaxed">
              Nostr's relay model means your post goes to multiple independent servers. If one blocks you, the others don't care — your content survives. Bluesky has moderation layers that can hide content network-wide because the central Big Graph Service controls discovery. Mastodon instances can defederate from each other, fragmenting the network. Farcaster's hub network is small enough that coordination between operators is practical. Only Nostr's architecture makes true censorship structurally difficult rather than just policy-based.
            </p>
          </div>

          <div className="rounded-[20px] border border-border/60 bg-card p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-full dark:bg-foreground/[0.05] flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4 text-foreground/75" />
              </div>
              <h3 className="text-[16px] font-semibold text-foreground">Payments: built in vs. bolted on</h3>
            </div>
            <p className="text-[12px] text-foreground/60 leading-relaxed">
              Nostr has native Bitcoin Lightning integration — "zaps" let you send an optional tip to any post or profile instantly. It's not a tip jar you paste into your bio; it's baked into the protocol, and 100% of every zap goes to the person receiving it. Farcaster has some crypto-native tipping through frames, but it's not protocol-level. Bluesky and Mastodon have no native payment capability — you're back to PayPal links in your bio. (Accurate as of August 2026.)
            </p>
          </div>

          <div className="rounded-[20px] border border-border/60 bg-card p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-full dark:bg-foreground/[0.05] flex items-center justify-center shrink-0">
                <Lock className="w-4 h-4 text-foreground/75" />
              </div>
              <h3 className="text-[16px] font-semibold text-foreground">Privacy: encryption as default</h3>
            </div>
            <p className="text-[12px] text-foreground/60 leading-relaxed">
              Nostr supports end-to-end encrypted direct messages (NIP-17) — there is no server-side copy of your conversations for relay operators or app developers to read. Mastodon DMs are technically just restricted-visibility posts that instance admins can read. Bluesky's DMs run through a central server and aren't end-to-end encrypted today. Farcaster has Direct Casts, but no protocol-level end-to-end encrypted messaging. (Accurate as of August 2026.) In a world of data breaches and surveillance, encryption isn't optional — it's essential.
            </p>
          </div>

          <div className="rounded-[20px] border border-border/60 bg-card p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-full dark:bg-foreground/[0.05] flex items-center justify-center shrink-0">
                <Users className="w-4 h-4 text-foreground/70" />
              </div>
              <h3 className="text-[16px] font-semibold text-foreground">Where Nostr is still catching up</h3>
            </div>
            <p className="text-[12px] text-foreground/60 leading-relaxed">
              Let's be honest. Bluesky has a more polished onboarding experience. Mastodon has a more mature moderation ecosystem. Key management on Nostr is still harder than it should be for normal people — losing your private key means losing your identity forever. Media handling and content discovery are improving rapidly but haven't reached parity with Bluesky's refinement. And the network is smaller, which means less content in some niches. These are real gaps. We're working on all of them.
            </p>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Radio className="w-4 h-4 text-foreground/70" />
          <h2 className="text-[15px] font-semibold text-foreground">Why we chose Nostr</h2>
          <div className="flex-1 h-px bg-border/60" />
        </div>

        <div className="rounded-[20px] border border-border/60 bg-card p-5 sm:p-6">
          <p className="text-[15px] text-foreground/75 leading-relaxed">
            We didn't pick Nostr because it's the easiest or the most polished. We picked it because it's the only protocol where <strong className="text-foreground/90">you actually own everything</strong>.
          </p>
          <p className="text-[15px] text-foreground/75 leading-relaxed mt-3">
            Your keys. Your data. Your social graph. Your payments. No central server that becomes the next Facebook. No company that can enshittify the experience once they need revenue. No blockchain gas fees just to post.
          </p>
          <p className="text-[15px] text-foreground/75 leading-relaxed mt-3">
            Nostr is the simplest protocol for human communication where no one company is in control. It's not perfect yet — but it's the right foundation. And foundations matter more than features, because features can be built, but architecture is forever.
          </p>
          <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-border/60">
            <Link
              href="/help/why-decentralization"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-foreground/25 text-[13px] font-medium text-foreground hover:bg-foreground/[0.06] transition-colors duration-150 no-underline"
            >
              Why decentralization matters <ChevronRight className="w-3 h-3" />
            </Link>
            <Link
              href="/help/data-sovereignty"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-foreground/25 text-[13px] font-medium text-foreground hover:bg-foreground/[0.06] transition-colors duration-150 no-underline"
            >
              Owning your data &amp; keys <ChevronRight className="w-3 h-3" />
            </Link>
            <Link
              href="/help/wot-vs-algorithms"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-foreground/25 text-[13px] font-medium text-foreground hover:bg-foreground/[0.06] transition-colors duration-150 no-underline"
            >
              Web of Trust vs. algorithms <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </section>

      <div className="border-t border-border/60 mt-3 pt-4 pb-2 text-center">
        <p className="text-[13px] text-muted-foreground font-medium">
          Relay Outpost — the next phase of the internet
        </p>
      </div>
    </div>
  );
}
