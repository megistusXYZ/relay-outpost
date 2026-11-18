import { SearchPill } from "@/components/SearchPill";
import { OttoEmpty } from "@/components/OttoEmpty";
import { useState, useMemo, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { WtfWelcomeOverlay, shouldShowWtfWelcome, markWtfWelcomeSeen } from "@/components/WtfWelcomeOverlay";
import { restartMissionBriefing } from "@/components/HomeCoachmarks";
import { MISSION_BRIEFING_REGISTRY, BRIEFING_ORDER } from "@/components/MissionBriefing";
import {
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  ExternalLink,
  Shield,
  Users,
  Radio,
  Key,
  MessageCircle,
  Rocket,
  Globe,
  Lock,
  BookOpen,
  Play,
  Image as ImageIcon,
  FileText,
  HelpCircle,
  Compass,
  Lightbulb,
  Star,
  Layers,
  LifeBuoy,
  LayoutGrid,
  LogOut,
  PlayCircle,
} from "lucide-react";
import { ShieldMatrixIcon } from "@/components/icons/ShieldMatrixIcon";
import { OutpostIcon } from "@/components/icons/OutpostIcon";
import { MessagesIcon } from "@/components/icons/MessagesIcon";
import { BtcZapIcon } from "@/components/NostrPost";
import { OttoMark } from "@/components/OttoMark";
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
  tags: string[];
}

interface GuideItem {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
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
  type: "article" | "video" | "infographic";
  tags: string[];
  comingSoon?: boolean;
  href?: string;
}

const FAQ_ITEMS: FAQItem[] = [
  {
    question: "Is this like X or Instagram?",
    answer: "It has a familiar feed: post, reply, repost, like. The difference is who's in charge. You own your account, you choose who you hear from, and no company's algorithm decides who sees your posts. No one can take your account away, and your followers come with you if you ever move to another app.",
    icon: Compass,
    tags: ["vs other platforms", "getting started"],
  },
  {
    question: "What is \"your space\"?",
    answer: <>A new account starts in <strong>your space</strong>: your communities and the people you follow, and nothing else. That's on purpose. The rest of the network is big and nobody moderates all of it, so you step into it only when you choose. One switch, <strong>The wider network</strong>, opens it up: public posts, Discover, trending, and public communities. You can turn it off again any time, in Settings › Your space.</>,
    searchText: "your space wider network switch new account private start discover trending public posts settings off",
    icon: Compass,
    tags: ["getting started", "privacy"],
  },
  {
    question: "Why is signing in different here?",
    answer: <>There's no email and no company password. Your account is a <strong>key</strong> that's yours alone. It lives on your device, so nobody can lock you out, and nobody can reset it for you either. Day to day you unlock the copy kept in this browser with a <strong>password for this browser</strong>, or with Touch ID or Face ID. That password only opens this browser's copy; your key is what gets you in anywhere.</>,
    searchText: "sign in signing in login no email no password account is a key on your device password for this browser touch id face id",
    icon: Lock,
    tags: ["getting started", "keys & security"],
  },
  {
    question: "What's my key, and how do I save it?",
    answer: <>Your key is the one thing that is your account. Anyone holding it can act as you; nobody, including us, can replace it. The last step of signing up is <strong>Save your key</strong>: save the key file (or put the key in your password manager), then tap <strong>Check it works</strong>, which reads the file back and confirms it opens your account. You can do it later from your Account page, where the row says Not saved, Saved, or Saved and checked.</>,
    searchText: "account key save your key key file check it works password manager not saved saved and checked account page",
    icon: Key,
    tags: ["keys & security", "getting started"],
  },
  {
    question: "What if I lose my key?",
    answer: <>If the key file is gone and this browser is cleared, the account is gone. There is no reset, because no company holds a copy. That's why the app asks you to save the key and check it, and reminds you until you do: in Chats a day after you sign up, and on any community you make. Two copies in two places is the habit.</>,
    searchText: "lose my key no reset gone cleared browser reminder two copies",
    icon: LifeBuoy,
    tags: ["keys & security"],
  },
  {
    question: "Can I use my account on other apps?",
    answer: <>Yes. Your key works in any app built on the same open network, and your profile, posts and follows come with you, because they were never in our database. Sign in there with your key file, the same one you saved here. Damus and Primal on iPhone and Amethyst on Android are popular ones.</>,
    searchText: "use same account on other apps open network portable damus primal amethyst key file follows posts profile come with you",
    icon: LayoutGrid,
    tags: ["getting started", "vs other platforms"],
  },
  {
    question: "What's a community?",
    answer: <>A community is a private place for your people: group chats with rooms, end-to-end encrypted, where you pick who's in it. Make one in a minute from Welcome or your Account page ("Name your community"), then send the invite link. Only people with the link can join. Public communities from across the network show up in Communities once the wider network is on.</>,
    searchText: "what is a community private group chat rooms encrypted invite link name your community public communities",
    icon: OutpostIcon,
    tags: ["relays & communities", "social"],
  },
  {
    question: "Who can read my messages and hear my calls?",
    answer: <>Private messages and community chats are end-to-end encrypted: only the people in the conversation can read them. Not the servers that carry them, not us. Calls work the same way. Only members of the group can join a call, and nothing leaves the room. Calls are still being tested, so they're off until you turn them on in Settings › Calls.</>,
    searchText: "who can see my messages private end-to-end encrypted group chat calls settings calls members only",
    icon: MessagesIcon,
    tags: ["privacy"],
  },
  {
    question: "How do you keep spam and nasty stuff away?",
    answer: <>Your own circle decides, not a company's engagement machine. People you follow, and the people they trust, quietly vouch for who's real; that lifts real voices and sinks spam. You pick how strict it is in Trust &amp; safety: <strong>Careful</strong>, <strong>Balanced</strong> or <strong>See everything</strong>. New accounts start on Balanced, and the first time you open the wider network it goes to Careful, with pictures from people outside your space blurred until you tap them. Loosen any of it when you're ready.</>,
    searchText: "spam offensive content trust safety careful balanced see everything blur pictures outside your space mute block report",
    icon: Shield,
    tags: ["web of trust", "privacy"],
  },
  {
    question: "What's a relay?",
    answer: <>Relays are the servers that store and pass along posts, like post offices for the network. Your account uses two well-known ones to start, so friends on other apps can find you, and your communities add their own. You never depend on just one, and you can run your own. You don't need to think about relays day to day; they're in Settings when you want them.</>,
    searchText: "what is a relay servers store and pass posts run your own settings relays",
    icon: Radio,
    tags: ["relays & communities"],
  },
  {
    question: "Can I read posts in other languages?",
    answer: <>Yes. A post in another language shows a <strong>Translate</strong> link under it. The translation comes from a public translation service, so it isn't applied to private messages.</>,
    searchText: "translate posts other languages translation link",
    icon: Globe,
    tags: ["social", "getting started"],
  },
  {
    question: "What are zaps?",
    answer: <>Zaps are small, optional tips in bitcoin: a way to say thanks with something real, even a fraction of a cent. The money goes straight from your wallet to theirs. Relay Outpost never holds it and never takes a cut. You connect your own wallet app once, and you approve every payment.</>,
    searchText: "what are zaps optional bitcoin tips lightning send a tip wallet",
    icon: BtcZapIcon,
    tags: ["zaps & bitcoin"],
  },
  {
    question: "Can I edit an article after publishing?",
    answer: <>Yes. Open the article and tap the pencil, <strong>Edit article</strong>, or find it under <Link href="/account?tab=media" className="text-brand hover:underline font-medium">Account → Media → Articles</Link>. Change the title, cover picture, hashtags or text, then tap <strong>Save changes</strong>. The link stays the same and readers see the new version, here and in other Nostr apps. <strong>Delete article</strong> sits next to Edit: relays that honour deletions remove it, though copies elsewhere may remain.</>,
    searchText: "edit article change update fix typo add photo cover picture hashtags save changes delete article published long form",
    icon: FileText,
    tags: ["social", "getting started"],
  },
  {
    question: "Can I delete my posts or account?",
    answer: <>Yes. Every post has <strong>Delete</strong> in its menu, and articles have it next to Edit. Inside your community it's a removal. On the wider network it's a request: relays that honour deletions remove it, and we tell you afterwards how many did. Copies elsewhere may remain, like an email that's already arrived. A deleted post disappears for everyone using Relay Outpost. A new post also waits five seconds with <strong>Undo</strong>, in case of a typo. Private messages can only be removed from this device; the other person keeps their copy. To leave entirely, go to <Link href="/settings/danger" className="text-brand hover:underline font-medium">Settings → Advanced &amp; danger zone</Link>: we ask every relay to delete what it holds and clear your account from this device.</>,
    searchText: "can I delete my post account leave quit remove erase undo request deletion private message settings advanced danger zone",
    icon: LogOut,
    tags: ["privacy", "keys & security"],
  },
];

const GUIDE_ITEMS: GuideItem[] = [
  {
    title: "Your first 10 minutes",
    description: "From a new account to your first post: your space, saving your key, finding your people.",
    icon: Rocket,
    type: "article",
    tags: ["getting started"],
    href: "/help/first-10-minutes",
  },
  {
    title: "Setting up your community",
    description: "Name a community, invite your people, and open it to the wider network when you choose.",
    icon: Radio,
    type: "article",
    tags: ["relays & communities"],
    href: "/help/setting-up-outpost",
  },
  {
    title: "Set up zaps",
    description: "Connect your own wallet and send a first tip. Optional, and every bit goes to them.",
    icon: BtcZapIcon,
    type: "article",
    tags: ["zaps & bitcoin"],
    href: "/help/connecting-wallet",
  },
  {
    title: "Using the content calendar",
    description: "Find events, say you're coming, and schedule posts for later.",
    icon: BookOpen,
    type: "article",
    tags: ["social"],
    href: "/help/content-calendar",
  },
  {
    title: "Private messages",
    description: "Why only the people in a chat can read it, and what the app says while it checks for new ones.",
    icon: MessageCircle,
    type: "article",
    tags: ["privacy"],
    href: "/help/encrypted-messages",
  },
  {
    title: "Post with privacy",
    description: "Who sees your posts, what hidden details are stripped before you publish, and blurred pictures.",
    icon: Lock,
    type: "article",
    tags: ["privacy"],
    href: "/help/publishing-privacy",
  },
  {
    title: "Your people",
    description: "Who you follow, who follows you, and how the app tells a friend of a friend from a stranger.",
    icon: Users,
    type: "article",
    tags: ["social"],
    href: "/help/managing-crew",
  },
];

const DEEP_DIVE_ITEMS: DeepDiveItem[] = [
  {
    title: "Why decentralization matters",
    subtitle: "The case for owning your digital identity",
    description: "Centralized platforms own your content, your connections, and your audience. One policy change can erase years of work. Nostr returns ownership to you — permanently.",
    icon: Globe,
    type: "article",
    tags: ["big ideas", "getting started"],
    href: "/help/why-decentralization",
  },
  {
    title: "How Web of Trust replaces algorithms",
    subtitle: "From corporate curation to community trust",
    description: "Social media algorithms chase engagement — outrage, addiction. A Web of Trust ranks by the people you actually know and respect instead. Here's how it works and why it's better.",
    icon: Shield,
    type: "article",
    tags: ["web of trust", "big ideas"],
    href: "/help/wot-vs-algorithms",
  },
  {
    title: "Relay communities vs. platforms",
    subtitle: "Why a community you own beats a group someone else runs",
    description: "Discord servers, subreddits, Facebook groups: all controlled by one company. Here a community is yours, end-to-end encrypted, and if any server disappears your identity and your people move with you.",
    icon: Rocket,
    type: "article",
    tags: ["relays & communities", "big ideas", "social"],
    href: "/help/relay-communities",
  },
  {
    title: "Owning your data & keys",
    subtitle: "You own your identity. Period.",
    description: "Your key is your identity, your login, and your proof of authorship — all in one. No email, no phone number, no recovery form. Here's why that's a feature, not a bug.",
    icon: Key,
    type: "article",
    tags: ["keys & security", "big ideas", "privacy"],
    href: "/help/data-sovereignty",
  },
  {
    title: "Where Nostr is heading",
    subtitle: "The roadmap for the next phase of the internet",
    description: "New kinds of apps, payments, and communities are being built on Nostr every month. Here's where it's heading — and why it matters for you.",
    icon: NostrOstrichIcon,
    type: "article",
    tags: ["big ideas"],
    href: "/help/where-nostr-is-heading",
  },
  {
    title: "Nostr vs. the alternatives",
    subtitle: "How Nostr stacks up against Bluesky, Mastodon, and Farcaster",
    description: "A fair, honest comparison of the decentralized social protocols. Where Nostr excels, where it's still catching up, and why we chose to build here.",
    icon: Layers,
    type: "article",
    tags: ["vs other platforms"],
    href: "/help/nostr-vs-alternatives",
  },
];

// Tab order leads with the concepts a newcomer meets first in the app
// (Outposts, the trust-based feed) before the deeper / advanced topics.
const ALL_TAGS = [
  "getting started", "relays & communities", "web of trust",
  "keys & security", "zaps & bitcoin", "social",
  "privacy", "vs other platforms", "big ideas",
];

// FAQ display order — the arc of a newcomer's first week: what this is, where
// you start (your space), getting in and saving your key, your people, what's
// private, what keeps the bad stuff out, then the rest. Matched by a unique
// substring of each question so it's robust to punctuation. Anything unlisted
// falls to the end.
const FAQ_ORDER_KEYS = [
  "like X",             // Is this like X or Instagram?
  "your space",         // What is "your space"?
  "signing in",         // Why is signing in different here?
  "my key, and",        // What's my key, and how do I save it?
  "lose my key",        // What if I lose my key?
  "other apps",         // Can I use my account on other apps?
  "a community?",       // What's a community?
  "hear my calls",      // Who can read my messages and hear my calls?
  "spam and nasty",     // How do you keep spam and nasty stuff away?
  "a relay?",           // What's a relay?
  "other languages",    // Can I read posts in other languages?
  "are zaps",           // What are zaps?
  "edit an article",    // Can I edit an article after publishing?
  "delete my posts",    // Can I delete my posts or account?
];
function faqOrder(question: string): number {
  const i = FAQ_ORDER_KEYS.findIndex((k) => question.includes(k));
  return i === -1 ? 999 : i;
}

function ContentTypeBadge({ type }: { type: "article" | "video" | "infographic" }) {
  const config = {
    // Light: a neutral chip, the type's colour on its icon only (owner,
    // 2026-10-08: calm, like Activity #399). Dark: unchanged — the chip keeps
    // every class it wore, spelled out with dark:.
    article: { icon: FileText, label: "Article", chip: "", iconColor: "text-foreground/60" },
    video: { icon: Play, label: "Video", chip: "", iconColor: "text-foreground/60" },
    infographic: { icon: ImageIcon, label: "Infographic", chip: "", iconColor: "text-foreground/60" },
  }[type];

  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground ${config.chip}`}>
      <Icon className={`w-3 h-3 ${config.iconColor}`} />
      {config.label}
    </span>
  );
}

function FAQAccordion({ item }: { item: FAQItem }) {
  const [open, setOpen] = useState(false);
  const Icon = item.icon;

  return (
    <div
      className={`rounded-[20px] border transition-colors duration-150 ${
        open
          ? "border-border bg-card"
          : "border-border/60 bg-card hover:border-border"
      }`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer"
      >
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors duration-150 ${
          open ? "dark:bg-foreground/[0.08]" : "dark:bg-foreground/[0.05]"
        }`}>
          <Icon className={`w-4 h-4 transition-colors duration-150 ${
            open ? "text-foreground" : "text-foreground/60"
          }`} />
        </div>
        <span className={`flex-1 text-[15px] font-medium transition-colors duration-150 ${
          open ? "text-foreground" : "text-foreground/80"
        }`}>
          {item.question}
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-foreground/60 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-0">
          <div className="ml-11 text-[15px] text-foreground/75 leading-relaxed">
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
          {/* Light: a bare icon — no square around it (owner, 2026-10-03:
              "we don't need all the square containers around the icons").
              Dark: the tile it had, unchanged. */}
          <div className="w-10 h-10 rounded-full dark:bg-foreground/[0.05] flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-foreground/75" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-[16px] font-semibold text-foreground truncate flex-1">{item.title}</h3>
              {item.comingSoon && (
                <span className="shrink-0 text-[12px] font-medium text-muted-foreground">
                  Soon
                </span>
              )}
            </div>
            <p className="text-[14px] text-muted-foreground leading-snug line-clamp-2">{item.description}</p>
            <div className="flex items-center gap-2 mt-3">
              <ContentTypeBadge type={item.type} />
            </div>
          </div>
        </div>
      </div>
          </>
  );

  const className = "group relative rounded-[20px] border border-border/60 bg-card hover:border-border transition-colors duration-150";

  if (item.href) {
    return <Link href={item.href} className={`block ${className}`}>{content}</Link>;
  }

  return <div className={className}>{content}</div>;
}

function DeepDiveCard({ item }: { item: DeepDiveItem }) {
  const Icon = item.icon;

  const content = (
    <>
            <div className="relative p-5 sm:p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-11 h-11 rounded-full dark:bg-foreground/[0.05] flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-foreground/75" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-[16px] font-semibold text-foreground truncate flex-1">{item.title}</h3>
              {item.comingSoon && (
                <span className="shrink-0 text-[12px] font-medium text-muted-foreground">
                  Soon
                </span>
              )}
            </div>
            <p className="text-[13px] text-muted-foreground">{item.subtitle}</p>
          </div>
        </div>
        <p className="text-[14px] text-foreground/70 leading-relaxed">{item.description}</p>
        <div className="flex items-center gap-2 mt-4">
          <ContentTypeBadge type={item.type} />
        </div>
      </div>
          </>
  );

  const className = "group relative rounded-[20px] border border-border/60 bg-card overflow-hidden hover:border-border transition-colors duration-150";

  if (item.href) {
    return <Link href={item.href} className={`block ${className}`}>{content}</Link>;
  }

  return <div className={className}>{content}</div>;
}

export default function WtfIsThis() {
  useDocumentTitle("Help & guides — Relay Outpost");
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
    <div className="relative z-10 max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-in fade-in duration-150">
      <div className="flex items-center gap-1 mb-1">
        <Link href="/" className="-ml-3 w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground transition-colors duration-150" aria-label="Back">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex items-center gap-2">
          <OttoMark size={44} label="Relay" className="shrink-0 text-foreground !w-9 !h-9 sm:!w-11 sm:!h-11" />
          <div>
            <h1
              className="text-[24px] sm:text-[30px] font-semibold tracking-[-0.025em] leading-[1.1] whitespace-nowrap text-foreground"
            >
              Help &amp; guides
            </h1>
            <p className="text-[14px] sm:text-[15px] text-muted-foreground mt-1">Get started, post &amp; connect</p>
          </div>
        </div>
        {pubkey && (
          <div className="ml-auto">
            <Popover open={replayPickerOpen} onOpenChange={setReplayPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-full border border-foreground/25 hover:bg-foreground/[0.06] h-9 px-3.5 text-[13px] text-foreground whitespace-nowrap transition-colors font-medium"
                  data-testid="button-restart-mission-briefing"
                  title="Replay a tour"
                  aria-label="Replay a tour"
                >
                  <PlayCircle className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Replay a tour</span>
                  <span className="sm:hidden">Tours</span>
                  <ChevronDown className="w-3 h-3 opacity-60" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-1.5">
                <p className="px-2.5 py-1.5 text-[13px] text-muted-foreground font-medium">
                  Pick a tour
                </p>
                {replayablePages.map((p) => (
                  <button
                    key={p.pageId}
                    type="button"
                    onClick={() => handleRestartTour(p.pageId, p.path)}
                    aria-label={`Replay the ${p.label} tour`}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors cursor-pointer"
                    data-testid={`button-replay-briefing-${p.pageId}`}
                  >
                    <PlayCircle className="w-3.5 h-3.5 text-foreground/60 shrink-0" />
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
              className={`inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors duration-150 ${
                activeCategory === cat.value
                  ? "bg-foreground text-background border border-foreground"
                  : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] border border-transparent"
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
            <Button variant="outline" size="sm" className="w-full h-10 rounded-full px-4 justify-between border-input bg-card text-[14px] font-medium">
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
                    isActive ? "bg-foreground/[0.07] text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                                    <Icon className="w-3.5 h-3.5" />
                  {cat.label}
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
      </div>

      {!searchQuery.trim() && (
        // 36px chips, 8px apart: each one's 44px target (.hit-area) meets the
        // next row's without overlapping it (tap-targets-e2e.cjs).
        <div className="flex flex-wrap gap-2 mb-5">
          {ALL_TAGS.map((tag) => (
            <button
              key={tag}
              data-testid="help-tag-chip"
              onClick={() => { setExpandedTag(expandedTag === tag ? null : tag); setActiveCategory("all"); }}
              className={`hit-area min-h-[36px] px-3.5 rounded-full text-[13px] font-medium first-letter:uppercase transition-colors duration-150 ${
                expandedTag === tag
                  ? "bg-foreground text-background border border-foreground"
                  : "bg-card text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] border border-border/60"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {!hasResults && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <OttoEmpty mood="looking" size={72} className="mb-3 text-foreground/70" />
          <p className="text-[15px] font-medium text-foreground">No results found</p>
          <p className="text-[13px] text-muted-foreground mt-1">Try a different word or category</p>
        </div>
      )}

      {filteredFAQs.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3.5">
            <HelpCircle className="w-4 h-4 text-foreground/60" />
            <h2 className="text-[15px] font-semibold text-foreground">Questions</h2>
            <div className="flex-1 h-px bg-border/60" />
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
            <BookOpen className="w-4 h-4 text-foreground/60" />
            <h2 className="text-[15px] font-semibold text-foreground">Start here</h2>
            <div className="flex-1 h-px bg-border/60" />
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
            <Lightbulb className="w-4 h-4 text-foreground/60" />
            <h2 className="text-[15px] font-semibold text-foreground">Go deeper</h2>
            <div className="flex-1 h-px bg-border/60" />
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
          <Star className="w-4 h-4 text-foreground/60" />
          <h2 className="text-[15px] font-semibold text-foreground">Resources</h2>
          <div className="flex-1 h-px bg-border/60" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <a
            href="https://nostr.com"
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-[20px] border border-border/60 bg-card hover:border-border p-4 transition-colors duration-150"
          >
            <div className="flex items-center gap-2 mb-2">
              <Globe className="w-4 h-4 text-foreground/70" />
              <span className="text-[15px] font-semibold text-foreground">nostr.com</span>
              <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-foreground transition-colors duration-150 ml-auto" />
            </div>
            <p className="text-[13px] text-muted-foreground leading-snug">Explore the open network and other apps you can use</p>
          </a>
          <a
            href="https://brainstorm.nosfabrica.com/what-is-wot"
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-[20px] border border-border/60 bg-card hover:border-border p-4 transition-colors duration-150"
          >
            <div className="flex items-center gap-2 mb-2">
              <ShieldMatrixIcon className="w-4 h-4 text-foreground/70" />
              <span className="text-[15px] font-semibold text-foreground">Web of Trust</span>
              <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-foreground transition-colors duration-150 ml-auto" />
            </div>
            <p className="text-[13px] text-muted-foreground leading-snug">Learn how trust scoring keeps your feed clean</p>
          </a>
          <a
            href="https://nostrcg.github.io/userguide/"
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-[20px] border border-border/60 bg-card hover:border-border p-4 transition-colors duration-150"
          >
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-4 h-4 text-foreground/70" />
              <span className="text-[15px] font-semibold text-foreground">Nostr guide</span>
              <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-foreground transition-colors duration-150 ml-auto" />
            </div>
            <p className="text-[13px] text-muted-foreground leading-snug">A friendly, in-depth beginner's guide</p>
          </a>
        </div>
      </section>

      <div className="border-t border-border/60 mt-3 pt-4 pb-2 text-center">
        <p className="text-[13px] text-muted-foreground font-medium">
          Relay Outpost — the next phase of the internet
        </p>
      </div>

      <WtfWelcomeOverlay open={welcomeOpen} onDismiss={dismissWelcome} />
    </div>
    </div>
  );
}
