import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { Event, Filter } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { useLocation } from "wouter";
import { useVirtualizer } from "@tanstack/react-virtual";
import { use$ } from "applesauce-react/hooks";
import { parseConsoleQueryParams } from "@/lib/console-query-params";
import { pool, DEFAULT_RELAYS, throttledPoolSubscribe, eventStore, getCachedProfile } from "@/lib/nostr";
import { KIND_METADATA, getProfileContent, formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { AuthorPicker } from "@/components/AuthorPicker";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { formatDistanceToNow, format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Terminal,
  Play,
  Pause,
  Square,
  Trash2,
  Download,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ArrowDown,
  X,
  Search,
  Clock,
  History,
  Code,
  Eye,
  Radio,
  Plus,
  FileSpreadsheet,
  Braces,
  Globe,
  Users,
  GitBranch,
  ExternalLink,
  Heart,
  MessageCircle,
  Zap,
} from "lucide-react";
import { fetchArchivesEvent, fetchArchivesSocialGraph, type ArchivesEvent, type ArchivesSocialGraph } from "@/lib/nostr-archives";
import { onNostrIdCopied, copyNostrId, getLastCopiedNostrId } from "@/lib/clipboard-bridge";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

const EVENT_KINDS: { kind: number; label: string; nip?: string }[] = [
  { kind: 0, label: "User Metadata", nip: "NIP-01" },
  { kind: 1, label: "Short Text Note", nip: "NIP-10" },
  { kind: 2, label: "Recommend Relay (deprecated)", nip: "NIP-01" },
  { kind: 3, label: "Follows", nip: "NIP-02" },
  { kind: 4, label: "Encrypted Direct Messages", nip: "NIP-04" },
  { kind: 5, label: "Event Deletion Request", nip: "NIP-09" },
  { kind: 6, label: "Repost", nip: "NIP-18" },
  { kind: 7, label: "Reaction", nip: "NIP-25" },
  { kind: 8, label: "Badge Award", nip: "NIP-58" },
  { kind: 9, label: "Chat Message", nip: "NIP-C7" },
  { kind: 10, label: "Group Chat Threaded Reply (deprecated)", nip: "NIP-29" },
  { kind: 11, label: "Thread", nip: "NIP-7D" },
  { kind: 12, label: "Group Thread Reply (deprecated)", nip: "NIP-29" },
  { kind: 13, label: "Seal", nip: "NIP-59" },
  { kind: 14, label: "Direct Message", nip: "NIP-17" },
  { kind: 15, label: "File Message", nip: "NIP-17" },
  { kind: 16, label: "Generic Repost", nip: "NIP-18" },
  { kind: 17, label: "Reaction to a Website", nip: "NIP-25" },
  { kind: 20, label: "Picture", nip: "NIP-68" },
  { kind: 21, label: "Video Event", nip: "NIP-71" },
  { kind: 22, label: "Short-form Portrait Video", nip: "NIP-71" },
  { kind: 24, label: "Public Message", nip: "NIP-A4" },
  { kind: 40, label: "Channel Creation", nip: "NIP-28" },
  { kind: 41, label: "Channel Metadata", nip: "NIP-28" },
  { kind: 42, label: "Channel Message", nip: "NIP-28" },
  { kind: 43, label: "Channel Hide Message", nip: "NIP-28" },
  { kind: 44, label: "Channel Mute User", nip: "NIP-28" },
  { kind: 62, label: "Request to Vanish", nip: "NIP-62" },
  { kind: 64, label: "Chess (PGN)", nip: "NIP-64" },
  { kind: 818, label: "Merge Requests", nip: "NIP-54" },
  { kind: 1018, label: "Poll Response", nip: "NIP-88" },
  { kind: 1021, label: "Bid", nip: "NIP-15" },
  { kind: 1022, label: "Bid Confirmation", nip: "NIP-15" },
  { kind: 1040, label: "OpenTimestamps", nip: "NIP-03" },
  { kind: 1059, label: "Gift Wrap", nip: "NIP-59" },
  { kind: 1063, label: "File Metadata", nip: "NIP-94" },
  { kind: 1068, label: "Poll", nip: "NIP-88" },
  { kind: 1111, label: "Comment", nip: "NIP-22" },
  { kind: 1222, label: "Voice Message", nip: "NIP-A0" },
  { kind: 1311, label: "Live Chat Message", nip: "NIP-53" },
  { kind: 1337, label: "Code Snippet", nip: "NIP-C0" },
  { kind: 1617, label: "Patches", nip: "NIP-34" },
  { kind: 1618, label: "Pull Requests", nip: "NIP-34" },
  { kind: 1619, label: "Pull Request Updates", nip: "NIP-34" },
  { kind: 1621, label: "Issues", nip: "NIP-34" },
  { kind: 1984, label: "Reporting", nip: "NIP-56" },
  { kind: 1985, label: "Label", nip: "NIP-32" },
  { kind: 2003, label: "Torrent", nip: "NIP-35" },
  { kind: 2004, label: "Torrent Comment", nip: "NIP-35" },
  { kind: 4550, label: "Community Post Approval", nip: "NIP-72" },
  { kind: 5000, label: "Job Request (range 5000-5999)", nip: "NIP-90" },
  { kind: 6000, label: "Job Result (range 6000-6999)", nip: "NIP-90" },
  { kind: 7000, label: "Job Feedback", nip: "NIP-90" },
  { kind: 7375, label: "Cashu Wallet Tokens", nip: "NIP-60" },
  { kind: 7376, label: "Cashu Wallet History", nip: "NIP-60" },
  { kind: 9041, label: "Zap Goal", nip: "NIP-75" },
  { kind: 9321, label: "Nutzap", nip: "NIP-61" },
  { kind: 9734, label: "Zap Request", nip: "NIP-57" },
  { kind: 9735, label: "Zap", nip: "NIP-57" },
  { kind: 9802, label: "Highlights", nip: "NIP-84" },
  { kind: 10000, label: "Mute List", nip: "NIP-51" },
  { kind: 10001, label: "Pin List", nip: "NIP-51" },
  { kind: 10002, label: "Relay List Metadata", nip: "NIP-65" },
  { kind: 10003, label: "Bookmark List", nip: "NIP-51" },
  { kind: 10004, label: "Communities List", nip: "NIP-51" },
  { kind: 10005, label: "Public Chats List", nip: "NIP-51" },
  { kind: 10006, label: "Blocked Relays List", nip: "NIP-51" },
  { kind: 10007, label: "Search Relays List", nip: "NIP-51" },
  { kind: 10009, label: "User Groups", nip: "NIP-51" },
  { kind: 10015, label: "Interests List", nip: "NIP-51" },
  { kind: 10019, label: "Nutzap Mint Recommendation", nip: "NIP-61" },
  { kind: 10030, label: "User Emoji List", nip: "NIP-51" },
  { kind: 10050, label: "Relay List to Receive DMs", nip: "NIP-17" },
  { kind: 10063, label: "User Server List (Blossom)" },
  { kind: 10096, label: "File Storage Server List (deprecated)", nip: "NIP-96" },
  { kind: 10166, label: "Relay Monitor Announcement", nip: "NIP-66" },
  { kind: 13194, label: "Wallet Info", nip: "NIP-47" },
  { kind: 22242, label: "Client Authentication", nip: "NIP-42" },
  { kind: 23194, label: "Wallet Request", nip: "NIP-47" },
  { kind: 23195, label: "Wallet Response", nip: "NIP-47" },
  { kind: 24133, label: "Nostr Connect", nip: "NIP-46" },
  { kind: 27235, label: "HTTP Auth", nip: "NIP-98" },
  { kind: 30000, label: "Follow Sets", nip: "NIP-51" },
  { kind: 30001, label: "Bookmark Sets", nip: "NIP-51" },
  { kind: 30002, label: "Relay Sets", nip: "NIP-51" },
  { kind: 30003, label: "Bookmark Sets (alt)", nip: "NIP-51" },
  { kind: 30004, label: "Curation Sets", nip: "NIP-51" },
  { kind: 30008, label: "Profile Badges", nip: "NIP-58" },
  { kind: 30009, label: "Badge Definition", nip: "NIP-58" },
  { kind: 30017, label: "Stall", nip: "NIP-15" },
  { kind: 30018, label: "Product", nip: "NIP-15" },
  { kind: 30023, label: "Long-form Content", nip: "NIP-23" },
  { kind: 30024, label: "Draft Long-form Content", nip: "NIP-23" },
  { kind: 30030, label: "Emoji Sets", nip: "NIP-30" },
  { kind: 30063, label: "Release Artifact Sets", nip: "NIP-51" },
  { kind: 30078, label: "App-specific Data", nip: "NIP-78" },
  { kind: 30311, label: "Live Event", nip: "NIP-53" },
  { kind: 30315, label: "User Status", nip: "NIP-38" },
  { kind: 30382, label: "Classified Listing", nip: "NIP-99" },
  { kind: 30402, label: "Draft Classified Listing", nip: "NIP-99" },
  { kind: 30617, label: "Repository Announcement", nip: "NIP-34" },
  { kind: 30618, label: "Repository State", nip: "NIP-34" },
  { kind: 30818, label: "Wiki Article", nip: "NIP-54" },
  { kind: 30819, label: "Redirects", nip: "NIP-54" },
  { kind: 31337, label: "Zapstr Track" },
  { kind: 31922, label: "Date-based Calendar Event", nip: "NIP-52" },
  { kind: 31923, label: "Time-based Calendar Event", nip: "NIP-52" },
  { kind: 31924, label: "Calendar", nip: "NIP-52" },
  { kind: 31925, label: "Calendar Event RSVP", nip: "NIP-52" },
  { kind: 31989, label: "Handler Recommendation", nip: "NIP-89" },
  { kind: 31990, label: "Handler Information", nip: "NIP-89" },
  { kind: 32123, label: "Wavlake NOM" },
  { kind: 34235, label: "Video Event", nip: "NIP-71" },
  { kind: 34236, label: "Short-form Portrait Video", nip: "NIP-71" },
  { kind: 34237, label: "Video View", nip: "NIP-71" },
  { kind: 34550, label: "Community Definition", nip: "NIP-72" },
];

const KIND_MAP = new Map(EVENT_KINDS.map((k) => [k.kind, k.label]));
let mergedKindsCache: { kind: number; label: string; nip?: string }[] | null = null;

function getKindLabel(kind: number): string {
  if (mergedKindsCache) {
    const entry = mergedKindsCache.find((k) => k.kind === kind);
    if (entry) return entry.label;
  }
  return KIND_MAP.get(kind) || `Kind ${kind}`;
}

function escapeCsvField(value: string): string {
  let safe = value;
  const trimmed = safe.trimStart();
  if (trimmed.length > 0 && "=+-@\t".includes(trimmed[0])) {
    safe = "'" + safe;
  }
  if (safe.includes(",") || safe.includes('"') || safe.includes("\n") || safe.includes("\r")) {
    return '"' + safe.replace(/"/g, '""') + '"';
  }
  return safe;
}

function eventsToCsv(events: Event[]): string {
  const headers = ["Event ID", "Pubkey (npub)", "Kind", "Kind Label", "Timestamp (ISO)", "Content", "Tags"];
  const rows = events.map((e) => {
    let npub: string;
    try {
      npub = nip19.npubEncode(e.pubkey);
    } catch {
      npub = e.pubkey;
    }
    let iso: string;
    try {
      iso = new Date(e.created_at * 1000).toISOString();
    } catch {
      iso = String(e.created_at);
    }
    return [
      e.id,
      npub,
      String(e.kind),
      escapeCsvField(getKindLabel(e.kind)),
      iso,
      escapeCsvField(e.content),
      escapeCsvField(JSON.stringify(e.tags)),
    ].join(",");
  });
  return [headers.join(","), ...rows].join("\n");
}

interface HistoryEntry {
  filter: Record<string, unknown>;
  relays: string[];
  timestamp: number;
  resultCount: number;
}

function loadRecentRelays(): string[] {
  try {
    const stored = localStorage.getItem("event-console-recent-relays");
    const parsed: string[] = stored ? JSON.parse(stored) : [];
    return parsed.filter((r) => typeof r === "string" && r.startsWith("wss://"));
  } catch {
    return [];
  }
}

function saveRecentRelays(relays: string[]) {
  try {
    localStorage.setItem("event-console-recent-relays", JSON.stringify(relays.slice(0, 20)));
  } catch {}
}

function loadHistory(): HistoryEntry[] {
  try {
    const stored = localStorage.getItem("event-console-history");
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: HistoryEntry[]) {
  try {
    localStorage.setItem("event-console-history", JSON.stringify(history.slice(0, 20)));
  } catch {}
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const handleCopy = async () => {
    try {
      const isNostrId = /^(npub1|note1|nevent1|nprofile1|[0-9a-f]{64}$)/i.test(value);
      if (isNostrId) {
        await copyNostrId(value);
      } else {
        await navigator.clipboard.writeText(value);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleCopy}
      data-testid={`button-copy-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
    </Button>
  );
}

function RelaySelectorContent({
  selectedRelays,
  onSelectedRelaysChange,
  customInput,
  setCustomInput,
  allRelays,
  addCustomRelay,
}: {
  selectedRelays: string[];
  onSelectedRelaysChange: (relays: string[]) => void;
  customInput: string;
  setCustomInput: (v: string) => void;
  allRelays: string[];
  addCustomRelay: () => void;
}) {
  const toggleRelay = (relay: string) => {
    if (selectedRelays.includes(relay)) {
      onSelectedRelaysChange(selectedRelays.filter((r) => r !== relay));
    } else {
      onSelectedRelaysChange([...selectedRelays, relay]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          placeholder="wss://custom-relay..."
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addCustomRelay();
          }}
          className="font-mono text-xs min-w-0"
          style={{ fontSize: "16px" }}
          data-testid="input-custom-relay"
        />
        <Button
          size="sm"
          onClick={addCustomRelay}
          disabled={!customInput.trim() || !customInput.trim().startsWith("wss://")}
          data-testid="button-add-custom-relay"
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="max-h-[40vh] sm:max-h-[200px] overflow-y-auto space-y-1">
        {allRelays.map((relay) => {
          const isSelected = selectedRelays.includes(relay);
          return (
            <button
              key={relay}
              onClick={() => toggleRelay(relay)}
              className={`w-full flex items-center gap-2 px-2 py-2.5 sm:py-1.5 rounded-md text-sm sm:text-xs font-mono text-left transition-colors ${
                isSelected ? "bg-accent text-foreground" : "text-muted-foreground hover-elevate"
              }`}
              data-testid={`button-relay-${relay.replace(/[^a-z0-9]/gi, "-")}`}
            >
              <div className={`w-2.5 h-2.5 sm:w-2 sm:h-2 rounded-full shrink-0 ${isSelected ? "bg-green-500" : "bg-muted-foreground/30"}`} />
              <span className="truncate flex-1">{relay}</span>
              {isSelected && <Check className="w-4 h-4 sm:w-3 sm:h-3 text-brand shrink-0" />}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2 pt-1 border-t border-border/40">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSelectedRelaysChange([...DEFAULT_RELAYS])}
          data-testid="button-select-all-relays"
        >
          Select All Default
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSelectedRelaysChange([])}
          data-testid="button-clear-relays"
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

function RelaySelector({
  selectedRelays,
  onSelectedRelaysChange,
}: {
  selectedRelays: string[];
  onSelectedRelaysChange: (relays: string[]) => void;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [recentRelays, setRecentRelays] = useState<string[]>(loadRecentRelays);

  const allRelays = useMemo(() => {
    const set = new Set([...DEFAULT_RELAYS, ...recentRelays]);
    return Array.from(set);
  }, [recentRelays]);

  const addCustomRelay = () => {
    const trimmed = customInput.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("wss://")) return;
    if (!selectedRelays.includes(trimmed)) {
      onSelectedRelaysChange([...selectedRelays, trimmed]);
    }
    if (!recentRelays.includes(trimmed) && !DEFAULT_RELAYS.includes(trimmed)) {
      const updated = [trimmed, ...recentRelays].slice(0, 20);
      setRecentRelays(updated);
      saveRecentRelays(updated);
    }
    setCustomInput("");
  };

  const triggerButton = (
    <Button
      variant="outline"
      className="w-full justify-between font-mono text-xs"
      data-testid="button-relay-selector"
    >
      <span className="truncate">
        {selectedRelays.length === 0
          ? "Select relays..."
          : selectedRelays.length === 1
            ? selectedRelays[0]
            : `${selectedRelays.length} relays selected`}
      </span>
      <ChevronDown className="w-3.5 h-3.5 shrink-0 ml-2" />
    </Button>
  );

  const contentProps = {
    selectedRelays,
    onSelectedRelaysChange,
    customInput,
    setCustomInput,
    allRelays,
    addCustomRelay,
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Label className="text-xs font-brand uppercase tracking-widest text-muted-foreground">Relays</Label>
        <Badge variant="secondary" data-testid="badge-relay-count">{selectedRelays.length} selected</Badge>
      </div>
      {isMobile ? (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger asChild>{triggerButton}</DrawerTrigger>
          <DrawerContent>
            <DrawerHeader className="pb-2">
              <DrawerTitle className="text-sm font-brand uppercase tracking-widest">Select Relays</DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-6">
              <RelaySelectorContent {...contentProps} />
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
          <PopoverContent className="w-[380px] max-w-[380px] p-3" align="start">
            <RelaySelectorContent {...contentProps} />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function KindPickerContent({
  selectedKinds,
  searchQuery,
  setSearchQuery,
  customKindInput,
  setCustomKindInput,
  filtered,
  toggleKind,
  addCustomKind,
}: {
  selectedKinds: number[];
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  customKindInput: string;
  setCustomKindInput: (v: string) => void;
  filtered: { kind: number; label: string; nip?: string }[];
  toggleKind: (kind: number) => void;
  addCustomKind: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          placeholder="Search by name or number..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8 text-xs"
          style={{ fontSize: "16px" }}
          data-testid="input-kind-search"
        />
      </div>
      <div className="max-h-[40vh] sm:max-h-[200px] overflow-y-auto space-y-0.5">
        {filtered.map((k) => {
          const isSelected = selectedKinds.includes(k.kind);
          return (
            <button
              key={k.kind}
              onClick={() => toggleKind(k.kind)}
              className={`w-full flex items-center gap-2 px-2 py-2.5 sm:py-1.5 rounded-md text-sm sm:text-xs text-left transition-colors ${
                isSelected ? "bg-accent text-foreground" : "text-muted-foreground hover-elevate"
              }`}
              data-testid={`button-kind-${k.kind}`}
            >
              <span className="font-mono w-14 sm:w-12 shrink-0 text-brand/80">{k.kind}</span>
              <span className="flex-1 truncate">{k.label}</span>
              {k.nip && <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0">{k.nip}</span>}
              {isSelected && <Check className="w-4 h-4 sm:w-3 sm:h-3 text-brand shrink-0" />}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground py-3 text-center">No matching kinds found</p>
        )}
      </div>
      <div className="flex gap-2 pt-1 border-t border-border/40">
        <Input
          placeholder="Custom kind #"
          type="number"
          min={0}
          value={customKindInput}
          onChange={(e) => setCustomKindInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addCustomKind();
          }}
          className="text-xs font-mono"
          style={{ fontSize: "16px" }}
          data-testid="input-custom-kind"
        />
        <Button
          size="sm"
          onClick={addCustomKind}
          disabled={!customKindInput.trim() || isNaN(parseInt(customKindInput, 10))}
          data-testid="button-add-custom-kind"
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function mergeKinds(
  base: { kind: number; label: string; nip?: string }[],
  remote: { kind: number; label: string; nip: string }[]
): { kind: number; label: string; nip?: string }[] {
  const map = new Map<number, { kind: number; label: string; nip?: string }>();
  for (const k of base) map.set(k.kind, k);
  for (const k of remote) {
    if (!map.has(k.kind)) {
      map.set(k.kind, { kind: k.kind, label: k.label, nip: k.nip });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.kind - b.kind);
}

function KindPicker({
  selectedKinds,
  onSelectedKindsChange,
}: {
  selectedKinds: number[];
  onSelectedKindsChange: (kinds: number[]) => void;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [customKindInput, setCustomKindInput] = useState("");
  const [allKinds, setAllKinds] = useState(mergedKindsCache || EVENT_KINDS);

  useEffect(() => {
    if (mergedKindsCache) {
      setAllKinds(mergedKindsCache);
      return;
    }
    fetch("/api/nip-kinds")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((remote: { kind: number; label: string; nip: string }[]) => {
        const merged = mergeKinds(EVENT_KINDS, remote);
        mergedKindsCache = merged;
        setAllKinds(merged);
      })
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return allKinds;
    const q = searchQuery.toLowerCase();
    return allKinds.filter(
      (k) => k.label.toLowerCase().includes(q) || String(k.kind).includes(q) || (k.nip && k.nip.toLowerCase().includes(q))
    );
  }, [searchQuery, allKinds]);

  const toggleKind = (kind: number) => {
    if (selectedKinds.includes(kind)) {
      onSelectedKindsChange(selectedKinds.filter((k) => k !== kind));
    } else {
      onSelectedKindsChange([...selectedKinds, kind]);
    }
  };

  const addCustomKind = () => {
    const num = parseInt(customKindInput, 10);
    if (isNaN(num) || num < 0) return;
    if (!selectedKinds.includes(num)) {
      onSelectedKindsChange([...selectedKinds, num]);
    }
    setCustomKindInput("");
  };

  const triggerButton = (
    <Button
      variant="outline"
      className="w-full justify-between text-xs"
      data-testid="button-kind-selector"
    >
      <span className="truncate">
        {selectedKinds.length === 0
          ? "Select event kinds..."
          : `${selectedKinds.length} kind${selectedKinds.length !== 1 ? "s" : ""} selected`}
      </span>
      <ChevronDown className="w-3.5 h-3.5 shrink-0 ml-2" />
    </Button>
  );

  const contentProps = {
    selectedKinds,
    searchQuery,
    setSearchQuery,
    customKindInput,
    setCustomKindInput,
    filtered,
    toggleKind,
    addCustomKind,
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs font-brand uppercase tracking-widest text-muted-foreground">Event Kinds</Label>
      {isMobile ? (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger asChild>{triggerButton}</DrawerTrigger>
          <DrawerContent>
            <DrawerHeader className="pb-2">
              <DrawerTitle className="text-sm font-brand uppercase tracking-widest">Select Event Kinds</DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-6">
              <KindPickerContent {...contentProps} />
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
          <PopoverContent className="w-[360px] max-w-[360px] p-3" align="start">
            <KindPickerContent {...contentProps} />
          </PopoverContent>
        </Popover>
      )}
      {selectedKinds.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedKinds.map((k) => (
            <Badge
              key={k}
              variant="secondary"
              className="text-xs font-mono gap-1 cursor-pointer"
              onClick={() => toggleKind(k)}
              data-testid={`badge-kind-${k}`}
            >
              {k}: {getKindLabel(k)}
              <X className="w-3 h-3" />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

const TIME_SHORTCUTS = [
  { label: "now", offset: 0 },
  { label: "1h ago", offset: 3600 },
  { label: "6h ago", offset: 21600 },
  { label: "24h ago", offset: 86400 },
  { label: "7d ago", offset: 604800 },
  { label: "30d ago", offset: 2592000 },
];

function EventRow({
  event,
  expanded,
  onToggle,
  onLookupEvent,
  onLookupPubkey,
}: {
  event: Event;
  expanded: boolean;
  onToggle: () => void;
  onLookupEvent?: (id: string) => void;
  onLookupPubkey?: (pubkey: string) => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const { toast } = useToast();

  const metadataEvent = use$(() => eventStore.replaceable(KIND_METADATA, event.pubkey), [event.pubkey]);
  const authorProfile = useMemo(() => {
    if (!metadataEvent) return null;
    return getProfileContent(metadataEvent);
  }, [metadataEvent]);
  const authorName = authorProfile?.display_name || authorProfile?.name || shortenNpub(formatNpub(event.pubkey));
  const authorPic = authorProfile?.picture;

  const kindLabel = getKindLabel(event.kind);
  const timeAgo = useMemo(() => {
    try {
      return formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true });
    } catch {
      return "";
    }
  }, [event.created_at]);

  const humanTime = useMemo(() => {
    try {
      return format(new Date(event.created_at * 1000), "yyyy-MM-dd HH:mm:ss");
    } catch {
      return "";
    }
  }, [event.created_at]);

  const npub = useMemo(() => {
    try {
      return nip19.npubEncode(event.pubkey);
    } catch {
      return event.pubkey;
    }
  }, [event.pubkey]);

  const contentPreview = event.content.slice(0, 100) + (event.content.length > 100 ? "..." : "");
  const fullJson = useMemo(() => JSON.stringify(event, null, 2), [event]);

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(fullJson);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <div
      className="border-b border-border/30 last:border-b-0"
      data-testid={`event-row-${event.id.slice(0, 8)}`}
    >
      <button
        onClick={onToggle}
        className="w-full text-left px-2.5 sm:px-3 py-2.5 hover-elevate transition-colors flex items-start gap-2 sm:gap-3"
        data-testid={`button-expand-event-${event.id.slice(0, 8)}`}
      >
        <Avatar className="w-5 h-5 shrink-0 mt-0.5 ring-1 ring-border/30" data-testid={`avatar-event-author-${event.id.slice(0, 8)}`}>
          <AvatarImage src={authorPic} alt={authorName} />
          <AvatarFallback className="text-[8px] bg-brand/10 text-brand font-bold">
            {authorName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 space-y-1 overflow-hidden">
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <span className="text-[11px] sm:text-xs font-medium text-foreground/80 truncate max-w-[80px] sm:max-w-[120px]" data-testid={`text-event-author-${event.id.slice(0, 8)}`}>{authorName}</span>
            <span className="font-mono text-xs text-brand/80">{event.id.slice(0, 8)}</span>
            <Badge variant="secondary" className="text-[11px] font-mono">
              {event.kind} {kindLabel}
            </Badge>
            <span className="text-[11px] text-muted-foreground/80">{timeAgo}</span>
          </div>
          {contentPreview && (
            <p className="text-xs text-muted-foreground truncate">{contentPreview}</p>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-1" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-1" />
        )}
      </button>

      {expanded && (
        <div className="px-2.5 sm:px-3 pb-3 space-y-3 overflow-hidden" data-testid={`event-details-${event.id.slice(0, 8)}`}>
          <div className="space-y-2 bg-background/30 rounded-md p-2.5 sm:p-3 border border-border/20 overflow-hidden">
            <div className="space-y-0.5 overflow-hidden">
              <span className="text-[11px] font-brand uppercase tracking-widest text-muted-foreground/80">Event ID</span>
              <div className="flex items-start gap-1">
                <span className="font-mono text-[11px] sm:text-xs text-foreground/80 break-all flex-1 min-w-0" data-testid={`text-event-id-${event.id.slice(0, 8)}`}>{event.id}</span>
                <CopyButton value={event.id} label="event-id" />
                {onLookupEvent && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onLookupEvent(event.id)}
                    title="Look up in Archives"
                    data-testid={`button-lookup-event-${event.id.slice(0, 8)}`}
                  >
                    <Search className="w-3.5 h-3.5 text-brand" />
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-0.5 overflow-hidden">
              <span className="text-[11px] font-brand uppercase tracking-widest text-muted-foreground/80">Author Pubkey</span>
              <div className="flex items-start gap-1">
                <span className="font-mono text-[11px] sm:text-xs text-foreground/80 break-all flex-1 min-w-0" data-testid={`text-author-pubkey-${event.id.slice(0, 8)}`}>{event.pubkey}</span>
                <CopyButton value={event.pubkey} label="author-pubkey" />
                {onLookupPubkey && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onLookupPubkey(event.pubkey)}
                    title="Look up Social Graph"
                    data-testid={`button-lookup-pubkey-${event.id.slice(0, 8)}`}
                  >
                    <Search className="w-3.5 h-3.5 text-brand" />
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-0.5 overflow-hidden">
              <span className="text-[11px] font-brand uppercase tracking-widest text-muted-foreground/80">Author npub</span>
              <div className="flex items-start gap-1">
                <span className="font-mono text-[11px] sm:text-xs text-foreground/80 break-all flex-1 min-w-0" data-testid={`text-author-npub-${event.id.slice(0, 8)}`}>{npub}</span>
                <CopyButton value={npub} label="author-npub" />
                {onLookupPubkey && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onLookupPubkey(npub)}
                    title="Look up Social Graph"
                    data-testid={`button-lookup-npub-${event.id.slice(0, 8)}`}
                  >
                    <Search className="w-3.5 h-3.5 text-brand" />
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-0.5">
              <span className="text-[11px] font-brand uppercase tracking-widest text-muted-foreground/80">Kind</span>
              <span className="text-xs text-foreground/80 block" data-testid={`text-event-kind-${event.id.slice(0, 8)}`}>{event.kind} - {kindLabel}</span>
            </div>
            <div className="space-y-0.5">
              <span className="text-[11px] font-brand uppercase tracking-widest text-muted-foreground/80">Created At</span>
              <span className="text-[11px] sm:text-xs text-foreground/80 block font-mono break-all" data-testid={`text-event-time-${event.id.slice(0, 8)}`}>{event.created_at} ({humanTime})</span>
            </div>
            {event.content && (
              <div className="space-y-0.5 overflow-hidden">
                <span className="text-[11px] font-brand uppercase tracking-widest text-muted-foreground/80">Content</span>
                <pre className="text-[11px] sm:text-xs text-foreground/80 whitespace-pre-wrap break-all font-mono bg-background/40 rounded p-2 border border-border/20 max-h-[150px] sm:max-h-[200px] overflow-y-auto overflow-x-hidden" data-testid={`text-event-content-${event.id.slice(0, 8)}`}>
                  {event.content}
                </pre>
              </div>
            )}
            {event.tags.length > 0 && (
              <div className="space-y-0.5 overflow-hidden">
                <span className="text-[11px] font-brand uppercase tracking-widest text-muted-foreground/80">Tags</span>
                <pre className="text-[11px] sm:text-xs text-foreground/80 whitespace-pre-wrap break-all font-mono bg-background/40 rounded p-2 border border-border/20 max-h-[120px] sm:max-h-[160px] overflow-y-auto overflow-x-hidden" data-testid={`text-event-tags-${event.id.slice(0, 8)}`}>
                  {JSON.stringify(event.tags, null, 2)}
                </pre>
              </div>
            )}
            <div className="space-y-0.5 overflow-hidden">
              <span className="text-[11px] font-brand uppercase tracking-widest text-muted-foreground/80">Signature</span>
              <div className="flex items-start gap-1">
                <span className="font-mono text-[11px] sm:text-[11px] text-foreground/80 break-all flex-1 min-w-0" data-testid={`text-event-sig-${event.id.slice(0, 8)}`}>{event.sig}</span>
                <CopyButton value={event.sig} label="signature" />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRaw(!showRaw)}
              className="text-xs"
              data-testid={`button-toggle-raw-${event.id.slice(0, 8)}`}
            >
              {showRaw ? <Eye className="w-3.5 h-3.5 mr-1.5" /> : <Code className="w-3.5 h-3.5 mr-1.5" />}
              {showRaw ? "Parsed" : "Raw JSON"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyJson}
              className="text-xs"
              data-testid={`button-copy-json-${event.id.slice(0, 8)}`}
            >
              <Copy className="w-3.5 h-3.5 mr-1.5" />
              Copy JSON
            </Button>
          </div>

          {showRaw && (
            <pre
              className="text-[11px] sm:text-[11px] font-mono text-foreground/70 bg-background/40 rounded-md p-2.5 sm:p-3 border border-border/20 max-h-[200px] sm:max-h-[300px] overflow-auto whitespace-pre-wrap break-all"
              data-testid={`raw-json-${event.id.slice(0, 8)}`}
            >
              {fullJson}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ArchivesLookup({
  externalEventId,
  externalPubkey,
}: {
  externalEventId?: string;
  externalPubkey?: string;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastType, setLastType] = useState<"event" | "pubkey" | null>(null);
  const [lookupResult, setLookupResult] = useState<ArchivesEvent | null>(null);
  const [socialGraph, setSocialGraph] = useState<ArchivesSocialGraph | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [followerProfiles, setFollowerProfiles] = useState<Map<string, { name: string; picture?: string }>>(new Map());
  const [authorProfile, setAuthorProfile] = useState<{ name: string; picture?: string; nip05?: string } | null>(null);
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!lookupResult?.pubkey) {
      setAuthorProfile(null);
      return;
    }
    const pk = lookupResult.pubkey;
    const cached = getCachedProfile(pk);
    if (cached) {
      try {
        const c = cached.kind === 0 ? JSON.parse(cached.content) : cached;
        setAuthorProfile({ name: c.display_name || c.name || "", picture: c.picture, nip05: c.nip05 });
        return;
      } catch {}
    }
    let done = false;
    const sub = throttledPoolSubscribe(
      DEFAULT_RELAYS.slice(0, 3),
      { kinds: [0], authors: [pk] } as any,
      {
        onevent(ev: Event) {
          try {
            const content = JSON.parse(ev.content);
            setAuthorProfile({ name: content.display_name || content.name || "", picture: content.picture, nip05: content.nip05 });
          } catch {}
        },
        oneose() { if (!done) { done = true; try { sub.close(); } catch {} } },
      }
    );
    const timeout = setTimeout(() => { if (!done) { done = true; try { sub.close(); } catch {} } }, 4000);
    return () => { clearTimeout(timeout); if (!done) { done = true; try { sub.close(); } catch {} } };
  }, [lookupResult?.pubkey]);

  useEffect(() => {
    if (!socialGraph?.followers || socialGraph.followers.length === 0) {
      setFollowerProfiles(new Map());
      return;
    }
    const pubkeys = socialGraph.followers.slice(0, 20);
    const profiles = new Map<string, { name: string; picture?: string }>();

    for (const pk of pubkeys) {
      const cached = getCachedProfile(pk);
      if (cached) {
        try {
          const c = cached.kind === 0 ? JSON.parse(cached.content) : cached;
          const name = c.display_name || c.name || "";
          if (name) profiles.set(pk, { name, picture: c.picture });
        } catch {}
      }
    }
    if (profiles.size > 0) setFollowerProfiles(new Map(profiles));

    const uncached = pubkeys.filter(pk => !profiles.has(pk));
    if (uncached.length === 0) return;

    let done = false;
    const sub = throttledPoolSubscribe(
      DEFAULT_RELAYS.slice(0, 3),
      { kinds: [0], authors: uncached } as any,
      {
        onevent(ev: Event) {
          try {
            const content = JSON.parse(ev.content);
            const name = content.display_name || content.name || "";
            if (name) {
              profiles.set(ev.pubkey, { name, picture: content.picture });
            }
          } catch {}
        },
        oneose() {
          if (done) return;
          done = true;
          try { sub.close(); } catch {}
          if (profiles.size > 0) setFollowerProfiles(new Map(profiles));
        },
      }
    );
    const timeout = setTimeout(() => {
      if (!done) {
        done = true;
        try { sub.close(); } catch {}
        if (profiles.size > 0) setFollowerProfiles(new Map(profiles));
      }
    }, 6000);
    return () => { clearTimeout(timeout); if (!done) { done = true; try { sub.close(); } catch {} } };
  }, [socialGraph]);

  useEffect(() => {
    const last = getLastCopiedNostrId();
    if (last && !query) setQuery(last);
    return onNostrIdCopied((value) => {
      setQuery(value);
    });
  }, []);

  useEffect(() => {
    if (externalEventId) {
      const val = externalEventId.split("|")[0];
      setQuery(val);
      setIsOpen(true);
    }
  }, [externalEventId]);

  useEffect(() => {
    if (externalPubkey) {
      const val = externalPubkey.split("|")[0];
      setQuery(val);
      setIsOpen(true);
    }
  }, [externalPubkey]);

  type ParsedInput =
    | { type: "event"; hex: string }
    | { type: "pubkey"; hex: string }
    | { type: "hex"; hex: string }
    | { type: "invalid"; reason: string };

  const parseInput = (raw: string): ParsedInput => {
    let val = raw.trim();
    if (!val) return { type: "invalid", reason: "Empty input" };
    if (val.startsWith("nostr:")) val = val.slice(6);

    if (val.startsWith("note1") || val.startsWith("nevent1")) {
      try {
        const decoded = nip19.decode(val);
        if (decoded.type === "note") return { type: "event", hex: decoded.data as string };
        if (decoded.type === "nevent") return { type: "event", hex: (decoded.data as { id: string }).id };
      } catch {
        return { type: "invalid", reason: "Invalid note/nevent format" };
      }
    }

    if (val.startsWith("npub1")) {
      try {
        const decoded = nip19.decode(val);
        if (decoded.type === "npub") return { type: "pubkey", hex: decoded.data as string };
      } catch {
        return { type: "invalid", reason: "Invalid npub format" };
      }
    }

    if (val.startsWith("nprofile1")) {
      try {
        const decoded = nip19.decode(val);
        if (decoded.type === "nprofile") return { type: "pubkey", hex: (decoded.data as { pubkey: string }).pubkey };
      } catch {
        return { type: "invalid", reason: "Invalid nprofile format" };
      }
    }

    if (/^[0-9a-f]{64}$/i.test(val)) {
      return { type: "hex", hex: val.toLowerCase() };
    }

    return { type: "invalid", reason: "Unrecognized format — paste an event ID, note1, nevent1, npub, or hex pubkey" };
  };

  type LookupResult = "found" | "not_found" | "error";

  const runEventLookup = async (hex: string): Promise<LookupResult> => {
    try {
      const event = await fetchArchivesEvent(hex);
      if (event) {
        setLookupResult(event);
        setLastType("event");
        return "found";
      }
      return "not_found";
    } catch {
      return "error";
    }
  };

  const runSocialLookup = async (hex: string): Promise<LookupResult> => {
    try {
      const graph = await fetchArchivesSocialGraph(hex);
      if (graph) {
        setSocialGraph(graph);
        setLastType("pubkey");
        return "found";
      }
      return "not_found";
    } catch {
      return "error";
    }
  };

  const handleUniversalLookup = async () => {
    if (loading) return;
    const parsed = parseInput(query);
    if (parsed.type === "invalid") {
      toast({ title: parsed.reason, variant: "destructive" });
      return;
    }

    setLoading(true);
    setLookupResult(null);
    setSocialGraph(null);
    setLastType(null);

    try {
      if (parsed.type === "event") {
        const res = await runEventLookup(parsed.hex);
        if (res === "not_found") toast({ title: "Event not found in archives", variant: "destructive" });
        else if (res === "error") toast({ title: "Event lookup failed", variant: "destructive" });
      } else if (parsed.type === "pubkey") {
        const res = await runSocialLookup(parsed.hex);
        if (res === "not_found") toast({ title: "Profile not found in archives", variant: "destructive" });
        else if (res === "error") toast({ title: "Social graph lookup failed", variant: "destructive" });
      } else {
        const eventRes = await runEventLookup(parsed.hex);
        if (eventRes === "found") { /* done */ }
        else {
          const socialRes = await runSocialLookup(parsed.hex);
          if (socialRes !== "found") {
            const hadError = eventRes === "error" || socialRes === "error";
            toast({
              title: hadError ? "Lookup failed — could not reach archives" : "Not found as event or profile in archives",
              variant: "destructive",
            });
          }
        }
      }
    } finally {
      setLoading(false);
    }
  };


  const formatBigNumber = (n: number | undefined) => {
    if (n === undefined || n === null) return "—";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
    return n.toLocaleString();
  };

  const detectedType = (() => {
    const val = query.trim();
    if (!val) return null;
    if (val.startsWith("note1") || val.startsWith("nevent1")) return "event" as const;
    if (val.startsWith("npub1") || val.startsWith("nprofile1")) return "pubkey" as const;
    if (/^[0-9a-f]{64}$/i.test(val)) return "hex" as const;
    return null;
  })();

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="glass-card overflow-hidden" data-testid="archives-lookup">
        <CollapsibleTrigger className="w-full p-3 sm:p-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-brand" />
            <span className="text-xs font-brand uppercase tracking-widest text-muted-foreground">Archives Lookup</span>
            <a href="https://nostrarchives.com" target="_blank" rel="noopener noreferrer" className="inline-flex" onClick={(e) => e.stopPropagation()}>
              <Badge variant="secondary" className="text-[9px] bg-accent text-brand dark:text-brand/70 border-border cursor-pointer hover:bg-accent hover:text-brand transition-colors gap-1">
                <span className="opacity-50 font-normal">powered by</span>
                <Globe className="w-2.5 h-2.5 opacity-60" />
                Archives
              </Badge>
            </a>
          </div>
          {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 sm:px-4 pb-3 sm:pb-4 space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs font-brand uppercase tracking-widest text-muted-foreground">Lookup</Label>
                {detectedType && (
                  <Badge variant="outline" className="text-[9px] font-mono">
                    {detectedType === "event" ? "Event" : detectedType === "pubkey" ? "Profile" : "Hex (auto-detect)"}
                  </Badge>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Event ID, note1, nevent1, pubkey, or npub..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleUniversalLookup(); }}
                  className="font-mono text-xs"
                  style={{ fontSize: "16px" }}
                  data-testid="input-archives-lookup"
                />
                <Button size="sm" onClick={handleUniversalLookup} disabled={loading || !query.trim()} data-testid="button-archives-lookup">
                  {loading ? (
                    <Search className="w-3.5 h-3.5 animate-spin" />
                  ) : detectedType === "pubkey" ? (
                    <Users className="w-3.5 h-3.5" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
                  )}
                </Button>
              </div>
            </div>

            {lookupResult && lastType === "event" && (
              <div className="border border-border rounded-lg overflow-hidden bg-secondary/10">
                <div className="flex items-center gap-3 p-3 pb-0">
                  <Avatar className="w-10 h-10 ring-2 ring-ring/20">
                    {authorProfile?.picture && <AvatarImage src={authorProfile.picture} alt={authorProfile.name} />}
                    <AvatarFallback className="text-xs bg-accent text-brand">
                      {authorProfile?.name ? authorProfile.name.slice(0, 2).toUpperCase() : lookupResult.pubkey.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate">
                        {authorProfile?.name || (() => { try { return shortenNpub(nip19.npubEncode(lookupResult.pubkey)); } catch { return lookupResult.pubkey.slice(0, 12) + "…"; } })()}
                      </span>
                      {lookupResult.kind !== 1 && (
                        <Badge variant="secondary" className="font-mono text-[9px] shrink-0">Kind {lookupResult.kind}</Badge>
                      )}
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {(() => { try { return formatDistanceToNow(new Date(lookupResult.created_at * 1000), { addSuffix: true }); } catch { return new Date(lookupResult.created_at * 1000).toLocaleString(); } })()}
                    </span>
                  </div>
                </div>

                <div className="px-3 pt-2 pb-2">
                  <p className="text-[13px] leading-relaxed break-words whitespace-pre-wrap">
                    {lookupResult.content.slice(0, 600)}{lookupResult.content.length > 600 ? "…" : ""}
                  </p>
                </div>

                <div className="flex items-center gap-4 px-3 pb-2 text-muted-foreground">
                  {(lookupResult as any).reactions_count !== undefined && (
                    <span className="flex items-center gap-1 text-[11px]">
                      <Heart className="w-3.5 h-3.5 text-pink-400/70" />
                      {(lookupResult as any).reactions_count}
                    </span>
                  )}
                  {lookupResult.reactions !== undefined && (lookupResult as any).reactions_count === undefined && (
                    <span className="flex items-center gap-1 text-[11px]">
                      <Heart className="w-3.5 h-3.5 text-pink-400/70" />
                      {lookupResult.reactions}
                    </span>
                  )}
                  {(lookupResult as any).replies_count !== undefined && (
                    <span className="flex items-center gap-1 text-[11px]">
                      <MessageCircle className="w-3.5 h-3.5 text-blue-700/70 dark:text-blue-400/70" />
                      {(lookupResult as any).replies_count}
                    </span>
                  )}
                  {lookupResult.replies !== undefined && (lookupResult as any).replies_count === undefined && (
                    <span className="flex items-center gap-1 text-[11px]">
                      <MessageCircle className="w-3.5 h-3.5 text-blue-700/70 dark:text-blue-400/70" />
                      {lookupResult.replies}
                    </span>
                  )}
                  {(lookupResult as any).zaps_count !== undefined && (
                    <span className="flex items-center gap-1 text-[11px]">
                      <Zap className="w-3.5 h-3.5 text-amber-800/70 dark:text-amber-400/70" />
                      {(lookupResult as any).zaps_count}
                    </span>
                  )}
                  {lookupResult.zap_sats !== undefined && (lookupResult as any).zaps_count === undefined && (
                    <span className="flex items-center gap-1 text-[11px]">
                      <Zap className="w-3.5 h-3.5 text-amber-800/70 dark:text-amber-400/70" />
                      {lookupResult.zap_sats.toLocaleString()} sats
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 px-3 pb-3 border-t border-border pt-2">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => navigate(`/thread/${lookupResult.id}`)}
                    className="text-xs"
                    data-testid="button-thread-navigate"
                  >
                    <ExternalLink className="w-3 h-3 mr-1" />
                    View Thread
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(lookupResult.id);
                      toast({ title: "Event ID copied" });
                    }}
                    className="text-xs text-muted-foreground"
                  >
                    <Copy className="w-3 h-3 mr-1" />
                    Copy ID
                  </Button>
                </div>
              </div>
            )}

            {socialGraph && lastType === "pubkey" && (
              <div className="border border-border rounded-md p-3 bg-secondary/20 space-y-2">
                <div className="flex items-center gap-2">
                  <Users className="w-3 h-3 text-brand" />
                  <span className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground">Social Graph</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground/50">Followers</p>
                    <p className="text-lg font-mono font-semibold text-brand">{formatBigNumber(socialGraph.followers_count)}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground/50">Following</p>
                    <p className="text-lg font-mono font-semibold text-foreground">{formatBigNumber(socialGraph.following_count)}</p>
                  </div>
                </div>
                {socialGraph.followers && socialGraph.followers.length > 0 && (
                  <div>
                    <p className="text-[10px] text-muted-foreground/50 mb-1">Recent Followers</p>
                    <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                      {socialGraph.followers.slice(0, 20).map(pk => {
                        const profile = followerProfiles.get(pk);
                        return (
                          <div key={pk} className="flex items-center gap-1.5 rounded-full border border-border/30 bg-secondary/20 pl-0.5 pr-2 py-0.5">
                            <Avatar className="w-5 h-5">
                              {profile?.picture && <AvatarImage src={profile.picture} alt={profile.name} />}
                              <AvatarFallback className="text-[7px] bg-accent text-brand">
                                {profile?.name ? profile.name.slice(0, 2).toUpperCase() : pk.slice(0, 2)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-[10px] max-w-[100px] truncate">
                              {profile?.name || `${pk.slice(0, 8)}...`}
                            </span>
                          </div>
                        );
                      })}
                      {(socialGraph.followers.length > 20) && (
                        <Badge variant="outline" className="text-[9px] self-center">+{socialGraph.followers.length - 20} more</Badge>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

/**
 * Virtualized results list. The console can hold up to 5000 rows; a plain
 * `.map` inside a `max-h` scroller janks badly at that size. `useVirtualizer`
 * keeps DOM cost constant by rendering only the rows near the viewport, and
 * `measureElement` (ResizeObserver-backed) handles the variable row height when
 * a row is expanded — the same absolute-row + `translateY` pattern VirtualFeed
 * uses, but scoped to this card's own scroll container (VirtualFeed is bound to
 * the app's `.feed-scroll-container`, so it can't be reused directly here).
 */
function VirtualResults({
  events,
  expandedId,
  onToggle,
  onLookupEvent,
  onLookupPubkey,
}: {
  events: Event[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  onLookupEvent: (id: string) => void;
  onLookupPubkey: (pk: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollRef.current,
    // Collapsed rows are ~64–80px; measureElement corrects each real height,
    // including the much taller expanded rows.
    estimateSize: () => 72,
    overscan: 8,
    getItemKey: (index) => events[index]?.id ?? index,
  });
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      className="max-h-[60vh] sm:max-h-[600px] overflow-y-auto"
      data-testid="results-scroll-container"
    >
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}>
        {virtualItems.map((vi) => {
          const event = events[vi.index];
          if (!event) return null;
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}
            >
              <EventRow
                event={event}
                expanded={expandedId === event.id}
                onToggle={() => onToggle(event.id)}
                onLookupEvent={onLookupEvent}
                onLookupPubkey={onLookupPubkey}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function EventConsole({ embedded = false }: { embedded?: boolean } = {}) {
  const { toast } = useToast();

  const [archivesEventId, setArchivesEventId] = useState<string | undefined>();
  const [archivesPubkey, setArchivesPubkey] = useState<string | undefined>();
  const archivesEventCounter = useRef(0);
  const archivesPubkeyCounter = useRef(0);

  const handleLookupEvent = useCallback((id: string) => {
    archivesEventCounter.current += 1;
    setArchivesEventId(id + "|" + archivesEventCounter.current);
  }, []);

  const handleLookupPubkey = useCallback((pk: string) => {
    archivesPubkeyCounter.current += 1;
    setArchivesPubkey(pk + "|" + archivesPubkeyCounter.current);
  }, []);

  const [selectedRelays, setSelectedRelays] = useState<string[]>([...DEFAULT_RELAYS]);
  const [selectedKinds, setSelectedKinds] = useState<number[]>([]);
  const [authors, setAuthors] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [sinceTs, setSinceTs] = useState<number | undefined>(undefined);
  const [untilTs, setUntilTs] = useState<number | undefined>(undefined);
  const [limit, setLimit] = useState(100);
  const [idsInput, setIdsInput] = useState("");

  const [viewMode, setViewMode] = useState<"visual" | "json">("visual");
  const [jsonText, setJsonText] = useState(JSON.stringify({ kinds: [1], limit: 100 }, null, 2));
  const [jsonError, setJsonError] = useState("");

  const [results, setResults] = useState<Event[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [subscribeMode, setSubscribeMode] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const subRef = useRef<{ close: () => void } | null>(null);

  // Live-tail pause/resume: while paused, the displayed list is frozen and new
  // events accumulate in a buffer (with a "N new — tap to resume" pill) instead
  // of dropping. Resume merges the buffer back in. Pattern borrowed from
  // relay-ops LiveFeedTab (paused / pausedRef), extended to buffer + flush.
  const [livePaused, setLivePaused] = useState(false);
  const [bufferedCount, setBufferedCount] = useState(0);
  const livePausedRef = useRef(false);
  const liveResultsRef = useRef<Event[]>([]);
  const liveSeenRef = useRef<Set<string>>(new Set());
  const liveBufferRef = useRef<Event[]>([]);
  const liveMaxRef = useRef(5000);
  useEffect(() => { livePausedRef.current = livePaused; }, [livePaused]);

  const [resultsFilter, setResultsFilter] = useState("");

  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [historyOpen, setHistoryOpen] = useState(false);

  const buildFilter = useCallback((): Record<string, unknown> => {
    const filter: Record<string, unknown> = {};
    if (selectedKinds.length > 0) filter.kinds = selectedKinds;

    const authorList = authors
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean)
      .map((a) => {
        if (/^[0-9a-f]{64}$/i.test(a)) return a;
        try {
          const decoded = nip19.decode(a);
          if (decoded.type === "npub") return decoded.data as string;
        } catch {}
        return a;
      });
    if (authorList.length > 0) filter.authors = authorList;

    const tagParts = tagsInput
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const part of tagParts) {
      const colonIdx = part.indexOf(":");
      if (colonIdx > 0) {
        const tagName = part.slice(0, colonIdx);
        const tagValues = part
          .slice(colonIdx + 1)
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
        if (tagValues.length > 0) {
          const key = tagName.startsWith("#") ? tagName : `#${tagName}`;
          filter[key] = tagValues;
        }
      }
    }

    if (sinceTs !== undefined) filter.since = sinceTs;
    if (untilTs !== undefined) filter.until = untilTs;
    filter.limit = limit;

    const ids = idsInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length > 0) filter.ids = ids;

    return filter;
  }, [selectedKinds, authors, tagsInput, sinceTs, untilTs, limit, idsInput]);

  const applyFilterToForm = useCallback((filter: Record<string, unknown>) => {
    if (Array.isArray(filter.kinds)) setSelectedKinds(filter.kinds as number[]);
    else setSelectedKinds([]);

    if (Array.isArray(filter.authors)) setAuthors((filter.authors as string[]).join(", "));
    else setAuthors("");

    const tagParts: string[] = [];
    for (const [key, val] of Object.entries(filter)) {
      if (key.startsWith("#") && Array.isArray(val)) {
        tagParts.push(`${key}:${(val as string[]).join(",")}`);
      }
    }
    setTagsInput(tagParts.join("\n"));

    if (typeof filter.since === "number") setSinceTs(filter.since);
    else setSinceTs(undefined);

    if (typeof filter.until === "number") setUntilTs(filter.until);
    else setUntilTs(undefined);

    if (typeof filter.limit === "number") setLimit(filter.limit);
    else setLimit(100);

    if (Array.isArray(filter.ids)) setIdsInput((filter.ids as string[]).join(", "));
    else setIdsInput("");
  }, []);

  useEffect(() => {
    if (viewMode === "json") {
      const filter = buildFilter();
      setJsonText(JSON.stringify(filter, null, 2));
      setJsonError("");
    }
  }, [viewMode, buildFilter]);

  const handleJsonChange = useCallback(
    (text: string) => {
      setJsonText(text);
      try {
        const parsed = JSON.parse(text);
        setJsonError("");
        applyFilterToForm(parsed);
      } catch {
        setJsonError("Invalid JSON");
      }
    },
    [applyFilterToForm]
  );

  // Deep-link hand-off: on mount, read `?filter=` / `?relay=` (built by the
  // Feedback drawers and the post / relay / profile entry points, and preserved
  // through the `/console` → `/account?tab=console` redirect). Pre-fill the
  // visual builder AND the JSON editor, and select the given relay.
  useEffect(() => {
    const { filter, relay } = parseConsoleQueryParams(window.location.search);
    if (relay) setSelectedRelays([relay]);
    if (filter) {
      applyFilterToForm(filter);
      setJsonText(JSON.stringify(filter, null, 2));
      setJsonError("");
    }
    // Mount-only: applying once avoids clobbering the user's later edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopSubscription = useCallback(() => {
    if (subRef.current) {
      subRef.current.close();
      subRef.current = null;
    }
    setIsSubscribed(false);
    setIsRunning(false);
    setLivePaused(false);
    setBufferedCount(0);
    liveBufferRef.current = [];
  }, []);

  // Resume a paused live tail: merge the buffered events into the displayed
  // list (dedup-sorted, capped) and clear the pill. Called by both the pill and
  // the Pause/Resume toggle.
  const resumeLiveTail = useCallback(() => {
    const buffered = liveBufferRef.current;
    liveBufferRef.current = [];
    if (buffered.length > 0) {
      const merged = [...buffered, ...liveResultsRef.current];
      merged.sort((a, b) => b.created_at - a.created_at);
      liveResultsRef.current = merged.slice(0, liveMaxRef.current);
      setResults([...liveResultsRef.current]);
    }
    setBufferedCount(0);
    setLivePaused(false);
  }, []);

  const toggleLivePause = useCallback(() => {
    if (livePausedRef.current) resumeLiveTail();
    else setLivePaused(true);
  }, [resumeLiveTail]);

  const executeQuery = useCallback(async () => {
    if (selectedRelays.length === 0) {
      toast({ title: "No relays selected", description: "Select at least one relay.", variant: "destructive" });
      return;
    }
    stopSubscription();
    setIsRunning(true);

    const filter = buildFilter();
    const newResults: Event[] = [];
    const seenIds = new Set<string>();

    setResults([]);

    if (subscribeMode) {
      const maxResults = Math.min(limit, 5000);
      // Reset live-tail state for the new subscription.
      liveMaxRef.current = maxResults;
      liveResultsRef.current = [];
      liveSeenRef.current = new Set();
      liveBufferRef.current = [];
      setLivePaused(false);
      setBufferedCount(0);
      // Live Mode must actually TAIL, so subscribe directly (like relay-ops
      // LiveFeedTab). `throttledPoolSubscribe` closes each relay sub on EOSE —
      // fine for the one-shot Run path, but it would deliver only the stored
      // batch and never stream, leaving pause/buffer nothing to freeze.
      const sub = pool.subscribeMany(selectedRelays, filter as unknown as Filter, {
        onevent(event: Event) {
          if (liveSeenRef.current.has(event.id)) return;
          liveSeenRef.current.add(event.id);
          // Paused: buffer (newest-first, capped) and surface the count via the
          // pill; the displayed list stays frozen until the user resumes.
          if (livePausedRef.current) {
            liveBufferRef.current.unshift(event);
            if (liveBufferRef.current.length > maxResults) liveBufferRef.current.length = maxResults;
            setBufferedCount(liveBufferRef.current.length);
            return;
          }
          const next = [event, ...liveResultsRef.current];
          next.sort((a, b) => b.created_at - a.created_at);
          liveResultsRef.current = next.slice(0, maxResults);
          setResults([...liveResultsRef.current]);
        },
      });
      subRef.current = sub;
      setIsSubscribed(true);
      setIsRunning(false);
    } else {
      try {
        const events = await pool.querySync(selectedRelays, filter as unknown as Filter);
        for (const ev of events) {
          if (!seenIds.has(ev.id)) {
            seenIds.add(ev.id);
            newResults.push(ev);
          }
        }
        newResults.sort((a, b) => b.created_at - a.created_at);
        const truncated = newResults.slice(0, limit);
        setResults(truncated);

        const entry: HistoryEntry = {
          filter,
          relays: [...selectedRelays],
          timestamp: Math.floor(Date.now() / 1000),
          resultCount: truncated.length,
        };
        const updated = [entry, ...history].slice(0, 20);
        setHistory(updated);
        saveHistory(updated);
      } catch (err) {
        console.error("Query failed:", err);
        toast({ title: "Query failed", description: String(err), variant: "destructive" });
      } finally {
        setIsRunning(false);
      }
    }
  }, [selectedRelays, buildFilter, subscribeMode, stopSubscription, toast, history, pool]);

  useEffect(() => {
    return () => {
      if (subRef.current) {
        subRef.current.close();
      }
    };
  }, []);

  const filteredResults = useMemo(() => {
    const q = resultsFilter.trim().toLowerCase();
    if (!q) return results;
    return results.filter((e) => {
      if (e.content.toLowerCase().includes(q)) return true;
      if (e.id.toLowerCase().includes(q)) return true;
      if (e.pubkey.toLowerCase().includes(q)) return true;
      const kindLabel = getKindLabel(e.kind).toLowerCase();
      if (kindLabel.includes(q)) return true;
      if (String(e.kind).includes(q)) return true;
      try {
        const npub = nip19.npubEncode(e.pubkey);
        if (npub.toLowerCase().includes(q)) return true;
      } catch {}
      return false;
    });
  }, [results, resultsFilter]);

  const downloadResults = useCallback((format: "json" | "csv") => {
    const ts = Date.now();
    let content: string;
    let mimeType: string;
    let ext: string;
    if (format === "csv") {
      content = eventsToCsv(results);
      mimeType = "text/csv";
      ext = "csv";
    } else {
      content = JSON.stringify(results, null, 2);
      mimeType = "application/json";
      ext = "json";
    }
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nostr-events-${ts}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }, [results]);

  const loadHistoryEntry = useCallback(
    (entry: HistoryEntry) => {
      applyFilterToForm(entry.filter);
      setSelectedRelays(entry.relays);
      if (viewMode === "json") {
        setJsonText(JSON.stringify(entry.filter, null, 2));
      }
    },
    [applyFilterToForm, viewMode]
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, []);

  const formatTimestamp = useCallback((ts: number | undefined) => {
    if (ts === undefined) return "";
    try {
      return format(new Date(ts * 1000), "yyyy-MM-dd'T'HH:mm");
    } catch {
      return "";
    }
  }, []);

  const parseDatetimeInput = useCallback((val: string): number | undefined => {
    if (!val) return undefined;
    try {
      return Math.floor(new Date(val).getTime() / 1000);
    } catch {
      return undefined;
    }
  }, []);

  return (
    <div className={embedded ? "" : "px-3 sm:px-4 py-3 sm:py-6"} data-testid="page-event-console">
      <div className={embedded ? "space-y-4 pb-6" : "max-w-3xl mx-auto space-y-4 pb-6"}>
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-base sm:text-lg font-semibold text-foreground" data-testid="text-page-title">
            <Terminal className="w-4 h-4 sm:w-5 sm:h-5 text-brand/70 shrink-0" />
            Event Console
          </h1>
          <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed" data-testid="text-page-subtitle">
            Query relays directly. Build filters, subscribe to live events, and inspect raw event data.
          </p>
        </div>

        <ArchivesLookup
          externalEventId={archivesEventId}
          externalPubkey={archivesPubkey}
        />

        <Card className="glass-card p-3 sm:p-4 space-y-3 sm:space-y-4 overflow-hidden min-w-0" data-testid="card-filter-builder">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-brand uppercase tracking-widest text-muted-foreground">Filter Builder</span>
            <div className="flex items-center gap-2">
              <Button
                variant={viewMode === "visual" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("visual")}
                className="text-xs"
                data-testid="button-view-visual"
              >
                <Eye className="w-3.5 h-3.5 mr-1" />
                Visual
              </Button>
              <Button
                variant={viewMode === "json" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("json")}
                className="text-xs"
                data-testid="button-view-json"
              >
                <Code className="w-3.5 h-3.5 mr-1" />
                JSON
              </Button>
            </div>
          </div>

          {viewMode === "visual" ? (
            <div className="space-y-4">
              <RelaySelector
                selectedRelays={selectedRelays}
                onSelectedRelaysChange={setSelectedRelays}
              />

              <KindPicker
                selectedKinds={selectedKinds}
                onSelectedKindsChange={setSelectedKinds}
              />

              <div className="space-y-1.5">
                <Label className="text-xs font-brand uppercase tracking-widest text-muted-foreground">Authors</Label>
                <AuthorPicker
                  value={authors}
                  onChange={setAuthors}
                />
                <p className="text-[11px] text-muted-foreground/80 break-words">Search by name, or paste hex pubkeys / npub addresses</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-brand uppercase tracking-widest text-muted-foreground">Tag Filters</Label>
                <Textarea
                  placeholder="#t:bitcoin,nostr  #e:eventid  #p:pubkey"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  rows={2}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="font-mono text-xs min-h-[44px] resize-y break-all leading-relaxed"
                  style={{ fontSize: "16px" }}
                  data-testid="input-tags"
                />
                <p className="text-[11px] text-muted-foreground/80 break-words">Format: #t:bitcoin,nostr or #e:eventid (comma-separate multiple entries)</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-brand uppercase tracking-widest text-muted-foreground">Start</Label>
                  <Input
                    type="datetime-local"
                    value={formatTimestamp(sinceTs)}
                    onChange={(e) => setSinceTs(parseDatetimeInput(e.target.value))}
                    className="text-xs font-mono"
                    style={{ fontSize: "16px" }}
                    data-testid="input-since"
                  />
                  <div className="flex flex-wrap gap-1">
                    {TIME_SHORTCUTS.map((s) => (
                      <Button
                        key={`since-${s.label}`}
                        variant="ghost"
                        size="sm"
                        className="text-[11px] font-mono"
                        onClick={() => setSinceTs(Math.floor(Date.now() / 1000) - s.offset)}
                        data-testid={`button-since-${s.label.replace(/\s+/g, "-")}`}
                      >
                        {s.label}
                      </Button>
                    ))}
                    {sinceTs !== undefined && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-[11px]"
                        onClick={() => setSinceTs(undefined)}
                        data-testid="button-clear-since"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-brand uppercase tracking-widest text-muted-foreground">End</Label>
                  <Input
                    type="datetime-local"
                    value={formatTimestamp(untilTs)}
                    onChange={(e) => setUntilTs(parseDatetimeInput(e.target.value))}
                    className="text-xs font-mono"
                    style={{ fontSize: "16px" }}
                    data-testid="input-until"
                  />
                  <div className="flex flex-wrap gap-1">
                    {TIME_SHORTCUTS.map((s) => (
                      <Button
                        key={`until-${s.label}`}
                        variant="ghost"
                        size="sm"
                        className="text-[11px] font-mono"
                        onClick={() => setUntilTs(Math.floor(Date.now() / 1000) - s.offset)}
                        data-testid={`button-until-${s.label.replace(/\s+/g, "-")}`}
                      >
                        {s.label}
                      </Button>
                    ))}
                    {untilTs !== undefined && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-[11px]"
                        onClick={() => setUntilTs(undefined)}
                        data-testid="button-clear-until"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-3 flex-wrap">
                  <Label className="text-xs font-brand uppercase tracking-widest text-muted-foreground">Limit</Label>
                  <span className="text-xs font-mono text-brand">{limit}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Slider
                    min={1}
                    max={5000}
                    step={1}
                    value={[limit]}
                    onValueChange={([v]) => setLimit(v)}
                    className="flex-1"
                    data-testid="slider-limit"
                  />
                  <Input
                    type="number"
                    min={1}
                    max={5000}
                    value={limit}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v) && v >= 1 && v <= 5000) setLimit(v);
                    }}
                    className="w-20 text-xs font-mono"
                    style={{ fontSize: "16px" }}
                    data-testid="input-limit"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-brand uppercase tracking-widest text-muted-foreground">Event IDs (optional)</Label>
                <Input
                  placeholder="Specific event IDs, comma separated"
                  value={idsInput}
                  onChange={(e) => setIdsInput(e.target.value)}
                  className="font-mono text-xs truncate"
                  style={{ fontSize: "16px" }}
                  data-testid="input-ids"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Textarea
                value={jsonText}
                onChange={(e) => handleJsonChange(e.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className="font-mono text-[11px] sm:text-xs min-h-[220px] sm:min-h-[260px] resize-y leading-relaxed"
                style={{ fontSize: "16px" }}
                data-testid="textarea-json-filter"
              />
              {jsonError && (
                <p className="text-xs text-destructive" data-testid="text-json-error">{jsonError}</p>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 sm:gap-3 pt-2 border-t border-border/30 flex-wrap">
            {isSubscribed ? (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={stopSubscription}
                  data-testid="button-stop"
                >
                  <Square className="w-3.5 h-3.5 mr-1" />
                  Stop
                </Button>
                <Button
                  variant={livePaused ? "default" : "outline"}
                  size="sm"
                  onClick={toggleLivePause}
                  data-testid="button-pause-live"
                  title={livePaused ? "Resume live tail (flush buffered events)" : "Pause live tail (keep buffering)"}
                >
                  {livePaused ? <Play className="w-3.5 h-3.5 mr-1" /> : <Pause className="w-3.5 h-3.5 mr-1" />}
                  {livePaused ? (bufferedCount > 0 ? `Resume (${bufferedCount})` : "Resume") : "Pause"}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={executeQuery}
                disabled={isRunning}
                data-testid="button-run"
              >
                <Play className="w-3.5 h-3.5 mr-1" />
                {isRunning ? "Running..." : "Run"}
              </Button>
            )}

            <div className="flex items-center gap-2">
              <Switch
                checked={subscribeMode}
                onCheckedChange={setSubscribeMode}
                data-testid="switch-subscribe"
              />
              <Label className="text-xs text-muted-foreground cursor-pointer" onClick={() => setSubscribeMode(!subscribeMode)}>
                Live Mode
              </Label>
              {isSubscribed && (
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              )}
            </div>

            <Badge variant="secondary" className="ml-auto font-mono text-xs" data-testid="badge-result-count">
              {results.length} event{results.length !== 1 ? "s" : ""}
            </Badge>
          </div>
        </Card>

        {results.length > 0 && (
          <Card className="glass-card overflow-hidden" data-testid="card-results">
            <div className="flex items-center justify-between gap-2 p-2.5 sm:p-3 border-b border-border/30 flex-wrap">
              <span className="text-xs font-brand uppercase tracking-widest text-muted-foreground">
                Results ({resultsFilter ? `${filteredResults.length} / ${results.length}` : results.length})
              </span>
              <div className="flex items-center gap-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      data-testid="button-download-results"
                    >
                      <Download className="w-3.5 h-3.5 sm:mr-1" />
                      <span className="hidden sm:inline">Export</span>
                      <ChevronDown className="w-3 h-3 ml-0.5 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[120px]">
                    <DropdownMenuItem onClick={() => downloadResults("csv")} data-testid="button-export-csv">
                      <FileSpreadsheet className="w-3.5 h-3.5 mr-2" />
                      CSV
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => downloadResults("json")} data-testid="button-export-json">
                      <Braces className="w-3.5 h-3.5 mr-2" />
                      JSON
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setResults([]); setResultsFilter(""); }}
                  className="text-xs"
                  data-testid="button-clear-results"
                >
                  <Trash2 className="w-3.5 h-3.5 sm:mr-1" />
                  <span className="hidden sm:inline">Clear</span>
                </Button>
              </div>
            </div>
            <div className="px-2.5 sm:px-3 py-2 border-b border-border/30">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
                <Input
                  placeholder="Filter results by content, author, kind..."
                  value={resultsFilter}
                  onChange={(e) => setResultsFilter(e.target.value)}
                  className="pl-8 pr-8 text-xs h-8"
                  style={{ fontSize: "16px" }}
                  data-testid="input-results-filter"
                />
                {resultsFilter && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-0.5 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={() => setResultsFilter("")}
                    data-testid="button-clear-results-filter"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </div>
            {/* Live-tail resume pill (Twitter "N new" pattern): shows when the
                tail is paused with buffered events; tapping flushes + resumes. */}
            {livePaused && bufferedCount > 0 && (
              <button
                onClick={resumeLiveTail}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-brand/10 hover:bg-brand/15 text-brand text-xs font-medium border-b border-border/30 transition-colors"
                data-testid="button-resume-live-pill"
              >
                <ArrowDown className="w-3.5 h-3.5" />
                {bufferedCount} new event{bufferedCount !== 1 ? "s" : ""} — tap to resume
              </button>
            )}
            {filteredResults.length === 0 ? (
              <div className="max-h-[60vh] sm:max-h-[600px] overflow-y-auto p-6 text-center">
                <p className="text-xs text-muted-foreground">No results match "{resultsFilter}"</p>
              </div>
            ) : (
              <VirtualResults
                events={filteredResults}
                expandedId={expandedId}
                onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
                onLookupEvent={handleLookupEvent}
                onLookupPubkey={handleLookupPubkey}
              />
            )}
          </Card>
        )}

        <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
          <Card className="glass-card overflow-hidden" data-testid="card-history">
            <CollapsibleTrigger asChild>
              <button
                className="w-full flex items-center justify-between gap-2 p-3 text-left hover-elevate transition-colors rounded-md"
                data-testid="button-toggle-history"
              >
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-brand uppercase tracking-widest text-muted-foreground">
                    Query History
                  </span>
                  <Badge variant="secondary" className="text-[11px]" data-testid="badge-history-count">
                    {history.length}
                  </Badge>
                </div>
                {historyOpen ? (
                  <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              {history.length > 0 ? (
                <>
                  <div className="border-t border-border/30">
                    {history.map((entry, idx) => {
                      const kinds = Array.isArray(entry.filter.kinds)
                        ? (entry.filter.kinds as number[]).map((k) => `${k}`).join(", ")
                        : "any";
                      const timeAgo = formatDistanceToNow(new Date(entry.timestamp * 1000), { addSuffix: true });
                      return (
                        <button
                          key={idx}
                          onClick={() => loadHistoryEntry(entry)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover-elevate transition-colors border-b border-border/20 last:border-b-0"
                          data-testid={`button-history-entry-${idx}`}
                        >
                          <Clock className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
                          <div className="flex-1 min-w-0 flex items-center gap-1.5 sm:gap-2 flex-wrap">
                            <span className="text-[11px] text-muted-foreground/80">{timeAgo}</span>
                            <Badge variant="secondary" className="text-[11px]">{entry.relays.length}r</Badge>
                            <span className="text-[11px] font-mono text-muted-foreground truncate max-w-[100px] sm:max-w-none">k:{kinds}</span>
                            <Badge variant="secondary" className="text-[11px] ml-auto">{entry.resultCount}</Badge>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="p-3 border-t border-border/30">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearHistory}
                      className="text-xs"
                      data-testid="button-clear-history"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                      Clear History
                    </Button>
                  </div>
                </>
              ) : (
                <div className="p-4 text-center">
                  <p className="text-xs text-muted-foreground">No query history yet. Run a query to get started.</p>
                </div>
              )}
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <Card className="glass-card px-3 py-2.5 overflow-hidden opacity-60" data-testid="console-disclaimer-bottom">
          <div className="flex gap-2.5">
            <Radio className="w-3.5 h-3.5 text-brand/40 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-foreground/60 tracking-wide font-mono uppercase">About these results</p>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Results depend on which relays respond, their retention policies, and current load. Not all events are visible from every vantage point — relays filter, rate-limit, and prioritize differently. What you see here is one slice of a distributed network.
              </p>
              <p className="text-[10px] leading-relaxed text-muted-foreground/70 italic">
                Verify independently. Trust the math, not the relay.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
