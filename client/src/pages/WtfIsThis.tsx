import { SearchPill } from "@/components/SearchPill";
import { useState, useMemo, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { WtfWelcomeOverlay, shouldShowWtfWelcome, markWtfWelcomeSeen } from "@/components/WtfWelcomeOverlay";
import { restartMissionBriefing } from "@/components/HomeCoachmarks";
import { MISSION_BRIEFING_REGISTRY, BRIEFING_ORDER } from "@/components/MissionBriefing";
import {
  Search, ChevronDown, ChevronUp, ArrowLeft, ExternalLink,
  Zap, Shield, Users, Radio, Key, MessageCircle, Eye,
  Rocket, Globe, Lock, BookOpen, Play, Image as ImageIcon,
  FileText, HelpCircle, Compass, Lightbulb, TrendingUp,
  Sparkles, Star, Heart, Award, Layers, Wifi,
  LifeBuoy, LayoutGrid, LogOut, PlayCircle,
} from "lucide-react";
import { ShieldMatrixIcon } from "@/components/icons/ShieldMatrixIcon";
import { OutpostIcon } from "@/components/icons/OutpostIcon";
import { MessagesIcon } from "@/components/icons/MessagesIcon";
import { BtcZapIcon } from "@/components/NostrPost";
import { WtfAlienIcon } from "@/components/icons/WtfAlienIcon";
import nostrOstrichGif from "@assets/219719339-5eff628c-3470-4cc3-81eb-404f8902de9f_1771392554698.gif";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

function NostrOstrichIcon({ className }: { className?: string }) {
  return <img src={nostrOstrichGif} alt="" className={`object-contain ${className || ""}`} />;
}

type ContentCategory = "all" | "faq" | "guides" | "deep-dives";

interface FAQItem {
  question: string;
  answer: React.ReactNode;
  searchText?: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor?: string;
  tags: string[];
}

interface GuideItem {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  type: "article" | "video" | "infographic";
  tags: string[];
  comingSoon?: boolean;
  href?: string;
}

interface DeepDiveItem {
  title: string;
  subtitle: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  gradient: string;
  type: "article" | "video" | "infographic";
  tags: string[];
  comingSoon?: boolean;
  href?: string;
}

const FAQ_ITEMS: FAQItem[] = [
  {
    question: "Why is signing in different here?",
    answer: <>There's no email or password. Your account is a key that's yours alone — it lives on your device, not in a company database, so no one can lock you out or reset it but you. Keep it saved in this browser (and optionally lock it with a passphrase), or use a browser extension or a separate signer app. It's a little more up front, and then you're set.</>,
    searchText: "sign in signing in login no email no password account is a key on your device browser extension signer app passphrase no forgot password reset",
    icon: Lock,
    tags: ["getting started", "keys & security"],
  },
  {
    question: "What if I lose my key?",
    answer: <>Because no company holds your account, there's no "reset" — so keep a backup. When you sign up we give you a few easy ways: a backup file you download, your key saved into a password manager (like iCloud Keychain, 1Password, or Bitwarden), and a recovery code you can reveal and copy somewhere safe. Keep at least two. If every copy is gone, the account can't be recovered.</>,
    searchText: "lose my key recovery backup no password reset backup file password manager iCloud keychain 1password bitwarden paper recovery code keep two copies",
    icon: LifeBuoy,
    tags: ["keys & security", "getting started"],
  },
  {
    question: "Can I use my account on other apps?",
    answer: <>Yes — that's the whole point of an open network. The same login works in other compatible apps, and your profile, posts, and follows come with you automatically (they don't live in our database). Try Damus or Primal on iPhone, or Amethyst on Android — same you, same followers.</>,
    searchText: "use same account on other apps open network portable damus primal amethyst snort cross app your follows posts profile come with you",
    icon: LayoutGrid,
    tags: ["getting started", "vs other platforms"],
  },
  {
    question: "What's a relay?",
    answer: <>Relays are the servers that store and pass along posts — think of them like radio towers your posts broadcast through. You choose which ones to use, and you're never locked to a single one. <strong>Public relays</strong> are open to everyone — great for reach and discovery, where most people start. <strong>Private relays</strong> are invite- or pay-to-join — quieter, less spam, and you can even run your own for personal or business data that never leaves your control. Your relay, your rules.</>,
    searchText: "what is a relay servers store and pass posts radio towers public relays open private relays invite paid run your own business data your relay your rules",
    icon: Radio,
    tags: ["getting started", "relays & outposts"],
  },
  {
    question: "What's an Outpost?",
    answer: <>An Outpost is your crew's home base on a relay — one place to speak publicly and privately. Each one comes with <strong>Posts</strong> (a social feed like X), <strong>Discussions</strong> (threaded discussions like Reddit), <strong>Chat</strong> (group chat like Discord), <strong>Articles</strong> (a shared knowledge base like a wiki), and an <strong>About</strong> page. If you run the relay, you also get a dashboard to manage members, moderation, and settings. Your community, your rules.</>,
    searchText: "what is an outpost community built around a relay home base posts timeline discussions waves chat channels articles horizon about dashboard moderation members your community your rules",
    icon: OutpostIcon,
    tags: ["relays & outposts", "social"],
  },
  {
    question: "What's my account key?",
    answer: <>Your account is built on a pair of keys. Your <strong>public key</strong> is your shareable identity — like a username nobody can fake or take from you; people use it to follow and verify you in any app. Your <strong>secret key</strong> is the private half that proves it's really you — never share it, and keep it backed up. One you hand out, one you guard.</>,
    searchText: "account key public key shareable identity username secret key private never share back up keep safe verify you npub nsec",
    icon: Users,
    tags: ["keys & security"],
  },
  {
    question: "How do you keep spam out without an algorithm?",
    answer: <>Your own circle decides — not a company's engagement algorithm. The people you follow, and the people <em>they</em> trust, quietly vouch for who's real, which lifts genuine voices and pushes spam down. Turn it on with one tap (<strong>Calculate</strong> on the Trust &amp; Safety page) — it runs quietly in the background and powers a "Trusted first" option in search plus cleaner feeds. Fine-tune everything under <strong>Trust &amp; Safety</strong>.</>,
    searchText: "how do you keep spam out web of trust your circle vouch trusted first calculate trust and safety no algorithm moderation mute block trust and safety",
    icon: Shield,
    tags: ["web of trust"],
  },
  {
    question: "What are zaps?",
    answer: <>Zaps are small, optional Bitcoin tips — a way to say thanks with real value, even a fraction of a cent. Instead of just a like, you can send someone an optional tip of appreciation — it goes 100% to them, and Relay Outpost takes nothing. They're fast, nearly free, and always the sender's choice.</>,
    searchText: "what are zaps optional bitcoin tips lightning send a tip appreciation goes 100% to them sats",
    icon: BtcZapIcon,
    iconColor: "text-[#F7931A]",
    tags: ["zaps & bitcoin"],
  },
  {
    question: "Is this like X or Instagram?",
    answer: "It has a familiar feed — post, reply, repost, and like — but you're in charge, not a company. You own your account, you pick where your posts live, and no algorithm decides who sees your work. No company can take your account away — individual servers can decline to host you, but your identity and followers move with you — and nobody can sell your data out from under you.",
    icon: Compass,
    tags: ["vs other platforms", "getting started"],
  },
  {
    question: "Who can see my messages?",
    answer: "Your direct messages are end-to-end encrypted — meaning only you and the person you're talking to can read them. Not even the relays that deliver the messages can see what's inside. No company, no server admin, no third party. It's true private messaging, built into the protocol from the ground up.",
    icon: MessagesIcon,
    tags: ["privacy"],
  },

  {
    question: "Can I delete my posts or account?",
    answer: <>Yes. You can request deletion of a post and most relays will honor it — though, like an email that's already been delivered, copies may have spread to other servers, so there's no guaranteed wipe everywhere. To leave entirely, go to <Link href="/settings/danger" className="text-brand hover:underline font-medium">Settings → Advanced &amp; danger zone</Link> and remove your account; we'll ask every relay to delete what they hold and clear your account from this device.</>,
    searchText: "can I delete my post account leave quit remove erase request deletion relays honor copies may persist vanish settings advanced danger zone",
    icon: LogOut,
    tags: ["privacy", "keys & security", "getting started"],
  },
];

const GUIDE_ITEMS: GuideItem[] = [
  {
    title: "Your First 10 Minutes",
    description: "A quick-start walkthrough from login to your first post. Everything you need to get oriented.",
    icon: Rocket,
    iconColor: "text-emerald-500",
    type: "article",
    tags: ["getting started"],
    href: "/help/first-10-minutes",
  },
  {
    title: "Setting Up Your Outpost",
    description: "How to discover relay communities, join outposts, and build your home base.",
    icon: Radio,
    iconColor: "text-brand",
    type: "article",
    tags: ["relays & outposts"],
    href: "/help/setting-up-outpost",
  },
  {
    title: "Set up zaps",
    description: "Connect a wallet and send your first zap — optional tips that go 100% to the recipient.",
    icon: BtcZapIcon,
    iconColor: "text-amber-500",
    type: "article",
    tags: ["zaps & bitcoin"],
    href: "/help/connecting-wallet",
  },
  {
    title: "Using the Content Calendar",
    description: "Discover events, RSVP to meetups, schedule future posts, and manage your publishing timeline.",
    icon: BookOpen,
    iconColor: "text-cyan-500",
    type: "article",
    tags: ["social"],
    href: "/help/content-calendar",
  },
  {
    title: "Private messages",
    description: "How direct messages stay end-to-end encrypted — only you and the recipient can read them.",
    icon: MessageCircle,
    iconColor: "text-pink-500",
    type: "article",
    tags: ["privacy"],
    href: "/help/encrypted-messages",
  },
  {
    title: "Post with privacy",
    description: "Choose who sees your posts, and what hidden info gets removed before you publish.",
    icon: Lock,
    iconColor: "text-red-500",
    type: "article",
    tags: ["privacy"],
    href: "/help/publishing-privacy",
  },
  {
    title: "Your people (Crew & Orbit)",
    description: "Follow people, build your circle, and see who you can trust at a glance.",
    icon: Users,
    iconColor: "text-brand",
    type: "article",
    tags: ["social"],
    href: "/help/managing-crew",
  },
];

const DEEP_DIVE_ITEMS: DeepDiveItem[] = [
  {
    title: "Why Decentralization Matters",
    subtitle: "The case for owning your digital identity",
    description: "Centralized platforms own your content, your connections, and your audience. One policy change can erase years of work. Nostr returns ownership to you — permanently.",
    icon: Globe,
    iconColor: "text-blue-700 dark:text-blue-400",
    gradient: "from-blue-500/10 to-brand/10",
    type: "article",
    tags: ["big ideas", "getting started"],
    href: "/help/why-decentralization",
  },
  {
    title: "How Web of Trust Replaces Algorithms",
    subtitle: "From corporate curation to community trust",
    description: "Social media algorithms chase engagement — outrage, addiction. A Web of Trust ranks by the people you actually know and respect instead. Here's how it works and why it's better.",
    icon: Shield,
    iconColor: "text-emerald-800 dark:text-emerald-400",
    gradient: "from-emerald-500/10 to-teal-500/10",
    type: "article",
    tags: ["web of trust", "big ideas"],
    href: "/help/wot-vs-algorithms",
  },
  {
    title: "Relay Communities vs. Platforms",
    subtitle: "Why Outposts are the future of online communities",
    description: "Discord servers, Subreddits, Facebook Groups — all controlled by one company. Outposts are community spaces with no lock-in — if a server disappears, your identity and community connections move with you.",
    icon: Rocket,
    iconColor: "text-brand",
    gradient: "from-brand/10 to-brand/10",
    type: "article",
    tags: ["relays & outposts", "big ideas", "social"],
    href: "/help/relay-communities",
  },
  {
    title: "Owning Your Data & Keys",
    subtitle: "You own your identity. Period.",
    description: "Your private key is your identity, your login, and your proof of authorship — all in one. No email, no phone number, no recovery form. Here's why that's a feature, not a bug.",
    icon: Key,
    iconColor: "text-amber-800 dark:text-amber-400",
    gradient: "from-amber-500/10 to-orange-500/10",
    type: "article",
    tags: ["keys & security", "big ideas", "privacy"],
    href: "/help/data-sovereignty",
  },
  {
    title: "Where Nostr is Heading",
    subtitle: "The roadmap for the next phase of the internet",
    description: "New kinds of apps, payments, and communities are being built on Nostr every month. Here's where it's heading — and why it matters for you.",
    icon: NostrOstrichIcon,
    iconColor: "",
    gradient: "from-pink-500/10 to-rose-500/10",
    type: "article",
    tags: ["big ideas"],
    href: "/help/where-nostr-is-heading",
  },
  {
    title: "Nostr vs. The Alternatives",
    subtitle: "How Nostr stacks up against Bluesky, Mastodon, and Farcaster",
    description: "A fair, honest comparison of the decentralized social protocols. Where Nostr excels, where it's still catching up, and why we chose to build here.",
    icon: Layers,
    iconColor: "text-cyan-800 dark:text-cyan-400",
    gradient: "from-cyan-500/10 to-sky-500/10",
    type: "article",
    tags: ["vs other platforms"],
    href: "/help/nostr-vs-alternatives",
  },
];

// Tab order leads with the concepts a newcomer meets first in the app
// (Outposts, the trust-based feed) before the deeper / advanced topics.
const ALL_TAGS = [
  "getting started", "relays & outposts", "web of trust",
  "keys & security", "zaps & bitcoin", "social",
  "privacy", "vs other platforms", "big ideas",
];

// FAQ display order — adoption arc: the two structural concepts first
// (relay → outpost), then orientation, identity, trust, money, then the
// advanced/edge questions last. Matched by a unique substring of each question
// so it's robust to punctuation. Anything unlisted falls to the end.
const FAQ_ORDER_KEYS = [
  "like X",            // Is this like X or Instagram?
  "signing in",        // Why is signing in different here?
  "account key",       // What's my account key?
  "lose my key",       // What if I lose my key?
  "other apps",        // Can I use my account on other apps?
  "a relay?",          // What's a relay?
  "an Outpost?",       // What's an Outpost?
  "are zaps",          // What are zaps?
  "keep spam out",     // How do you keep spam out…
  "see my messages",   // Who can see my messages?
  "delete my posts",   // Can I delete my posts or account?
];
function faqOrder(question: string): number {
  const i = FAQ_ORDER_KEYS.findIndex((k) => question.includes(k));
  return i === -1 ? 999 : i;
}

function ContentTypeBadge({ type }: { type: "article" | "video" | "infographic" }) {
  const config = {
    article: { icon: FileText, label: "Article", color: "text-blue-500/70 bg-blue-500/8 border-blue-500/15" },
    video: { icon: Play, label: "Video", color: "text-red-500/70 bg-red-500/8 border-red-500/15" },
    infographic: { icon: ImageIcon, label: "Infographic", color: "text-green-500/70 bg-green-500/8 border-green-500/15" },
  }[type];

  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${config.color}`}>
      <Icon className="w-2.5 h-2.5" />
      {config.label}
    </span>
  );
}

function FAQAccordion({ item }: { item: FAQItem }) {
  const [open, setOpen] = useState(false);
  const Icon = item.icon;

  return (
    <div
      className={`rounded-lg border transition-all duration-300 ${
        open
          ? "border-brand/25 dark:border-brand/20 bg-brand/[0.02]/[0.03] shadow-[0_0_12px_rgba(139,92,246,0.06)]"
          : "border-border/30 dark:border-border/15 bg-white/50 dark:bg-muted/10 hover:border-brand/15 dark:hover:border-brand/10"
      }`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer"
      >
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-300 ${
          open ? "bg-brand/15 dark:bg-brand/20" : "bg-muted/30 dark:bg-muted/15"
        }`}>
          <Icon className={`w-4 h-4 transition-colors duration-300 ${
            item.iconColor ? item.iconColor : open ? "text-brand" : "text-muted-foreground/60"
          }`} />
        </div>
        <span className={`flex-1 text-sm font-medium transition-colors duration-200 ${
          open ? "text-foreground" : "text-foreground/80"
        }`}>
          {item.question}
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-brand/60 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground/40 shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-0">
          <div className="ml-11 text-sm text-foreground/70 dark:text-muted-foreground leading-relaxed">
            {item.answer}
          </div>
        </div>
      )}
    </div>
  );
}

function GuideCard({ item }: { item: GuideItem }) {
  const Icon = item.icon;

  const content = (
    <>
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand/10 to-brand/10 border border-brand/10 flex items-center justify-center shrink-0">
            <Icon className={`w-5 h-5 ${item.iconColor}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-foreground/90 truncate flex-1">{item.title}</h3>
              {item.comingSoon && (
                <span className="inline-flex items-center shrink-0 px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider bg-brand/10 text-brand/70 border border-brand/15">
                  Soon
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground/60 leading-relaxed line-clamp-2">{item.description}</p>
            <div className="flex items-center gap-2 mt-3">
              <ContentTypeBadge type={item.type} />
            </div>
          </div>
        </div>
      </div>
      <div className="h-1 w-full bg-gradient-to-r from-brand/20 via-brand/20 to-brand/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
    </>
  );

  const className = "group relative rounded-xl border border-border/30 dark:border-border/15 bg-white/60 dark:bg-muted/10 hover:border-brand/20 dark:hover:border-brand/15 transition-all duration-300 hover:shadow-[0_4px_20px_rgba(139,92,246,0.06)] overflow-hidden";

  if (item.href) {
    return <Link href={item.href} className={`block ${className}`}>{content}</Link>;
  }

  return <div className={className}>{content}</div>;
}

function DeepDiveCard({ item }: { item: DeepDiveItem }) {
  const Icon = item.icon;

  const content = (
    <>
      <div className={`absolute inset-0 bg-gradient-to-br ${item.gradient} opacity-40 dark:opacity-30`} />
      <div className="relative p-5 sm:p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-11 h-11 rounded-xl bg-white/60 dark:bg-black/30 border border-white/30 dark:border-white/5 flex items-center justify-center shrink-0 shadow-sm backdrop-blur-sm">
            <Icon className={`w-5.5 h-5.5 ${item.iconColor}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-foreground/95 truncate flex-1">{item.title}</h3>
              {item.comingSoon && (
                <span className="inline-flex items-center shrink-0 px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider bg-white/60 dark:bg-black/40 text-brand/70 border border-brand/15 backdrop-blur-sm">
                  Soon
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground/50 font-medium">{item.subtitle}</p>
          </div>
        </div>
        <p className="text-xs text-foreground/60 dark:text-muted-foreground/70 leading-relaxed">{item.description}</p>
        <div className="flex items-center gap-2 mt-4">
          <ContentTypeBadge type={item.type} />
        </div>
      </div>
      <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-brand/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
    </>
  );

  const className = "group relative rounded-xl border border-border/30 dark:border-border/15 overflow-hidden transition-all duration-300 hover:border-brand/20 dark:hover:border-brand/15 hover:shadow-[0_8px_30px_rgba(139,92,246,0.08)]";

  if (item.href) {
    return <Link href={item.href} className={`block ${className}`}>{content}</Link>;
  }

  return <div className={className}>{content}</div>;
}

export default function WtfIsThis() {
  useDocumentTitle("Help & Guides — Relay Outpost");
  const [activeCategory, setActiveCategory] = useState<ContentCategory>("guides");
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedTag, setExpandedTag] = useState<string | null>(null);
  const { pubkey } = useNostrAuth();
  const [, setLocation] = useLocation();
  const [replayPickerOpen, setReplayPickerOpen] = useState(false);
  const handleRestartTour = (pageId: string, path: string) => {
    setReplayPickerOpen(false);
    restartMissionBriefing(pageId);
    setLocation(path);
  };
  // Derived from BRIEFING_ORDER + the registry so the replay picker and the
  // last-slide hand-off can never drift out of order or fall out of sync.
  const replayablePages: { pageId: string; label: string; path: string }[] = BRIEFING_ORDER
    .map((pageId) => {
      const entry = MISSION_BRIEFING_REGISTRY[pageId];
      return entry ? { pageId, label: entry.label, path: entry.path } : null;
    })
    .filter((p): p is { pageId: string; label: string; path: string } => p !== null);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  useEffect(() => {
    if (pubkey) {
      setWelcomeOpen(false);
    } else if (shouldShowWtfWelcome(pubkey)) {
      setWelcomeOpen(true);
    }
  }, [pubkey]);
  const dismissWelcome = () => {
    markWtfWelcomeSeen();
    setWelcomeOpen(false);
  };

  const categories: { value: ContentCategory; label: string; icon: typeof HelpCircle }[] = [
    { value: "guides", label: "Start here", icon: Rocket },
    { value: "faq", label: "Questions", icon: HelpCircle },
    { value: "deep-dives", label: "Go deeper", icon: Lightbulb },
  ];

  const filteredFAQs = useMemo(() => {
    if (!searchQuery.trim() && activeCategory !== "all" && activeCategory !== "faq") return [];
    return FAQ_ITEMS.filter(item => {
      if (!searchQuery.trim()) return expandedTag ? item.tags.includes(expandedTag) : true;
      const q = searchQuery.toLowerCase();
      const answerText = item.searchText || (typeof item.answer === "string" ? item.answer : "");
      return item.question.toLowerCase().includes(q) || answerText.toLowerCase().includes(q) || item.tags.some(t => t.includes(q));
    }).sort((a, b) => faqOrder(a.question) - faqOrder(b.question));
  }, [searchQuery, activeCategory, expandedTag]);

  const filteredGuides = useMemo(() => {
    if (!searchQuery.trim() && activeCategory !== "all" && activeCategory !== "guides") return [];
    return GUIDE_ITEMS.filter(item => {
      if (!searchQuery.trim()) return expandedTag ? item.tags.includes(expandedTag) : true;
      const q = searchQuery.toLowerCase();
      return item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q) || item.tags.some(t => t.includes(q));
    });
  }, [searchQuery, activeCategory, expandedTag]);

  const filteredDeepDives = useMemo(() => {
    if (!searchQuery.trim() && activeCategory !== "all" && activeCategory !== "deep-dives") return [];
    return DEEP_DIVE_ITEMS.filter(item => {
      if (!searchQuery.trim()) return expandedTag ? item.tags.includes(expandedTag) : true;
      const q = searchQuery.toLowerCase();
      return item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q) || item.tags.some(t => t.includes(q));
    });
  }, [searchQuery, activeCategory, expandedTag]);

  const hasResults = filteredFAQs.length > 0 || filteredGuides.length > 0 || filteredDeepDives.length > 0;

  return (
    <div className="relative">
      {/* Lunar-frontier backdrop — TOP section only, behind the content (scrolls with the page) */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 bottom-1/2 z-0 pointer-events-none bg-cover bg-center"
        style={{
          backgroundImage: "url(/images/landing/help-bg.webp)",
          opacity: 0.07,
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, #000 28%, rgba(0,0,0,0.55) 60%, transparent 88%)",
          maskImage: "linear-gradient(to bottom, transparent 0%, #000 28%, rgba(0,0,0,0.55) 60%, transparent 88%)",
        }}
      />
      {/* Footprints backdrop — BOTTOM section only, meeting the lunar above. Faint, top-faded. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-1/2 bottom-0 z-0 pointer-events-none bg-cover bg-bottom bg-no-repeat"
        style={{
          backgroundImage: "url(/images/landing/help-footprints.webp)",
          opacity: 0.05,
          WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 32%, rgba(0,0,0,0.18) 52%, rgba(0,0,0,0.55) 76%, #000 100%)",
          maskImage: "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 32%, rgba(0,0,0,0.18) 52%, rgba(0,0,0,0.55) 76%, #000 100%)",
        }}
      />
      {/* Galaxy — very subtle, centered on the midline to bridge the two backdrops */}
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
    <div className="relative z-10 max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-in fade-in duration-300">
      <div className="flex items-center gap-3 mb-1">
        <Link href="/" className="text-muted-foreground/50 hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex items-center gap-2">
          <div className="relative shrink-0 -rotate-[10deg]">
            <WtfAlienIcon className="w-9 h-9 text-brand drop-shadow-[0_0_10px_rgba(109,40,217,0.4)] dark:drop-shadow-[0_0_12px_rgba(139,92,246,0.45)]" />
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-brand shadow-[0_0_6px_rgba(109,40,217,0.5)]" />
          </div>
          <div>
            <h1
              className="text-lg sm:text-xl font-black tracking-tight leading-none text-brand dark:text-brand/90"
            >
              Help &amp; Guides
            </h1>
            <p className="text-[10px] text-brand/40 dark:text-brand/30 font-bold uppercase tracking-[0.2em] mt-0.5 ml-0.5">get started, post &amp; connect</p>
          </div>
        </div>
        {pubkey && (
          <div className="ml-auto">
            <Popover open={replayPickerOpen} onOpenChange={setReplayPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md border border-brand/25 bg-brand/[0.06] hover:bg-brand/[0.12] px-2.5 py-1.5 text-[10px] font-brand uppercase tracking-[0.15em] text-brand transition-colors"
                  data-testid="button-restart-mission-briefing"
                  title="Replay a page briefing"
                >
                  <PlayCircle className="w-3.5 h-3.5" />
                  Replay briefing
                  <ChevronDown className="w-3 h-3 opacity-60" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-1.5">
                <p className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
                  Pick a tour to replay
                </p>
                {replayablePages.map((p) => (
                  <button
                    key={p.pageId}
                    type="button"
                    onClick={() => handleRestartTour(p.pageId, p.path)}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors cursor-pointer"
                    data-testid={`button-replay-briefing-${p.pageId}`}
                  >
                    <PlayCircle className="w-3.5 h-3.5 text-brand/70 shrink-0" />
                    <span className="truncate">{p.label}</span>
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>

      <div className="mt-5 mb-4">
        <SearchPill
          placeholder="Search questions, guides, and topics..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="hidden sm:flex items-center gap-1.5 mb-3">
        {categories.map((cat) => {
          const Icon = cat.icon;
          return (
            <button
              key={cat.value}
              onClick={() => { setActiveCategory(cat.value); setExpandedTag(null); }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-200 ${
                activeCategory === cat.value
                  ? "bg-brand/10 text-brand border border-brand/20"
                  : "bg-transparent text-muted-foreground/60 hover:text-foreground/70 hover:bg-muted/20 border border-transparent"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {cat.label}
            </button>
          );
        })}
      </div>
      <div className="sm:hidden mb-3">
        <Popover open={catDropdownOpen} onOpenChange={setCatDropdownOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="w-full justify-between">
              <span className="flex items-center gap-1.5">
                {(() => { const active = categories.find(c => c.value === activeCategory); return active ? <><active.icon className="w-3.5 h-3.5" />{active.label}</> : "Category"; })()}
              </span>
              <ChevronDown className="w-3.5 h-3.5 ml-2 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-1.5">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const isActive = activeCategory === cat.value;
              return (
                <button
                  key={cat.value}
                  onClick={() => { setActiveCategory(cat.value); setExpandedTag(null); setCatDropdownOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer ${
                    isActive ? "bg-brand/10 text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  {isActive && <span className="w-1 h-1 rounded-full bg-brand shrink-0" />}
                  <Icon className="w-3.5 h-3.5" />
                  {cat.label}
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
      </div>

      {!searchQuery.trim() && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          {ALL_TAGS.map((tag) => (
            <button
              key={tag}
              onClick={() => { setExpandedTag(expandedTag === tag ? null : tag); setActiveCategory("all"); }}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all duration-200 ${
                expandedTag === tag
                  ? "bg-brand/15 text-brand border border-brand/20"
                  : "bg-muted/20 text-muted-foreground/50 hover:text-muted-foreground/70 hover:bg-muted/30 border border-transparent"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {!hasResults && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Search className="w-8 h-8 text-muted-foreground/20 mb-3" />
          <p className="text-sm text-muted-foreground/60">No results found</p>
          <p className="text-xs text-muted-foreground/40 mt-1">Try a different search term or category</p>
        </div>
      )}

      {filteredFAQs.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <HelpCircle className="w-4 h-4 text-brand/60" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/50">Questions</h2>
            <div className="flex-1 h-px bg-gradient-to-r from-brand/10 to-transparent" />
          </div>
          <div className="space-y-2">
            {filteredFAQs.map((item, i) => (
              <FAQAccordion key={i} item={item} />
            ))}
          </div>
        </section>
      )}

      {filteredGuides.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-4 h-4 text-brand/60" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/50">Start here</h2>
            <div className="flex-1 h-px bg-gradient-to-r from-brand/10 to-transparent" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredGuides.map((item, i) => (
              <GuideCard key={i} item={item} />
            ))}
          </div>
        </section>
      )}

      {filteredDeepDives.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-4 h-4 text-brand/60" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/50">Go deeper</h2>
            <div className="flex-1 h-px bg-gradient-to-r from-brand/10 to-transparent" />
          </div>
          <div className="grid grid-cols-1 gap-3">
            {filteredDeepDives.map((item, i) => (
              <DeepDiveCard key={i} item={item} />
            ))}
          </div>
        </section>
      )}

      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Star className="w-4 h-4 text-brand/60" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/50">Resources</h2>
          <div className="flex-1 h-px bg-gradient-to-r from-brand/10 to-transparent" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <a
            href="https://nostr.com"
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-xl border border-border/30 dark:border-border/15 bg-white/50 dark:bg-muted/10 hover:border-brand/20 p-4 transition-all duration-300 hover:shadow-[0_4px_16px_rgba(139,92,246,0.06)]"
          >
            <div className="flex items-center gap-2 mb-2">
              <Globe className="w-4 h-4 text-brand/70" />
              <span className="text-xs font-semibold text-foreground/80">nostr.com</span>
              <ExternalLink className="w-3 h-3 text-muted-foreground/30 group-hover:text-brand/50 transition-colors ml-auto" />
            </div>
            <p className="text-[11px] text-muted-foreground/50 leading-relaxed">Explore the open network and other apps you can use</p>
          </a>
          <a
            href="https://brainstorm.nosfabrica.com/what-is-wot"
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-xl border border-border/30 dark:border-border/15 bg-white/50 dark:bg-muted/10 hover:border-brand/20 p-4 transition-all duration-300 hover:shadow-[0_4px_16px_rgba(139,92,246,0.06)]"
          >
            <div className="flex items-center gap-2 mb-2">
              <ShieldMatrixIcon className="w-4 h-4 text-brand/70" />
              <span className="text-xs font-semibold text-foreground/80">Web of Trust</span>
              <ExternalLink className="w-3 h-3 text-muted-foreground/30 group-hover:text-brand/50 transition-colors ml-auto" />
            </div>
            <p className="text-[11px] text-muted-foreground/50 leading-relaxed">Learn how trust scoring keeps your feed clean</p>
          </a>
          <a
            href="https://nostrcg.github.io/userguide/"
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-xl border border-border/30 dark:border-border/15 bg-white/50 dark:bg-muted/10 hover:border-brand/20 p-4 transition-all duration-300 hover:shadow-[0_4px_16px_rgba(139,92,246,0.06)]"
          >
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-4 h-4 text-brand/70" />
              <span className="text-xs font-semibold text-foreground/80">Nostr Guide</span>
              <ExternalLink className="w-3 h-3 text-muted-foreground/30 group-hover:text-brand/50 transition-colors ml-auto" />
            </div>
            <p className="text-[11px] text-muted-foreground/50 leading-relaxed">A friendly, in-depth beginner's guide</p>
          </a>
        </div>
      </section>

      <div className="border-t border-black/[0.06] dark:border-white/[0.04] mt-3 pt-4 pb-2 text-center">
        <p className="text-[10px] text-muted-foreground/30 font-medium uppercase tracking-wider">
          Relay Outpost — The Next Phase of the Internet
        </p>
      </div>

      <WtfWelcomeOverlay open={welcomeOpen} onDismiss={dismissWelcome} />
    </div>
    </div>
  );
}
