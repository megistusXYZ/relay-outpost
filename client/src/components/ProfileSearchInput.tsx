import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { User, Search, Zap, X } from "lucide-react";
import { searchUsers } from "@/lib/primal-cache";
import { searchCachedProfiles, eventStore, fetchProfilesCached } from "@/lib/nostr";
import { getProfileContent } from "@/lib/nostr-helpers";
import { getLightningAddress } from "@/lib/zap";
import { use$ } from "applesauce-react/hooks";
import { KIND_METADATA } from "@/lib/nostr-helpers";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

export interface SelectedRecipient {
  type: "profile" | "address" | "invoice";
  pubkey?: string;
  lightningAddress?: string;
  invoice?: string;
  displayName?: string;
  picture?: string;
}

interface ProfileSearchInputProps {
  onSelect: (recipient: SelectedRecipient | null) => void;
  selected: SelectedRecipient | null;
  placeholder?: string;
}

function ProfileResult({ event, onSelect }: { event: Event; onSelect: (r: SelectedRecipient) => void }) {
  const content = useMemo(() => {
    try { return JSON.parse(event.content); } catch { return {}; }
  }, [event]);

  const name = content.display_name || content.name || "";
  const nip05 = content.nip05 || "";
  const picture = content.picture || "";
  const lnAddr = content.lud16 || "";

  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors hover:bg-brand/10 dark:hover:bg-brand/8"
      onClick={() => onSelect({
        type: "profile",
        pubkey: event.pubkey,
        lightningAddress: lnAddr || undefined,
        displayName: name || undefined,
        picture: picture || undefined,
      })}
      data-testid={`result-profile-${event.pubkey.slice(0, 8)}`}
    >
      <Avatar className="w-9 h-9 shrink-0">
        {picture ? <AvatarImage src={picture} alt={name} /> : null}
        <AvatarFallback className="bg-brand/20 text-brand">
          <User className="w-4 h-4" />
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground/90 dark:text-white/85 truncate">
          {name || `npub1...${event.pubkey.slice(-6)}`}
        </div>
        {nip05 && (
          <div className="text-[11px] text-muted-foreground/60 truncate">{nip05}</div>
        )}
      </div>
      {lnAddr && (
        <div className="flex items-center gap-1 shrink-0">
          <Zap className="w-3 h-3 text-amber-500/60" />
          <span className="text-[10px] text-muted-foreground/50 max-w-[120px] truncate font-mono">{lnAddr}</span>
        </div>
      )}
    </div>
  );
}

function SelectedRecipientCard({ recipient, onClear }: { recipient: SelectedRecipient; onClear: () => void }) {
  const profileEvent = use$(() =>
    recipient.pubkey ? eventStore.replaceable(KIND_METADATA, recipient.pubkey) : undefined,
    [recipient.pubkey]
  );

  useEffect(() => {
    if (recipient.pubkey && !profileEvent) {
      fetchProfilesCached([recipient.pubkey]);
    }
  }, [recipient.pubkey, profileEvent]);

  const { name, picture, lnAddr } = useMemo(() => {
    if (recipient.type === "address") {
      return { name: recipient.lightningAddress || "", picture: "", lnAddr: recipient.lightningAddress || "" };
    }
    if (recipient.type === "invoice") {
      return { name: "Lightning Invoice", picture: "", lnAddr: "" };
    }
    let n = recipient.displayName || "";
    let p = recipient.picture || "";
    let ln = recipient.lightningAddress || "";
    if (profileEvent) {
      const content = getProfileContent(profileEvent);
      if (!n) n = content?.display_name || content?.name || "";
      if (!p) p = content?.picture || "";
      if (!ln) ln = content?.lud16 || "";
    }
    if (!n && recipient.pubkey) {
      try { n = nip19.npubEncode(recipient.pubkey).slice(0, 16) + "..."; } catch { n = recipient.pubkey.slice(0, 12) + "..."; }
    }
    return { name: n, picture: p, lnAddr: ln };
  }, [recipient, profileEvent]);

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-brand/[0.06]/[0.08] border border-brand/10" data-testid="card-selected-recipient">
      {recipient.type === "invoice" ? (
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-amber-500/10 shrink-0">
          <Zap className="w-4 h-4 text-amber-500" />
        </div>
      ) : (
        <Avatar className="w-9 h-9 shrink-0">
          {picture ? <AvatarImage src={picture} alt={name} /> : null}
          <AvatarFallback className="bg-brand/20 text-brand">
            <User className="w-4 h-4" />
          </AvatarFallback>
        </Avatar>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground/90 dark:text-white/85 truncate">{name}</div>
        {lnAddr && (
          <div className="flex items-center gap-1 mt-0.5">
            <Zap className="w-3 h-3 text-amber-500/50" />
            <span className="text-[11px] text-muted-foreground/60 truncate font-mono">{lnAddr}</span>
          </div>
        )}
        {recipient.type === "invoice" && recipient.invoice && (
          <span className="text-[11px] text-muted-foreground/60 truncate font-mono block mt-0.5">
            {recipient.invoice.slice(0, 30)}...
          </span>
        )}
      </div>
      <button
        onClick={onClear}
        className="p-1.5 rounded-md hover:bg-foreground/[0.06] transition-colors shrink-0"
        data-testid="button-clear-recipient"
      >
        <X className="w-4 h-4 text-muted-foreground/50" />
      </button>
    </div>
  );
}

export function ProfileSearchInput({ onSelect, selected, placeholder }: ProfileSearchInputProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Event[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const normalizeInput = useCallback((raw: string): string => {
    let v = raw.trim();
    if (v.toLowerCase().startsWith("lightning:")) v = v.slice(10);
    return v;
  }, []);

  const handleInputChange = useCallback((value: string) => {
    setQuery(value);
    const normalized = normalizeInput(value);

    if (!normalized) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    if (normalized.toLowerCase().startsWith("lnbc")) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    if (normalized.includes("@") && !normalized.includes(" ") && normalized.indexOf("@") > 0 && normalized.indexOf("@") < normalized.length - 1) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const cached = searchCachedProfiles(value.trim(), 6);
      if (cached.length > 0) {
        setResults(cached);
        setShowDropdown(true);
      }

      setIsSearching(true);
      try {
        const remote = await searchUsers(value.trim(), 8);
        const seen = new Set<string>();
        const merged: Event[] = [];
        for (const e of [...cached, ...remote]) {
          if (!seen.has(e.pubkey)) {
            seen.add(e.pubkey);
            merged.push(e);
          }
        }
        setResults(merged.slice(0, 8));
        if (merged.length > 0) setShowDropdown(true);
      } catch {}
      setIsSearching(false);
    }, 300);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      const val = normalizeInput(query);
      if (!val) return;

      if (val.toLowerCase().startsWith("lnbc")) {
        onSelect({ type: "invoice", invoice: val });
        setQuery("");
        setShowDropdown(false);
        return;
      }

      if (val.includes("@") && val.indexOf("@") > 0) {
        onSelect({ type: "address", lightningAddress: val });
        setQuery("");
        setShowDropdown(false);
        return;
      }

      if (val.toLowerCase().startsWith("npub")) {
        try {
          const decoded = nip19.decode(val.toLowerCase());
          if (decoded.type === "npub") {
            onSelect({ type: "profile", pubkey: decoded.data as string });
            setQuery("");
            setShowDropdown(false);
            return;
          }
        } catch {}
      }
    }
  }, [query, onSelect, normalizeInput]);

  const handleSelect = useCallback((recipient: SelectedRecipient) => {
    onSelect(recipient);
    setQuery("");
    setShowDropdown(false);
    setResults([]);
  }, [onSelect]);

  const handleClear = useCallback(() => {
    onSelect(null);
    setQuery("");
    setResults([]);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [onSelect]);

  if (selected) {
    return <SelectedRecipientCard recipient={selected} onClear={handleClear} />;
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40 pointer-events-none" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setShowDropdown(true)}
          placeholder={placeholder || "Search by name or handle…"}
          className="pl-9 pr-3"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          data-testid="input-recipient-search"
        />
        {isSearching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <RelayOutpostInlineLoader className="w-3.5 h-3.5 text-brand" />
          </div>
        )}
      </div>

      {showDropdown && results.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 top-full mt-1 left-0 right-0 rounded-lg overflow-hidden shadow-lg border border-border/20 max-h-[280px] overflow-y-auto bg-popover"
          data-testid="dropdown-search-results"
        >
          {results.map((event) => (
            <ProfileResult key={event.pubkey} event={event} onSelect={handleSelect} />
          ))}
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground/40 text-center font-brand uppercase tracking-wider">
            {isSearching ? "Searching..." : "Select a contact"}
          </div>
        </div>
      )}

      {query.trim() && !showDropdown && !isSearching && (() => {
        const n = normalizeInput(query);
        const nl = n.toLowerCase();
        return (
          <div className="mt-1.5 text-[11px] text-muted-foreground/50">
            {n.includes("@") ? "Press Enter to use as lightning address" :
             nl.startsWith("lnbc") ? "Press Enter to use as invoice" :
             nl.startsWith("npub") ? "Press Enter to look up this npub" :
             "Type a name or handle"}
          </div>
        );
      })()}
    </div>
  );
}
