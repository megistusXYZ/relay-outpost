import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { DEFAULT_RELAYS, pool, getBlockedRelays, isRelayBlocked, blockRelay, unblockRelay, fetchBlockedRelayList, publishBlockedRelayList, eventStore, throttledPoolSubscribe, publishEvent, verifySignedEventKind } from "@/lib/nostr";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RelayOutpostInlineLoader, RelayOutpostIcon } from "@/components/RelayOutpostLoader";
import { Radio, Plus, Trash2, RefreshCw, Wifi, WifiOff, Gauge, Globe, Power, PowerOff, Satellite, Lock, Unlock, Pencil, Check, X, ChevronDown, ChevronUp, Activity, ShieldBan, ShieldCheck, Upload, ExternalLink, AlertTriangle, Search, Server, Zap, Shield, Mail, Hash, FileDown, Info, Copy, Signal, Terminal } from "lucide-react";
import type { Event as NostrEvent } from "nostr-tools";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RelayHealthMonitor } from "@/components/analytics/RelayHealthMonitor";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { signWithTimeout } from "@/lib/signer-timeout";
import { buildRelayListTags, normalizeRouteUrl } from "@/lib/relay-routing";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  getOutpostRelays,
  getCustomRelays,
  getDisabledRelays,
  type OutpostRelay,
} from "@/lib/outpost-relays";
import { fetchNip11, type Nip11Document } from "@/lib/nip11";
import { TrustTierDot } from "@/components/NostrPost";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";

const CUSTOM_RELAYS_KEY = "nostr_custom_relays";
const DISABLED_RELAYS_KEY = "nostr_disabled_relays";
const OUTPOST_RELAYS_KEY = "nostr_outpost_relays";

function saveCustomRelays(relays: string[]) {
  localStorage.setItem(CUSTOM_RELAYS_KEY, JSON.stringify(relays));
}

function saveDisabledRelays(disabled: Set<string>) {
  localStorage.setItem(DISABLED_RELAYS_KEY, JSON.stringify(Array.from(disabled)));
}

function saveOutpostRelays(relays: OutpostRelay[]) {
  localStorage.setItem(OUTPOST_RELAYS_KEY, JSON.stringify(relays));
  window.dispatchEvent(new CustomEvent("outpost-relays-changed"));
}

interface RelayStatus {
  url: string;
  connected: boolean;
  latency: number | null;
  error: string | null;
  testing: boolean;
  isDefault: boolean;
  enabled: boolean;
}

async function testRelay(url: string): Promise<{ connected: boolean; latency: number | null; error: string | null }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const timeout = setTimeout(() => {
      resolve({ connected: false, latency: null, error: "Timeout (5s)" });
    }, 5000);

    try {
      const ws = new WebSocket(url);
      ws.onopen = () => {
        const latency = Date.now() - start;
        clearTimeout(timeout);
        ws.close();
        resolve({ connected: true, latency, error: null });
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        resolve({ connected: false, latency: null, error: "Connection failed" });
      };
      ws.onclose = (event) => {
        if (!event.wasClean && event.code !== 1000) {
          clearTimeout(timeout);
          resolve({ connected: false, latency: null, error: `Closed: ${event.code}` });
        }
      };
    } catch (err) {
      clearTimeout(timeout);
      resolve({ connected: false, latency: null, error: "Invalid URL" });
    }
  });
}

function disconnectRelay(url: string) {
  try {
    const relayPool = pool as any;
    if (relayPool.relays) {
      const relay = relayPool.relays.get(url);
      if (relay) {
        relay.close();
        relayPool.relays.delete(url);
      }
    }
    if (relayPool._relays) {
      const relay = relayPool._relays.get(url);
      if (relay) {
        relay.close();
        relayPool._relays.delete(url);
      }
    }
  } catch {}
}

function connectRelay(url: string) {
  try {
    const relayPool = pool as any;
    if (relayPool.ensureRelay) {
      relayPool.ensureRelay(url).catch(() => {});
    }
  } catch {}
}

const NIP_66_MONITOR_RELAYS = [
  "wss://relaypag.es",
  "wss://monitorlizard.nostr1.com",
];

const NIP_LABELS: Record<number, string> = {
  1: "Notes", 2: "Relay List", 4: "DMs (NIP-04)", 9: "Chat", 11: "Channels",
  17: "Private DMs", 28: "Public Chat", 40: "Channels", 42: "Auth", 45: "Counting",
  50: "Search", 56: "Reporting", 65: "Relay List", 70: "Protected", 96: "File Storage",
};

const NIP_FILTER_PRESETS: { label: string; nips: number[]; icon: typeof Shield }[] = [
  { label: "DM Relays", nips: [17], icon: Mail },
  { label: "AUTH Required", nips: [42], icon: Lock },
  { label: "Search", nips: [50], icon: Search },
  { label: "File Storage", nips: [96], icon: FileDown },
  { label: "Counting", nips: [45], icon: Hash },
];

interface MonitorRelay {
  url: string;
  supportedNips: number[];
  requirements: string[];
  software: string;
  network: string;
  relayType: string;
  lastSeen: number;
  nip11: Nip11Document | null;
  nip11Loading: boolean;
  operatorPubkey: string | null;
}

interface DiscoverRelaysSectionProps {
  customRelays: string[];
  outpostRelays: OutpostRelay[];
  onAddConnection: (url: string) => void;
  onAddOutpost: (url: string) => void;
}

function DiscoverRelaysSection({ customRelays, outpostRelays: outpostRelaysProp, onAddConnection, onAddOutpost }: DiscoverRelaysSectionProps) {
  const [relays, setRelays] = useState<MonitorRelay[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeNipFilter, setActiveNipFilter] = useState<number[]>([]);
  const [requireAuth, setRequireAuth] = useState(false);
  const [expandedRelay, setExpandedRelay] = useState<string | null>(null);
  const [addedRelays, setAddedRelays] = useState<Set<string>>(new Set());
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const fetchedRef = useRef(false);
  const { requestScoresBulk } = useGrapeRankScores();
  const prefetchedPubkeysRef = useRef(new Set<string>());

  useEffect(() => {
    const allRelays = [...DEFAULT_RELAYS, ...customRelays, ...(outpostRelaysProp || []).map(r => r.url)];
    setAddedRelays(new Set(allRelays.map(u => u.replace(/\/+$/, "").toLowerCase())));
  }, [customRelays, outpostRelaysProp]);

  useEffect(() => {
    if (!isOpen || fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);

    const relayMap = new Map<string, MonitorRelay>();
    let closed = false;

    const sub = pool.subscribeMany(
      NIP_66_MONITOR_RELAYS,
      { kinds: [30166], limit: 2000 },
      {
        onevent(e: NostrEvent) {
          if (closed) return;
          const dTag = e.tags.find(t => t[0] === "d")?.[1];
          if (!dTag) return;

          const relayUrl = dTag.startsWith("wss://") || dTag.startsWith("ws://") ? dTag : "wss://" + dTag;
          const normalizedUrl = relayUrl.replace(/\/+$/, "").toLowerCase();

          const existing = relayMap.get(normalizedUrl);
          if (existing && existing.lastSeen >= e.created_at) return;

          const supportedNips = e.tags
            .filter(t => t[0] === "N")
            .map(t => parseInt(t[1], 10))
            .filter(n => !isNaN(n));

          const requirements = e.tags
            .filter(t => t[0] === "R")
            .map(t => t[1]?.toLowerCase())
            .filter(Boolean) as string[];

          const software = e.tags.find(t => t[0] === "s")?.[1] || "";
          const network = e.tags.find(t => t[0] === "n")?.[1] || "";
          const relayType = e.tags.find(t => t[0] === "T")?.[1] || "";

          const operatorPubkey = e.tags.find(t => t[0] === "p")?.[1] || null;

          relayMap.set(normalizedUrl, {
            url: normalizedUrl,
            supportedNips,
            requirements,
            software,
            network,
            relayType,
            lastSeen: e.created_at,
            nip11: null,
            nip11Loading: false,
            operatorPubkey,
          });
        },
        oneose() {
          if (closed) return;
          closed = true;
          clearTimeout(timer);
          sub.close();
          const results = Array.from(relayMap.values()).sort((a, b) => b.supportedNips.length - a.supportedNips.length);
          setRelays(results);
          setLoading(false);
        },
      },
    );

    const timer = setTimeout(() => {
      if (!closed) {
        closed = true;
        sub.close();
        const results = Array.from(relayMap.values()).sort((a, b) => b.supportedNips.length - a.supportedNips.length);
        setRelays(results);
        setLoading(false);
      }
    }, 15000);

    return () => {
      closed = true;
      sub.close();
      clearTimeout(timer);
    };
  }, [isOpen]);

  useEffect(() => {
    if (relays.length === 0) return;
    const newPubkeys = relays
      .map(r => r.operatorPubkey)
      .filter((p): p is string => p !== null && !prefetchedPubkeysRef.current.has(p));
    const unique = [...new Set(newPubkeys)];
    if (unique.length > 0) {
      unique.forEach(p => prefetchedPubkeysRef.current.add(p));
      requestScoresBulk(unique);
    }
  }, [relays, requestScoresBulk]);

  const handleExpand = useCallback(async (relayUrl: string) => {
    if (expandedRelay === relayUrl) {
      setExpandedRelay(null);
      return;
    }
    setExpandedRelay(relayUrl);

    setRelays(prev => prev.map(r => {
      if (r.url !== relayUrl || r.nip11 || r.nip11Loading) return r;
      return { ...r, nip11Loading: true };
    }));

    const relay = relays.find(r => r.url === relayUrl);
    if (relay && !relay.nip11 && !relay.nip11Loading) {
      const doc = await fetchNip11(relayUrl);
      setRelays(prev => prev.map(r =>
        r.url === relayUrl ? { ...r, nip11: doc, nip11Loading: false, operatorPubkey: r.operatorPubkey || doc?.pubkey || null } : r
      ));
    }
  }, [expandedRelay, relays]);

  const handleAddConnection = useCallback((relayUrl: string) => {
    let url = relayUrl.replace(/\/+$/, "").toLowerCase();
    if (!url.startsWith("wss://") && !url.startsWith("ws://")) url = "wss://" + url;
    setAddedRelays(prev => new Set(prev).add(url));
    onAddConnection(url);
  }, [onAddConnection]);

  const handleAddOutpost = useCallback((relayUrl: string) => {
    let url = relayUrl.replace(/\/+$/, "").toLowerCase();
    if (!url.startsWith("wss://") && !url.startsWith("ws://")) url = "wss://" + url;
    setAddedRelays(prev => new Set(prev).add(url));
    onAddOutpost(url);
  }, [onAddOutpost]);

  const filtered = useMemo(() => {
    return relays.filter(r => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!r.url.toLowerCase().includes(q) && !r.software.toLowerCase().includes(q) && !r.relayType.toLowerCase().includes(q)) {
          return false;
        }
      }
      if (activeNipFilter.length > 0) {
        if (!activeNipFilter.every(nip => r.supportedNips.includes(nip))) return false;
      }
      if (requireAuth) {
        if (!r.requirements.includes("auth") && !r.supportedNips.includes(42)) return false;
      }
      return true;
    });
  }, [relays, searchQuery, activeNipFilter, requireAuth]);

  const toggleNipFilter = useCallback((nips: number[]) => {
    setActiveNipFilter(prev => {
      const same = prev.length === nips.length && prev.every((n, i) => n === nips[i]);
      return same ? [] : nips;
    });
  }, []);

  return (
    <div className="mt-6">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <Card className="glass-card overflow-hidden">
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between gap-2 p-4 text-left">
              <div className="flex items-center gap-2 flex-wrap">
                <Globe className="w-4 h-4 text-brand" />
                <h2 className="text-sm font-brand tracking-wider uppercase text-brand">Discover Relays</h2>
              </div>
              {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-4 border-t border-border pt-3 space-y-4">
              {loading ? (
                <div className="flex flex-col items-center justify-center min-h-[200px] gap-4">
                  <RelayOutpostInlineLoader className="w-8 h-8" />
                  <p className="text-sm text-muted-foreground/60">Querying NIP-66 relay monitors...</p>
                  <p className="text-[10px] text-muted-foreground/40 font-mono">relaypag.es · monitorlizard.nostr1.com</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
                      <Input
                        placeholder="Search relays by URL, software..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="pl-8 h-8 text-xs bg-background dark:bg-white/[0.03]"
                      />
                      {searchQuery && (
                        <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2">
                          <X className="w-3 h-3 text-muted-foreground/50 hover:text-muted-foreground" />
                        </button>
                      )}
                    </div>
                    <Badge
                      variant={requireAuth ? "default" : "outline"}
                      className={`cursor-pointer text-[10px] h-6 transition-colors ${
                        requireAuth ? "bg-primary hover:bg-primary/90 text-primary-foreground" : "hover:bg-muted dark:hover:bg-white/[0.04]"
                      }`}
                      onClick={() => setRequireAuth(!requireAuth)}
                    >
                      <Lock className="w-2.5 h-2.5 mr-1" />
                      AUTH
                    </Badge>
                    <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                      {filtered.length} of {relays.length} relays
                    </span>
                  </div>

                  <div className="flex gap-1.5 flex-wrap">
                    {NIP_FILTER_PRESETS.map(preset => {
                      const Icon = preset.icon;
                      const isActive = activeNipFilter.length === preset.nips.length && activeNipFilter.every((n, i) => n === preset.nips[i]);
                      return (
                        <button
                          key={preset.label}
                          onClick={() => toggleNipFilter(preset.nips)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                            isActive
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted dark:bg-white/[0.04] text-muted-foreground/70 hover:bg-accent dark:hover:bg-white/[0.08]"
                          }`}
                        >
                          <Icon className="w-2.5 h-2.5" />
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>

                  {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center min-h-[150px] gap-3">
                      <Globe className="w-8 h-8 text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground/50">No relays match your filters</p>
                      <button onClick={() => { setSearchQuery(""); setActiveNipFilter([]); setRequireAuth(false); }} className="text-xs text-brand hover:text-brand/80">
                        Clear filters
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filtered.slice(0, 100).map(relay => {
                        const isExpanded = expandedRelay === relay.url;
                        const isAdded = addedRelays.has(relay.url);
                        const shortUrl = relay.url.replace("wss://", "").replace("ws://", "");
                        const hasAuth = relay.requirements.includes("auth") || relay.supportedNips.includes(42);
                        const hasPayment = relay.requirements.includes("payment");

                        return (
                          <div key={relay.url} className="rounded-md border border-border/40 dark:border-white/[0.06] overflow-hidden bg-muted/20 dark:bg-white/[0.01]">
                            <div
                              className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted dark:hover:bg-white/[0.02] transition-colors"
                              onClick={() => handleExpand(relay.url)}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <Server className="w-3.5 h-3.5 text-brand/70 shrink-0" />
                                  <span className="text-xs font-mono font-medium truncate">{shortUrl}</span>
                                  {relay.operatorPubkey && <TrustTierDot pubkey={relay.operatorPubkey} />}
                                  {hasAuth && (
                                    <Badge variant="outline" className="text-[9px] h-4 px-1 border-brand/40 text-brand">
                                      <Lock className="w-2 h-2 mr-0.5" /> AUTH
                                    </Badge>
                                  )}
                                  {hasPayment && (
                                    <Badge variant="outline" className="text-[9px] h-4 px-1 border-amber-400/40 text-amber-600 dark:text-amber-300">
                                      <Zap className="w-2 h-2 mr-0.5" /> PAID
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                  {relay.software && (
                                    <span className="text-[10px] text-muted-foreground/50">
                                      {relay.software.split("/").pop() || relay.software}
                                    </span>
                                  )}
                                  {relay.supportedNips.length > 0 && (
                                    <span className="text-[10px] text-muted-foreground/40">
                                      · {relay.supportedNips.length} NIPs
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {isAdded ? (
                                  <Badge variant="outline" className="text-[10px] h-6 border-green-400/40 text-green-600 dark:text-green-400">
                                    <Check className="w-2.5 h-2.5 mr-0.5" /> Added
                                  </Badge>
                                ) : (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-[10px] text-brand hover:bg-accent"
                                        onClick={e => e.stopPropagation()}
                                      >
                                        <Plus className="w-2.5 h-2.5 mr-0.5" /> Add
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-48" onClick={e => e.stopPropagation()}>
                                      <DropdownMenuItem onClick={() => handleAddConnection(relay.url)} className="text-xs gap-2 cursor-pointer">
                                        <Wifi className="w-3 h-3 text-blue-700 dark:text-blue-400" />
                                        <div>
                                          <div className="font-medium">Connection</div>
                                          <div className="text-[10px] text-muted-foreground/60">Read & write relay</div>
                                        </div>
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => handleAddOutpost(relay.url)} className="text-xs gap-2 cursor-pointer">
                                        <Satellite className="w-3 h-3 text-brand" />
                                        <div>
                                          <div className="font-medium">My Community</div>
                                          <div className="text-[10px] text-muted-foreground/60">Relay I operate</div>
                                        </div>
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/40" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" />}
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="px-3 pb-3 border-t border-border/30 dark:border-white/[0.04] space-y-3 pt-2.5">
                                {relay.supportedNips.length > 0 && (
                                  <div>
                                    <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-1.5">Supported NIPs</p>
                                    <div className="flex flex-wrap gap-1">
                                      {relay.supportedNips.sort((a, b) => a - b).map(nip => (
                                        <Badge key={nip} variant="outline" className="text-[9px] h-5 px-1.5 font-mono border-border dark:border-white/[0.08]">
                                          {NIP_LABELS[nip] ? `${nip} ${NIP_LABELS[nip]}` : `NIP-${nip}`}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {relay.requirements.length > 0 && (
                                  <div>
                                    <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-1.5">Requirements</p>
                                    <div className="flex flex-wrap gap-1">
                                      {relay.requirements.map(req => (
                                        <Badge key={req} variant="outline" className="text-[9px] h-5 px-1.5 capitalize border-border dark:border-white/[0.08]">
                                          {req === "auth" && <Lock className="w-2 h-2 mr-0.5" />}
                                          {req === "payment" && <Zap className="w-2 h-2 mr-0.5" />}
                                          {req}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {relay.software && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">Software</span>
                                    <span className="text-[10px] text-muted-foreground/80 font-mono">{relay.software}</span>
                                  </div>
                                )}

                                {relay.nip11Loading && (
                                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
                                    <RelayOutpostInlineLoader className="w-3 h-3" /> Loading NIP-11 info...
                                  </div>
                                )}

                                {relay.nip11 && (
                                  <div className="space-y-2 pt-1 border-t border-border/30 dark:border-white/[0.04]">
                                    <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">NIP-11 Details</p>
                                    {relay.nip11.name && (
                                      <div className="flex items-center gap-2">
                                        <Info className="w-3 h-3 text-muted-foreground/40" />
                                        <span className="text-xs font-medium">{relay.nip11.name}</span>
                                      </div>
                                    )}
                                    {relay.nip11.description && (
                                      <p className="text-[10px] text-muted-foreground/70 leading-relaxed">{relay.nip11.description}</p>
                                    )}
                                    {relay.nip11.contact && (
                                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                                        <Mail className="w-2.5 h-2.5" />
                                        <span className="font-mono">{relay.nip11.contact}</span>
                                      </div>
                                    )}
                                    {relay.nip11.limitation?.auth_required && (
                                      <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-brand/30 text-brand">
                                        <Shield className="w-2 h-2 mr-0.5" /> Auth Required
                                      </Badge>
                                    )}
                                    {relay.nip11.limitation?.payment_required && (
                                      <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-amber-400/30 text-amber-500">
                                        <Zap className="w-2 h-2 mr-0.5" /> Payment Required
                                      </Badge>
                                    )}
                                    {relay.nip11.fees?.admission && relay.nip11.fees.admission.length > 0 && (
                                      <div className="text-[10px] text-muted-foreground/60">
                                        Admission: {relay.nip11.fees.admission.map(f => `${f.amount} ${f.unit}`).join(", ")}
                                      </div>
                                    )}
                                  </div>
                                )}

                                <div className="flex items-center gap-2 pt-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-[10px]"
                                    onClick={() => { navigator.clipboard.writeText(relay.url); toast({ title: "Copied", description: relay.url }); }}
                                  >
                                    <Copy className="w-2.5 h-2.5 mr-1" /> Copy URL
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-[10px]"
                                    onClick={() => navigate(`/console?relay=${encodeURIComponent(relay.url)}`)}
                                    data-testid={`button-query-console-${relay.url}`}
                                  >
                                    <Terminal className="w-2.5 h-2.5 mr-1" /> Query on console
                                  </Button>
                                  <a
                                    href={`https://${relay.url.replace("wss://", "").replace("ws://", "")}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                                  >
                                    <ExternalLink className="w-2.5 h-2.5" /> Open
                                  </a>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {filtered.length > 100 && (
                        <p className="text-center text-[10px] text-muted-foreground/40 py-2">
                          Showing 100 of {filtered.length} relays. Use filters to narrow results.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}

export default function RelayDashboard() {
  const { toast } = useToast();
  const { pubkey, signer } = useNostrAuth();
  useDocumentTitle("Relays");
  const [customRelays, setCustomRelays] = useState<string[]>(getCustomRelays());
  const [disabledRelays, setDisabledRelays] = useState<Set<string>>(getDisabledRelays());
  const [statuses, setStatuses] = useState<Map<string, RelayStatus>>(new Map());
  const [testingAll, setTestingAll] = useState(false);
  const mountedRef = useRef(true);
  const [outpostRelays, setOutpostRelays] = useState<OutpostRelay[]>(getOutpostRelays());
  const [showAddOutpost, setShowAddOutpost] = useState(false);
  const [outpostUrl, setOutpostUrl] = useState("");
  const [outpostLabel, setOutpostLabel] = useState("");
  const [outpostAccess, setOutpostAccess] = useState<"public" | "private">("public");
  const [editingOutpostIdx, setEditingOutpostIdx] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editAccess, setEditAccess] = useState<"public" | "private">("public");
  const [blockedRelaysList, setBlockedRelaysList] = useState<string[]>(getBlockedRelays());
  const [publishingBlockList, setPublishingBlockList] = useState(false);
  const [blockedSectionOpen, setBlockedSectionOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: "remove-outpost" | "remove-relay" | "block-relay";
    label: string;
    url: string;
    idx?: number;
  } | null>(null);
  const [operatorPubkeys, setOperatorPubkeys] = useState<Map<string, string>>(new Map());
  const { requestScoresBulk } = useGrapeRankScores();

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const relayUrlsKey = useMemo(() => {
    const allUrls = [
      ...outpostRelays.map(r => r.url),
      ...DEFAULT_RELAYS,
      ...customRelays.filter(r => !DEFAULT_RELAYS.includes(r)),
    ];
    return allUrls.sort().join(",");
  }, [outpostRelays, customRelays]);

  useEffect(() => {
    const allUrls = relayUrlsKey.split(",").filter(Boolean);
    if (allUrls.length === 0) return;

    let cancelled = false;
    const fetchOperators = async () => {
      const collected = new Map<string, string>();
      const batchSize = 5;
      const toFetch = allUrls;
      for (let i = 0; i < toFetch.length; i += batchSize) {
        const batch = toFetch.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(url => fetchNip11(url))
        );
        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          if (result.status === "fulfilled" && result.value?.pubkey) {
            collected.set(batch[j], result.value.pubkey);
          }
        }
        if (cancelled || !mountedRef.current) return;
      }
      if (collected.size > 0 && mountedRef.current && !cancelled) {
        setOperatorPubkeys(prev => {
          const next = new Map(prev);
          collected.forEach((v, k) => next.set(k, v));
          return next;
        });
        requestScoresBulk([...new Set(collected.values())]);
      }
    };

    const timer = setTimeout(fetchOperators, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [relayUrlsKey, requestScoresBulk]);

  const allRelaysUnfiltered = [...DEFAULT_RELAYS, ...customRelays.filter(r => !DEFAULT_RELAYS.includes(r))];
  const allRelays = allRelaysUnfiltered.filter(r => !blockedRelaysList.includes(r));

  const testSingleRelay = useCallback(async (url: string, isDefault: boolean) => {
    const enabled = !disabledRelays.has(url);
    if (!enabled) {
      setStatuses(prev => {
        const next = new Map(prev);
        next.set(url, { url, connected: false, latency: null, error: "Disabled", testing: false, isDefault, enabled: false });
        return next;
      });
      return;
    }

    setStatuses(prev => {
      const next = new Map(prev);
      next.set(url, { url, connected: false, latency: null, error: null, testing: true, isDefault, enabled: true });
      return next;
    });

    const result = await testRelay(url);

    if (mountedRef.current) {
      setStatuses(prev => {
        const next = new Map(prev);
        next.set(url, { url, ...result, testing: false, isDefault, enabled: true });
        return next;
      });
    }
  }, [disabledRelays]);

  const testAllRelays = useCallback(async () => {
    setTestingAll(true);
    const promises = [
      ...allRelays.map(url => testSingleRelay(url, DEFAULT_RELAYS.includes(url))),
      ...outpostRelays.map(r => testSingleRelay(r.url, false)),
    ];
    await Promise.allSettled(promises);
    if (mountedRef.current) setTestingAll(false);
  }, [allRelays, outpostRelays, testSingleRelay]);

  useEffect(() => {
    testAllRelays();
  }, []);

  useEffect(() => {
    if (pubkey) {
      fetchBlockedRelayList(pubkey).then((fetched) => {
        if (mountedRef.current) {
          setBlockedRelaysList(getBlockedRelays());
        }
      });
    }
  }, [pubkey]);

  const handleBlockRelay = useCallback((url: string) => {
    blockRelay(url);
    setBlockedRelaysList(getBlockedRelays());
    disconnectRelay(url);
    setStatuses(prev => {
      const next = new Map(prev);
      next.delete(url);
      return next;
    });
    toast({ title: "Relay blocked", description: `${url} will be excluded from all connections.` });
  }, [toast]);

  const handleUnblockRelay = useCallback((url: string) => {
    unblockRelay(url);
    setBlockedRelaysList(getBlockedRelays());
    toast({ title: "Relay unblocked", description: `${url} is available for connections again.` });
  }, [toast]);

  const handlePublishBlockList = useCallback(async () => {
    if (!pubkey) {
      toast({ title: "Not logged in", description: "Log in to publish your blocked relay list.", variant: "destructive" });
      return;
    }
    setPublishingBlockList(true);
    const success = await publishBlockedRelayList(blockedRelaysList);
    setPublishingBlockList(false);
    if (success) {
      toast({ title: "Block list published", description: "Your blocked relay list has been saved." });
    } else {
      toast({ title: "Failed to publish", description: "Could not publish blocked relay list.", variant: "destructive" });
    }
  }, [pubkey, blockedRelaysList, toast]);

  const removeRelay = (url: string) => {
    disconnectRelay(url);
    const updated = customRelays.filter(r => r !== url);
    setCustomRelays(updated);
    saveCustomRelays(updated);
    const newDisabled = new Set(disabledRelays);
    newDisabled.delete(url);
    setDisabledRelays(newDisabled);
    saveDisabledRelays(newDisabled);
    setStatuses(prev => {
      const next = new Map(prev);
      next.delete(url);
      return next;
    });
  };

  const toggleRelay = useCallback((url: string) => {
    const isDefault = DEFAULT_RELAYS.includes(url);
    const isCurrentlyDisabled = disabledRelays.has(url);

    if (isCurrentlyDisabled) {
      const newDisabled = new Set(disabledRelays);
      newDisabled.delete(url);
      setDisabledRelays(newDisabled);
      saveDisabledRelays(newDisabled);
      connectRelay(url);
      setStatuses(prev => {
        const next = new Map(prev);
        next.set(url, { url, connected: false, latency: null, error: null, testing: true, isDefault, enabled: true });
        return next;
      });
      testRelay(url).then(result => {
        if (mountedRef.current) {
          setStatuses(prev => {
            const next = new Map(prev);
            next.set(url, { url, ...result, testing: false, isDefault, enabled: true });
            return next;
          });
        }
      });
    } else {
      const newDisabled = new Set(disabledRelays);
      newDisabled.add(url);
      setDisabledRelays(newDisabled);
      saveDisabledRelays(newDisabled);
      disconnectRelay(url);
      setStatuses(prev => {
        const next = new Map(prev);
        next.set(url, { url, connected: false, latency: null, error: "Disabled", testing: false, isDefault, enabled: false });
        return next;
      });
      const adminIdx = outpostRelays.findIndex(r => r.url === url && r.isAdmin);
      if (adminIdx !== -1) {
        setOutpostRelays(prev => {
          const updated = prev.map((r, i) => i === adminIdx ? { ...r, isAdmin: false } : r);
          saveOutpostRelays(updated);
          return updated;
        });
      }
    }
  }, [disabledRelays, outpostRelays, toast]);

  const handleDiscoverAddConnection = useCallback((url: string) => {
    if (allRelays.includes(url)) {
      toast({ title: "Already added", description: url.replace("wss://", "") });
      return;
    }
    const updated = [...customRelays, url];
    setCustomRelays(updated);
    saveCustomRelays(updated);
    pool.ensureRelay(url).catch(() => {});
    testSingleRelay(url, false);
    toast({ title: "Relay added", description: url.replace("wss://", "") });
  }, [customRelays, allRelays, testSingleRelay, toast]);

  const handleDiscoverAddOutpost = useCallback((url: string) => {
    if (outpostRelays.some(r => r.url.replace(/\/+$/, "").toLowerCase() === url)) {
      toast({ title: "Already in My Community", description: url.replace("wss://", "") });
      return;
    }
    setOutpostUrl(url.replace(/^wss?:\/\//i, ""));
    setOutpostLabel(url.replace("wss://", "").replace("ws://", "").split(".")[0]);
    setOutpostAccess("public");
    setShowAddOutpost(true);
    toast({ title: "Fill in community details", description: "Set a label and access level for this relay." });
  }, [outpostRelays, toast]);

  const addOutpostRelay = () => {
    let url = outpostUrl.trim();
    if (!url || !outpostLabel.trim()) {
      toast({ title: "Fill in both fields", description: "Enter a relay URL and a label.", variant: "destructive" });
      return;
    }
    url = url.replace(/^wss?:\/\//i, "");
    url = "wss://" + url;
    if (outpostRelays.some(r => r.url === url)) {
      return;
    }
    const newRelay: OutpostRelay = { url, label: outpostLabel.trim(), access: outpostAccess };
    const updated = [...outpostRelays, newRelay];
    setOutpostRelays(updated);
    saveOutpostRelays(updated);
    setOutpostUrl("");
    setOutpostLabel("");
    setOutpostAccess("public");
    setShowAddOutpost(false);
    testSingleRelay(url, false);
  };

  const removeOutpostRelay = (idx: number) => {
    const relay = outpostRelays[idx];
    disconnectRelay(relay.url);
    const updated = outpostRelays.filter((_, i) => i !== idx);
    setOutpostRelays(updated);
    saveOutpostRelays(updated);
    setStatuses(prev => { const next = new Map(prev); next.delete(relay.url); return next; });
  };

  const saveOutpostEdit = (idx: number) => {
    if (!editLabel.trim()) return;
    let normalizedUrl = editUrl.trim();
    if (normalizedUrl && !normalizedUrl.startsWith("wss://") && !normalizedUrl.startsWith("ws://")) {
      normalizedUrl = "wss://" + normalizedUrl;
    }
    if (!normalizedUrl) return;
    const oldUrl = outpostRelays[idx].url;
    const updated = outpostRelays.map((r, i) => i === idx ? { ...r, url: normalizedUrl, label: editLabel.trim(), access: editAccess } : r);
    setOutpostRelays(updated);
    saveOutpostRelays(updated);
    if (normalizedUrl !== oldUrl) {
      setStatuses(prev => { const next = new Map(prev); next.delete(oldUrl); return next; });
    }
    setEditingOutpostIdx(null);
  };

  const [verifyingAdminIdx, setVerifyingAdminIdx] = useState<number | null>(null);

  const toggleAdminRelay = useCallback(async (idx: number) => {
    const relay = outpostRelays[idx];

    if (relay.isAdmin) {
      setOutpostRelays(prev => {
        const updated = prev.map((r, i) => i === idx ? { ...r, isAdmin: false } : r);
        saveOutpostRelays(updated);
        return updated;
      });
      toast({
        title: "Admin mode disabled",
        description: `${relay.label} admin mode disabled.`,
      });
      return;
    }

    if (!pubkey) {
      toast({ title: "Not signed in", description: "Sign in to enable admin mode.", variant: "destructive" });
      return;
    }

    if (verifyingAdminIdx !== null) return;
    setVerifyingAdminIdx(idx);
    try {
      const nip11 = await fetchNip11(relay.url);

      if (!nip11) {
        toast({
          title: "Cannot verify",
          description: "Unable to reach this relay. Check the URL and try again.",
          variant: "destructive",
        });
        return;
      }

      if (nip11.pubkey) {
        if (nip11.pubkey !== pubkey) {
          toast({
            title: "Not authorized",
            description: "Your key does not match this relay's operator pubkey. Only the relay operator can enable admin mode.",
            variant: "destructive",
          });
          return;
        }
      } else {
        toast({
          title: "Operator pubkey not set",
          description: "This relay doesn't publish an operator pubkey. Admin mode enabled, but some features may not work if you aren't the actual operator.",
        });
      }

      setOutpostRelays(prev => {
        const updated = prev.map((r, i) => i === idx ? { ...r, isAdmin: true } : r);
        saveOutpostRelays(updated);
        return updated;
      });
      toast({
        title: "Admin mode enabled",
        description: `${relay.label} verified — Relay Control is now active.`,
      });
    } catch {
      toast({
        title: "Verification failed",
        description: "Could not verify admin status. Try again later.",
        variant: "destructive",
      });
    } finally {
      setVerifyingAdminIdx(null);
    }
  }, [outpostRelays, pubkey, verifyingAdminIdx, toast]);

  const [healthMonitorOpen, setHealthMonitorOpen] = useState(false);

  // NIP-65 routing (read-only) — where this user's posts are published / received.
  const [relayRoutes, setRelayRoutes] = useState<{ url: string; mode: "read" | "write" | "both" }[]>([]);
  const [routesLoaded, setRoutesLoaded] = useState(false);
  useEffect(() => {
    if (!pubkey) { setRoutesLoaded(true); return; }
    setRoutesLoaded(false);
    const sub = throttledPoolSubscribe(
      ["wss://purplepag.es", ...DEFAULT_RELAYS.slice(0, 3)],
      { kinds: [10002], authors: [pubkey] },
      {
        onevent(event: NostrEvent) {
          eventStore.add(event);
          setRelayRoutes(
            event.tags
              .filter((t) => t[0] === "r" && t[1])
              .map((t) => ({ url: t[1], mode: (t[2] === "read" ? "read" : t[2] === "write" ? "write" : "both") as "read" | "write" | "both" })),
          );
        },
        oneose() { sub.close(); setRoutesLoaded(true); },
      },
    );
    return () => { sub.close(); };
  }, [pubkey]);
  const readRoutes = relayRoutes.filter((r) => r.mode === "read" || r.mode === "both");
  const writeRoutes = relayRoutes.filter((r) => r.mode === "write" || r.mode === "both");

  // Editable NIP-65 routing. High-consequence (a wrong list silently hurts reach),
  // so: only editable once the current list has loaded, never publishes an empty
  // list, and signs with the active session signer (not window.nostr).
  const [editingRoutes, setEditingRoutes] = useState(false);
  const [editRoutes, setEditRoutes] = useState<{ url: string; read: boolean; write: boolean }[]>([]);
  const [newInbox, setNewInbox] = useState("");
  const [newOutbox, setNewOutbox] = useState("");
  const [publishingRoutes, setPublishingRoutes] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);

  const beginEditRoutes = () => {
    setEditRoutes(relayRoutes.map((r) => ({ url: r.url, read: r.mode !== "write", write: r.mode !== "read" })));
    setNewInbox("");
    setNewOutbox("");
    setEditingRoutes(true);
  };
  const addRoute = (raw: string, role: "read" | "write") => {
    const url = normalizeRouteUrl(raw);
    if (!url) return;
    setEditRoutes((prev) => {
      const i = prev.findIndex((r) => r.url.replace(/\/+$/, "").toLowerCase() === url.toLowerCase());
      if (i >= 0) return prev.map((r, j) => (j === i ? { ...r, [role]: true } : r));
      return [...prev, { url, read: role === "read", write: role === "write" }];
    });
  };
  const removeRoute = (url: string, role: "read" | "write") => {
    setEditRoutes((prev) => prev.map((r) => (r.url === url ? { ...r, [role]: false } : r)).filter((r) => r.read || r.write));
  };
  const publishRoutes = async () => {
    if (!signer) { toast({ title: "Sign in required", variant: "destructive" }); return; }
    const active = editRoutes.filter((r) => r.read || r.write);
    if (active.length === 0) {
      toast({ title: "Add at least one relay", description: "Your routing can't be empty — that would hide your posts.", variant: "destructive" });
      return;
    }
    const tags = buildRelayListTags(editRoutes);
    if (tags.length === 0) {
      toast({ title: "Add at least one relay", description: "Your routing can't be empty — that would hide your posts.", variant: "destructive" });
      return;
    }
    setPublishingRoutes(true);
    try {
      const template = { kind: 10002, created_at: Math.floor(Date.now() / 1000), tags, content: "" };
      const signed = await signWithTimeout(signer, template as Parameters<typeof signWithTimeout>[1]);
      // Same signer-mangling guard the kind-3 follow paths use: never publish if
      // the signer returned a different kind (would corrupt the user's routing).
      if (!verifySignedEventKind(signed, 10002)) {
        toast({ title: "Signer error", description: "Your signer modified the event — routing was not updated.", variant: "destructive" });
        return;
      }
      const targets = Array.from(new Set(["wss://purplepag.es", ...DEFAULT_RELAYS, ...active.filter((r) => r.write).map((r) => r.url.replace(/\/+$/, ""))]));
      await publishEvent(signed, targets);
      setRelayRoutes(active.map((r) => ({ url: r.url.replace(/\/+$/, ""), mode: r.read && r.write ? "both" : r.read ? "read" : "write" })));
      setEditingRoutes(false);
      toast({ title: "Routing published", description: `${active.filter((r) => r.read).length} inbox · ${active.filter((r) => r.write).length} outbox` });
    } catch {
      toast({ title: "Couldn't publish routing", description: "Nothing was changed. Try again.", variant: "destructive" });
    } finally {
      setPublishingRoutes(false);
    }
  };

  const [manageOpen, setManageOpen] = useState(false);
  const [findRelaysOpen, setFindRelaysOpen] = useState(false);

  const enabledOutpostCount = outpostRelays.filter(r => !disabledRelays.has(r.url)).length;
  const enabledDefaultCount = allRelays.filter(r => !disabledRelays.has(r)).length;
  const enabledCount = enabledOutpostCount + enabledDefaultCount;
  const connectedCount = Array.from(statuses.values()).filter(s => s.connected).length;

  return (
    <div className="max-w-2xl mx-auto px-2 sm:px-4 py-4">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-foreground" data-testid="text-relay-title">Relays</h1>
          <Badge variant="secondary" className="text-[11px]" data-testid="badge-relay-status">
            {connectedCount} of {enabledCount} connected
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={testAllRelays}
          disabled={testingAll}
          data-testid="button-test-all-relays"
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${testingAll ? "animate-spin" : ""}`} />
          Check all
        </Button>
      </div>

      {pubkey && (
        <Card className="glass-card border-border/40 p-4 mb-5" data-testid="section-relay-routes">
          <div className="flex items-center gap-2 mb-1">
            <Mail className="w-4 h-4 text-brand/70" />
            <h2 className="text-sm font-brand tracking-wider uppercase">Where your posts go</h2>
            {routesLoaded && !editingRoutes && (
              <Button variant="ghost" size="sm" className="ml-auto h-7 text-[11px]" onClick={beginEditRoutes} data-testid="button-edit-routes">
                <Pencil className="w-3 h-3 mr-1" />Edit
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground/70 mb-3">Your published routing (NIP-65) — where other clients fetch your posts and reach you.</p>
          {!routesLoaded ? (
            <RelayOutpostInlineLoader />
          ) : editingRoutes ? (
            <div className="space-y-3">
              <div className="flex items-start gap-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 p-2 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300/90">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>This is advanced. Your routing tells the whole network where to find and reach you — a wrong list can quietly stop people seeing your posts. Only change it if you know what you're doing.</span>
              </div>
              {([["read", "Inbox", "Where people reach you", newInbox, setNewInbox], ["write", "Outbox", "Where you broadcast from", newOutbox, setNewOutbox]] as const).map(([role, label, hint, val, setVal]) => (
                <div key={role}>
                  <div className="flex items-center gap-1.5 mb-1">
                    {role === "read" ? <Satellite className="w-3.5 h-3.5 text-brand" /> : <Signal className="w-3.5 h-3.5 text-brand" />}
                    <span className="text-xs uppercase tracking-wider font-medium text-foreground/70">{label}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 mb-1.5">{hint}.</p>
                  {editRoutes.filter((r) => r[role]).map((r) => (
                    <div key={`${role}-${r.url}`} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/20 border border-border/40 mb-1">
                      <span className="font-mono text-[11px] truncate flex-1">{r.url.replace("wss://", "")}</span>
                      <button onClick={() => removeRoute(r.url, role)} className="text-muted-foreground/50 hover:text-red-500 shrink-0" title={`Remove from ${label.toLowerCase()}`} data-testid={`button-remove-route-${role}-${r.url}`}>
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-1.5 mt-1">
                    <Input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { addRoute(val, role); setVal(""); } }} placeholder="relay.example.com" className="h-7 text-xs font-mono" inputMode="url" autoCapitalize="off" autoCorrect="off" data-testid={`input-add-route-${role}`} />
                    <Button size="sm" variant="outline" className="h-7 text-[11px] shrink-0" onClick={() => { addRoute(val, role); setVal(""); }}>Add</Button>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setEditingRoutes(false)} data-testid="button-cancel-routes">Cancel</Button>
                <Button size="sm" className="h-8 text-xs" disabled={publishingRoutes} onClick={() => { if (buildRelayListTags(editRoutes).length === 0) { toast({ title: "Add at least one relay", description: "Your routing can't be empty — that would hide your posts.", variant: "destructive" }); return; } setShowPublishConfirm(true); }} data-testid="button-publish-routes">
                  <Upload className={`w-3 h-3 mr-1 ${publishingRoutes ? "animate-pulse" : ""}`} />
                  {publishingRoutes ? "Publishing..." : "Publish changes"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <Satellite className="w-3.5 h-3.5 text-brand" />
                  <span className="text-xs uppercase tracking-wider font-medium text-foreground/70">Inbox</span>
                  <Badge variant="secondary" className="text-[10px] ml-auto">{readRoutes.length}</Badge>
                </div>
                <p className="text-[10px] text-muted-foreground/60 mb-1.5">Where people reach you.</p>
                {readRoutes.length > 0 ? readRoutes.map((r) => (
                  <div key={`in-${r.url}`} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/20 border border-border/40 mb-1" data-testid={`route-read-${r.url}`}>
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                    <span className="font-mono text-[11px] truncate">{r.url.replace("wss://", "")}</span>
                  </div>
                )) : <div className="px-2.5 py-1.5 rounded-md border border-dashed border-border/40 text-[10px] text-muted-foreground/60">None declared.</div>}
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <Signal className="w-3.5 h-3.5 text-brand" />
                  <span className="text-xs uppercase tracking-wider font-medium text-foreground/70">Outbox</span>
                  <Badge variant="secondary" className="text-[10px] ml-auto">{writeRoutes.length}</Badge>
                </div>
                <p className="text-[10px] text-muted-foreground/60 mb-1.5">Where you broadcast from.</p>
                {writeRoutes.length > 0 ? writeRoutes.map((r) => (
                  <div key={`out-${r.url}`} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/20 border border-border/40 mb-1" data-testid={`route-write-${r.url}`}>
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                    <span className="font-mono text-[11px] truncate">{r.url.replace("wss://", "")}</span>
                  </div>
                )) : <div className="px-2.5 py-1.5 rounded-md border border-dashed border-border/40 text-[10px] text-muted-foreground/60">None declared.</div>}
              </div>
            </div>
          )}
        </Card>
      )}

      <Collapsible open={manageOpen} onOpenChange={setManageOpen} className="mb-5">
        <Card className="glass-card overflow-hidden" data-testid="section-manage-relays">
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between gap-2 p-4 text-left" data-testid="button-toggle-manage-relays">
              <div className="flex items-center gap-2">
                <Satellite className="w-4 h-4 text-brand/70" />
                <h2 className="text-sm font-brand tracking-wider uppercase">Manage relays</h2>
                <Badge variant="outline" className="text-[10px]">{outpostRelays.length + allRelays.filter(u => !outpostRelays.some(o => o.url.replace(/\/+$/, "") === u.replace(/\/+$/, ""))).length}</Badge>
              </div>
              {manageOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-4 border-t border-border/20 pt-3">

          {pubkey && (
          <div className="flex items-center justify-end mb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAddOutpost(!showAddOutpost)}
              data-testid="button-add-outpost-relay"
            >
              {showAddOutpost ? <X className="w-3.5 h-3.5 mr-1" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
              {showAddOutpost ? "Cancel" : "Add a relay"}
            </Button>
          </div>
          )}

          {showAddOutpost && (
            <div className="p-3 mb-3 rounded-md bg-muted/40 dark:bg-white/[0.02] border border-border dark:border-white/[0.06] space-y-2" data-testid="form-add-outpost">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground/70 font-mono pointer-events-none select-none">wss://</span>
                  <Input
                    placeholder="my-relay.example.com"
                    value={outpostUrl}
                    onChange={(e) => setOutpostUrl(e.target.value)}
                    className="bg-background dark:bg-white/[0.03] border-border dark:border-white/10 pl-[3.25rem] text-sm"
                    inputMode="url"
                    enterKeyHint="done"
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    data-testid="input-outpost-url"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Label (e.g. My Private Relay)"
                  value={outpostLabel}
                  onChange={(e) => setOutpostLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addOutpostRelay()}
                  className="bg-background dark:bg-white/[0.03] border-border dark:border-white/10 text-sm flex-1"
                  enterKeyHint="done"
                  autoCorrect="off"
                  data-testid="input-outpost-label"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className={`gap-1 text-xs ${outpostAccess === "private" ? "text-amber-600 dark:text-amber-400/80" : "text-green-600 dark:text-green-400/80"}`}
                  onClick={() => setOutpostAccess(outpostAccess === "public" ? "private" : "public")}
                  data-testid="button-outpost-access-toggle"
                >
                  {outpostAccess === "private" ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  {outpostAccess === "private" ? "Private" : "Public"}
                </Button>
                <Button size="sm" onClick={addOutpostRelay} data-testid="button-save-outpost">
                  Add
                </Button>
              </div>
            </div>
          )}

          {pubkey && outpostRelays.length > 0 && (
            <div className="space-y-1.5">
              {outpostRelays.map((relay, idx) => {
                const status = statuses.get(relay.url);
                const isEditing = editingOutpostIdx === idx;
                const isDisabled = disabledRelays.has(relay.url);

                return (
                  <div key={relay.url} className={`p-2.5 rounded-md transition-opacity ${isDisabled ? "opacity-50" : ""} ${relay.isAdmin ? "bg-cyan-50 dark:bg-cyan-950/10 border border-cyan-300 dark:border-cyan-400/20" : "bg-muted/40 dark:bg-white/[0.02] border border-border dark:border-white/[0.06]"}`} data-testid={`outpost-relay-${idx}`}>
                    <div className="flex items-center gap-3">
                      <div className="shrink-0">
                        {isDisabled ? (
                          <PowerOff className="w-4 h-4 text-muted-foreground/60" />
                        ) : status?.testing ? (
                          <RelayOutpostInlineLoader className="w-4 h-4" />
                        ) : status?.connected ? (
                          <Wifi className="w-4 h-4 text-green-800/80 dark:text-green-400/80" />
                        ) : (
                          <WifiOff className="w-4 h-4 text-red-700/60 dark:text-red-400/60" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5">
                              <Input
                                value={editLabel}
                                onChange={(e) => setEditLabel(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && saveOutpostEdit(idx)}
                                placeholder="Label"
                                className="h-7 text-xs bg-background dark:bg-white/[0.03] border-border dark:border-white/10"
                                autoFocus
                                enterKeyHint="done"
                                autoCorrect="off"
                                data-testid={`input-edit-outpost-${idx}`}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                className={`gap-1 text-[11px] shrink-0 ${editAccess === "private" ? "text-amber-600 dark:text-amber-400/80" : "text-green-600 dark:text-green-400/80"}`}
                                onClick={() => setEditAccess(editAccess === "public" ? "private" : "public")}
                              >
                                {editAccess === "private" ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                              </Button>
                            </div>
                            <div className="relative">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/50 font-mono pointer-events-none select-none">wss://</span>
                              <Input
                                value={editUrl}
                                onChange={(e) => setEditUrl(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && saveOutpostEdit(idx)}
                                placeholder="relay.example.com"
                                className="h-7 text-xs bg-background dark:bg-white/[0.03] border-border dark:border-white/10 pl-[3rem] font-mono"
                                enterKeyHint="done"
                                autoCapitalize="off"
                                autoCorrect="off"
                                autoComplete="off"
                                inputMode="url"
                                data-testid={`input-edit-url-${idx}`}
                              />
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-medium truncate">{relay.label}</span>
                              {operatorPubkeys.get(relay.url) && <TrustTierDot pubkey={operatorPubkeys.get(relay.url)!} />}
                              <Badge
                                variant="outline"
                                className={`text-[10px] ${relay.access === "private" ? "border-amber-300 dark:border-amber-400/20 text-amber-600 dark:text-amber-400/60" : "border-green-300 dark:border-green-400/20 text-green-600 dark:text-green-400/60"}`}
                              >
                                {relay.access === "private" ? <Lock className="w-2.5 h-2.5 mr-0.5" /> : <Unlock className="w-2.5 h-2.5 mr-0.5" />}
                                {relay.access}
                              </Badge>
                              {relay.isAdmin && (
                                <Badge variant="outline" className="text-[10px] border-cyan-300 dark:border-cyan-400/20 text-cyan-600 dark:text-cyan-400/60">
                                  <RelayOutpostIcon className="w-2.5 h-2.5 mr-0.5" />
                                  Relay Op
                                </Badge>
                              )}
                              {isDisabled && (
                                <Badge variant="outline" className="text-[10px] border-red-400/20 text-red-700/60 dark:text-red-400/60">Disabled</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[11px] font-mono text-muted-foreground/60 truncate">{relay.url.replace("wss://", "")}</span>
                              {status?.connected && status.latency !== null && (
                                <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground/70">
                                  <Gauge className="w-2.5 h-2.5" />
                                  {status.latency}ms
                                </span>
                              )}
                              {status?.error && (
                                <span className="text-[11px] text-red-700/60 dark:text-red-400/60">{status.error}</span>
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      <div className="flex items-center shrink-0">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => saveOutpostEdit(idx)} data-testid={`button-save-edit-${idx}`}>
                              <Check className="w-3.5 h-3.5 text-green-800/80 dark:text-green-400/80" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setEditingOutpostIdx(null)} data-testid={`button-cancel-edit-${idx}`}>
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center">
                            {!isDisabled && (
                              <div className="flex items-center gap-0.5">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => { setEditingOutpostIdx(idx); setEditLabel(relay.label); setEditUrl(relay.url.replace(/^wss?:\/\//, "")); setEditAccess(relay.access); }}
                                  title="Edit relay"
                                  data-testid={`button-edit-outpost-${idx}`}
                                >
                                  <Pencil className="w-3 h-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => testSingleRelay(relay.url, false)}
                                  disabled={status?.testing}
                                  title="Test connection"
                                  data-testid={`button-test-outpost-${idx}`}
                                >
                                  <RefreshCw className={`w-3 h-3 ${status?.testing ? "animate-spin" : ""}`} />
                                </Button>
                                <button
                                  onClick={() => toggleAdminRelay(idx)}
                                  disabled={verifyingAdminIdx === idx}
                                  className={`relative inline-flex items-center h-5 w-9 rounded-full transition-colors duration-200 shrink-0 ${
                                    relay.isAdmin
                                      ? "bg-cyan-500/20 border border-cyan-400/30"
                                      : "bg-muted/60 dark:bg-white/[0.06] border border-border/50 dark:border-white/[0.08]"
                                  } ${verifyingAdminIdx === idx ? "opacity-60" : ""}`}
                                  title={relay.isAdmin ? "Disable admin mode" : "Enable admin mode (I am the operator)"}
                                  data-testid={`button-admin-outpost-${idx}`}
                                >
                                  <span className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full transition-all duration-200 ${
                                    relay.isAdmin
                                      ? "translate-x-[18px] bg-cyan-500 dark:bg-cyan-400 text-white dark:text-cyan-950"
                                      : "translate-x-[3px] bg-muted-foreground/30 text-muted-foreground/50"
                                  }`}>
                                    {verifyingAdminIdx === idx ? (
                                      <RelayOutpostInlineLoader className="w-2 h-2" />
                                    ) : (
                                      <RelayOutpostIcon className="w-2 h-2" />
                                    )}
                                  </span>
                                </button>
                              </div>
                            )}
                            <div className={`flex items-center gap-0.5 ${!isDisabled ? "ml-1 pl-1 border-l border-border/40 dark:border-white/[0.06]" : ""}`}>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => toggleRelay(relay.url)}
                                className={isDisabled ? "text-green-800/60 dark:text-green-400/60" : "text-muted-foreground/40"}
                                title={isDisabled ? "Enable relay" : "Disable relay"}
                                data-testid={`button-toggle-outpost-${idx}`}
                              >
                                {isDisabled ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setConfirmAction({ type: "remove-outpost", label: relay.label, url: relay.url, idx })}
                                className="text-muted-foreground/40 hover:text-red-700/80 dark:hover:text-red-400/80"
                                title="Remove relay"
                                data-testid={`button-remove-outpost-${idx}`}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {relay.isAdmin && !isDisabled && (
                      <div className="mt-2 rounded-md bg-accent dark:bg-brand/10 border border-brand/20 p-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <RelayOutpostIcon className="w-3.5 h-3.5 text-brand dark:text-brand/70" />
                          <span className="text-[11px] text-brand dark:text-brand/80">Admin tools available</span>
                        </div>
                        <Link
                          href="/relays/admin"
                          className="text-[11px] text-brand hover:text-brand/80 dark:hover:text-brand flex items-center gap-1 font-medium"
                        >
                          Open Relay Control
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

      <div className="mt-3 mb-1 text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Relays this app uses</div>
      <div className="space-y-2">
        {[...allRelays].filter(u => !outpostRelays.some(o => o.url.replace(/\/+$/, "") === u.replace(/\/+$/, ""))).sort((a, b) => {
          const aDisabled = disabledRelays.has(a) ? 1 : 0;
          const bDisabled = disabledRelays.has(b) ? 1 : 0;
          return aDisabled - bDisabled;
        }).map(url => {
          const status = statuses.get(url);
          const isDefault = DEFAULT_RELAYS.includes(url);
          const isDisabled = disabledRelays.has(url);

          return (
            <Card key={url} className={`glass-card p-3 transition-opacity ${isDisabled ? "opacity-50" : ""}`} data-testid={`relay-card-${url}`}>
              <div className="flex items-center gap-3">
                <div className="shrink-0">
                  {isDisabled ? (
                    <PowerOff className="w-4 h-4 text-muted-foreground/60" />
                  ) : status?.testing ? (
                    <RelayOutpostInlineLoader className="w-4 h-4" />
                  ) : status?.connected ? (
                    <Wifi className="w-4 h-4 text-green-800/80 dark:text-green-400/80" />
                  ) : (
                    <WifiOff className="w-4 h-4 text-red-700/60 dark:text-red-400/60" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-sm font-mono truncate ${isDisabled ? "line-through text-muted-foreground/60" : ""}`} data-testid={`text-relay-url-${url}`}>
                      {url.replace("wss://", "")}
                    </span>
                    {operatorPubkeys.get(url) && <TrustTierDot pubkey={operatorPubkeys.get(url)!} />}
                    {isDefault && (
                      <Badge variant="outline" className="text-[11px] border-brand/20 text-brand/60">Default</Badge>
                    )}
                    {isDisabled && (
                      <Badge variant="outline" className="text-[11px] border-red-400/20 text-red-700/60 dark:text-red-400/60">Disabled</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {!isDisabled && status?.connected && status.latency !== null && (
                      <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground/70" data-testid={`text-relay-latency-${url}`}>
                        <Gauge className="w-2.5 h-2.5" />
                        {status.latency}ms
                      </span>
                    )}
                    {!isDisabled && status?.error && (
                      <span className="text-[11px] text-red-700/60 dark:text-red-400/60" data-testid={`text-relay-error-${url}`}>
                        {status.error}
                      </span>
                    )}
                    {!isDisabled && status?.testing && (
                      <span className="text-[11px] text-muted-foreground/60">Testing...</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center shrink-0">
                  {!isDisabled && (
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => testSingleRelay(url, isDefault)}
                        disabled={status?.testing}
                        title="Test connection"
                        data-testid={`button-test-relay-${url}`}
                      >
                        <RefreshCw className={`w-3 h-3 ${status?.testing ? "animate-spin" : ""}`} />
                      </Button>
                    </div>
                  )}
                  <div className={`flex items-center gap-0.5 ${!isDisabled ? "ml-1 pl-1 border-l border-border/40 dark:border-white/[0.06]" : ""}`}>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleRelay(url)}
                      className={isDisabled ? "text-green-800/60 dark:text-green-400/60" : "text-muted-foreground/40"}
                      title={isDisabled ? "Enable relay" : "Disable relay"}
                      data-testid={`button-toggle-relay-${url}`}
                    >
                      {isDisabled ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setConfirmAction({ type: "block-relay", label: url, url })}
                      className="text-muted-foreground/40 hover:text-amber-800/80 dark:hover:text-amber-400/80"
                      title="Block relay"
                      data-testid={`button-block-relay-${url}`}
                    >
                      <ShieldBan className="w-3 h-3" />
                    </Button>
                    {!isDefault && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setConfirmAction({ type: "remove-relay", label: url, url })}
                        className="text-muted-foreground/40 hover:text-red-700/80 dark:hover:text-red-400/80"
                        title="Remove relay"
                        data-testid={`button-remove-relay-${url}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground/60">
        <Globe className="w-3 h-3" />
        <span data-testid="text-relay-summary">{enabledCount} active of {outpostRelays.length + allRelays.length} relays</span>
      </div>
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Collapsible open={findRelaysOpen} onOpenChange={setFindRelaysOpen} className="mb-4">
        <Card className="glass-card overflow-hidden">
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between gap-2 p-4 text-left" data-testid="button-toggle-find-relays">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-brand/70" />
                <h2 className="text-sm font-brand tracking-wider uppercase">Find more relays</h2>
              </div>
              {findRelaysOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-4 border-t border-border/20 pt-3">
              <DiscoverRelaysSection
                customRelays={customRelays}
                outpostRelays={outpostRelays}
                onAddConnection={handleDiscoverAddConnection}
                onAddOutpost={handleDiscoverAddOutpost}
              />
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {blockedRelaysList.length > 0 && (
        <div className="mt-6">
          <Collapsible open={blockedSectionOpen} onOpenChange={setBlockedSectionOpen}>
            <Card className="glass-card overflow-hidden" data-testid="section-blocked-relays">
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between gap-2 p-4 text-left" data-testid="button-toggle-blocked-relays">
                  <div className="flex items-center gap-2 flex-wrap">
                    <ShieldBan className="w-4 h-4 text-amber-800/80 dark:text-amber-400/80" />
                    <h2 className="text-sm font-brand tracking-wider uppercase text-amber-800/90 dark:text-amber-300/90">Blocked Relays</h2>
                    <Badge variant="outline" className="text-[10px] border-amber-400/20 text-amber-800/60 dark:text-amber-400/60">
                      {blockedRelaysList.length}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {pubkey && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); handlePublishBlockList(); }}
                        disabled={publishingBlockList}
                        data-testid="button-publish-block-list"
                      >
                        <Upload className={`w-3 h-3 mr-1 ${publishingBlockList ? "animate-pulse" : ""}`} />
                        Publish
                      </Button>
                    )}
                    {blockedSectionOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-4 border-t border-amber-500/10 pt-3 space-y-1.5">
                  {blockedRelaysList.map((url) => (
                    <div key={url} className="flex items-center justify-between gap-3 p-2.5 rounded-md bg-muted/40 dark:bg-white/[0.02] border border-border dark:border-white/[0.06]" data-testid={`blocked-relay-${url}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <ShieldBan className="w-3.5 h-3.5 text-amber-800/60 dark:text-amber-400/60 shrink-0" />
                        <span className="text-sm font-mono text-muted-foreground/80 truncate">{url.replace("wss://", "")}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleUnblockRelay(url)}
                        className="text-green-800/60 dark:text-green-400/60 shrink-0"
                        data-testid={`button-unblock-relay-${url}`}
                      >
                        <ShieldCheck className="w-3.5 h-3.5 mr-1" />
                        Unblock
                      </Button>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>
      )}

      <div className="mt-6">
        <Collapsible open={healthMonitorOpen} onOpenChange={setHealthMonitorOpen}>
          <Card className="glass-card overflow-hidden" data-testid="relay-health-section">
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center justify-between gap-2 p-4 sm:p-6 text-left" data-testid="button-toggle-relay-health">
                <div className="flex items-center gap-2 flex-wrap">
                  <Activity className="w-4 h-4 text-brand" />
                  <h2 className="text-sm font-brand tracking-wider uppercase text-brand">Relay Health Monitor</h2>
                </div>
                {healthMonitorOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-border pt-4">
                <RelayHealthMonitor relays={[...allRelays, ...outpostRelays.map(r => r.url).filter(u => !allRelays.includes(u))]} />
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </div>


      <AlertDialog open={showPublishConfirm} onOpenChange={(open) => { if (!open) setShowPublishConfirm(false); }}>
        <AlertDialogContent className="border-border/60 bg-card max-w-[calc(100vw-2rem)] sm:max-w-md mx-auto rounded-xl p-5 sm:p-6 gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm font-brand tracking-wide">Publish your routing?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground/80">
              This replaces your published relay list (NIP-65) across the network. A wrong list can quietly stop people seeing your posts — double-check it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="text-xs space-y-1.5">
            <div><span className="font-medium text-foreground/80">Inbox:</span> <span className="font-mono text-[11px] text-muted-foreground/80">{editRoutes.filter((r) => r.read).map((r) => r.url.replace("wss://", "")).join(", ") || "none"}</span></div>
            <div><span className="font-medium text-foreground/80">Outbox:</span> <span className="font-mono text-[11px] text-muted-foreground/80">{editRoutes.filter((r) => r.write).map((r) => r.url.replace("wss://", "")).join(", ") || "none"}</span></div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction className="h-8 text-xs" onClick={() => { setShowPublishConfirm(false); void publishRoutes(); }} data-testid="button-confirm-publish-routes">
              Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmAction} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <AlertDialogContent className="border-border/60 bg-card max-w-[calc(100vw-2rem)] sm:max-w-md mx-auto rounded-xl p-5 sm:p-6 gap-5">
          <AlertDialogHeader className="text-center sm:text-center space-y-3">
            <div className="flex justify-center">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                confirmAction?.type === "block-relay"
                  ? "bg-amber-500/10 border border-amber-500/20"
                  : "bg-red-500/10 border border-red-500/20"
              }`}>
                {confirmAction?.type === "block-relay" ? (
                  <ShieldBan className="w-6 h-6 text-amber-500" />
                ) : (
                  <Trash2 className="w-6 h-6 text-red-500" />
                )}
              </div>
            </div>
            <div>
              <AlertDialogTitle className="text-base font-semibold">
                {confirmAction?.type === "block-relay" ? "Block Relay" :
                 confirmAction?.type === "remove-outpost" ? "Remove Community Relay" : "Remove Relay"}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-[13px] text-muted-foreground/70 mt-1.5 leading-relaxed">
                {confirmAction?.type === "block-relay"
                  ? "This relay will be disconnected and excluded from all future connections."
                  : confirmAction?.type === "remove-outpost"
                  ? "This community relay and its configuration will be permanently removed."
                  : "This relay will be disconnected and removed from your custom list."}
              </AlertDialogDescription>
            </div>
            {confirmAction && (
              <div className="px-3 py-2.5 rounded-lg bg-muted/30 border border-border/40">
                <p className="text-xs font-mono text-muted-foreground/80 truncate">{confirmAction.url}</p>
                {confirmAction.label !== confirmAction.url && (
                  <p className="text-[11px] text-muted-foreground/50 mt-0.5">{confirmAction.label}</p>
                )}
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:gap-2">
            <AlertDialogAction
              className={`w-full h-11 text-sm font-medium rounded-lg ${
                confirmAction?.type === "block-relay"
                  ? "bg-amber-600 hover:bg-amber-700 text-white"
                  : "bg-red-600 hover:bg-red-700 text-white"
              }`}
              onClick={() => {
                if (!confirmAction) return;
                if (confirmAction.type === "remove-outpost" && confirmAction.idx !== undefined) {
                  removeOutpostRelay(confirmAction.idx);
                } else if (confirmAction.type === "remove-relay") {
                  removeRelay(confirmAction.url);
                } else if (confirmAction.type === "block-relay") {
                  handleBlockRelay(confirmAction.url);
                }
                setConfirmAction(null);
              }}
            >
              {confirmAction?.type === "block-relay" ? "Block Relay" :
               confirmAction?.type === "remove-outpost" ? "Remove Relay" : "Remove Relay"}
            </AlertDialogAction>
            <AlertDialogCancel className="w-full h-11 text-sm font-medium rounded-lg mt-0">Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
