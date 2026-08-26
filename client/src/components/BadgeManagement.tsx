import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { nip19 } from "nostr-tools";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { use$ } from "applesauce-react/hooks";
import { eventStore, searchCachedProfiles } from "@/lib/nostr";
import { searchUsers } from "@/lib/primal-cache";
import { KIND_METADATA, getDisplayName, getAvatarUrl } from "@/lib/nostr-helpers";
import {
  createBadgeDefinition,
  awardBadge,
  fetchBadgeDefinitionsByAuthorResult,
  badgeATagValue,
  type BadgeDefinition } from "@/lib/nip58-badges";
import { uploadMedia } from "@/lib/media-upload";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Award, Plus, Send, X, Search, User, Upload, ChevronDown, ChevronUp } from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

function RecipientChip({ pubkey, onRemove }: { pubkey: string; onRemove: () => void }) {
  const metadataEvent = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const npub = useMemo(() => { try { return nip19.npubEncode(pubkey); } catch { return pubkey; } }, [pubkey]);
  const name = metadataEvent ? (getDisplayName(metadataEvent, npub.slice(0, 12) + "...") ?? npub.slice(0, 12) + "...") : npub.slice(0, 12) + "...";
  const avatar = metadataEvent ? getAvatarUrl(metadataEvent) : undefined;

  return (
    <span className="inline-flex items-center gap-1 bg-brand/10 border border-brand/20 rounded-full px-2 py-0.5">
      {avatar ? (
        <img src={avatar} alt="" className="w-3.5 h-3.5 rounded-full object-cover" />
      ) : (
        <User className="w-3 h-3 text-brand/50" />
      )}
      <span className="text-[11px] text-foreground/80 truncate max-w-[100px]">{name}</span>
      <button onClick={onRemove} className="text-muted-foreground/50 hover:text-red-500 transition-colors">
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

function UserSearchResult({ pubkey, onSelect }: { pubkey: string; onSelect: (pk: string) => void }) {
  const metadataEvent = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const npub = useMemo(() => { try { return nip19.npubEncode(pubkey); } catch { return pubkey; } }, [pubkey]);
  const name = metadataEvent ? (getDisplayName(metadataEvent, npub.slice(0, 16) + "...") ?? npub.slice(0, 16) + "...") : npub.slice(0, 16) + "...";
  const avatar = metadataEvent ? getAvatarUrl(metadataEvent) : undefined;

  return (
    <button
      onClick={() => onSelect(pubkey)}
      className="flex items-center gap-2 w-full px-2 py-1.5 hover:bg-brand/10 rounded-md transition-colors text-left"
    >
      <Avatar className="w-6 h-6">
        <AvatarImage src={avatar} alt={name} />
        <AvatarFallback className="bg-brand/10 text-brand text-[10px]">
          {name.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="text-xs text-foreground/80 truncate">{name}</span>
    </button>
  );
}

export function BadgeCreationForm({ onCreated }: { onCreated?: () => void }) {
  const { signer } = useNostrAuth();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [thumbUrl, setThumbUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = useCallback(async (file: File) => {
    setUploading(true);
    setUploadStatus("Uploading...");
    try {
      const result = await uploadMedia(file, setUploadStatus, signer);
      if (result.url) {
        setImageUrl(result.url);
        toast({ title: "Image uploaded" });
      } else {
        toast({ title: "Upload failed", variant: "destructive" });
      }
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
      setUploadStatus("");
    }
  }, [signer, toast]);

  const handleCreate = useCallback(async () => {
    if (!signer || !name.trim()) return;
    setCreating(true);
    try {
      const result = await createBadgeDefinition(signer, name.trim(), description.trim(), imageUrl.trim(), thumbUrl.trim());
      if (result) {
        toast({ title: "Badge created", description: `"${name}" badge definition published` });
        setName("");
        setDescription("");
        setImageUrl("");
        setThumbUrl("");
        onCreated?.();
      } else {
        toast({ title: "Failed to create badge", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to create badge", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }, [signer, name, description, imageUrl, thumbUrl, toast, onCreated]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Award className="w-4 h-4 text-brand/70" />
        <h3 className="text-sm font-semibold text-foreground/90">Create Badge</h3>
      </div>
      <Input
        placeholder="Badge name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="text-base h-9 bg-background/50"
      />
      <Input
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="text-base h-9 bg-background/50"
      />
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground/60 font-medium">Badge Image</label>
        <div className="flex gap-2">
          <Input
            placeholder="Image URL or upload below"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            className="text-base h-9 bg-background/50 flex-1"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImageUpload(file);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 gap-1 shrink-0"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
            {uploading ? uploadStatus || "Uploading..." : "Upload"}
          </Button>
        </div>
      </div>
      <Input
        placeholder="Thumbnail URL (optional)"
        value={thumbUrl}
        onChange={(e) => setThumbUrl(e.target.value)}
        className="text-base h-9 bg-background/50"
      />
      {imageUrl && (
        <div className="flex items-center gap-2">
          <img
            src={imageUrl}
            alt="Preview"
            className="w-12 h-12 rounded-md object-cover border border-border/30"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <span className="text-[10px] text-muted-foreground/50">Image preview</span>
        </div>
      )}
      <Button
        size="sm"
        className="w-full gap-1.5"
        disabled={!name.trim() || creating || uploading || !signer}
        onClick={handleCreate}
      >
        {creating ? <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
        {creating ? "Creating..." : "Create Badge"}
      </Button>
    </div>
  );
}

export function BadgeAwardForm({ onAwarded }: { onAwarded?: () => void }) {
  const { pubkey: myPubkey, signer } = useNostrAuth();
  const { toast } = useToast();
  const [badges, setBadges] = useState<BadgeDefinition[]>([]);
  const [loadingBadges, setLoadingBadges] = useState(false);
  const [selectedBadge, setSelectedBadge] = useState<BadgeDefinition | null>(null);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [awarding, setAwarding] = useState(false);
  const [badgeDropdownOpen, setBadgeDropdownOpen] = useState(false);
  // false = no relay in the badge set answered, so an empty list below says
  // nothing about whether this operator has badges.
  const [badgesReached, setBadgesReached] = useState(true);

  useEffect(() => {
    if (!myPubkey) return;
    let cancelled = false;
    setLoadingBadges(true);
    fetchBadgeDefinitionsByAuthorResult(myPubkey).then(({ data, reached }) => {
      if (!cancelled) {
        setBadgesReached(reached);
        setBadges(data);
        setLoadingBadges(false);
      }
    });
    return () => { cancelled = true; };
  }, [myPubkey]);

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) { setSearchResults([]); return; }

    setSearching(true);
    try {
      if (query.startsWith("npub1")) {
        try {
          const decoded = nip19.decode(query);
          if (decoded.type === "npub") {
            setSearchResults([decoded.data as string]);
            setSearching(false);
            return;
          }
        } catch { /* not a valid npub */ }
      }

      const cached = searchCachedProfiles(query, 5);
      if (cached.length > 0) {
        setSearchResults(cached.map(e => e.pubkey));
        setSearching(false);
        return;
      }

      const primalResults = await searchUsers(query, 5);
      if (primalResults.length > 0) {
        setSearchResults(primalResults.map(e => e.pubkey));
      }
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const addRecipient = useCallback((pk: string) => {
    if (!recipients.includes(pk)) {
      setRecipients(prev => [...prev, pk]);
    }
    setSearchQuery("");
    setSearchResults([]);
  }, [recipients]);

  const removeRecipient = useCallback((pk: string) => {
    setRecipients(prev => prev.filter(p => p !== pk));
  }, []);

  const handleAward = useCallback(async () => {
    if (!signer || !selectedBadge || recipients.length === 0) return;
    setAwarding(true);
    try {
      const result = await awardBadge(signer, selectedBadge.pubkey, selectedBadge.dTag, recipients);
      if (result) {
        toast({
          title: "Badge awarded",
          description: `"${selectedBadge.name}" awarded to ${recipients.length} user${recipients.length > 1 ? "s" : ""}` });
        setSelectedBadge(null);
        setRecipients([]);
        onAwarded?.();
      } else {
        toast({ title: "Failed to award badge", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to award badge", variant: "destructive" });
    } finally {
      setAwarding(false);
    }
  }, [signer, selectedBadge, recipients, toast, onAwarded]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Send className="w-4 h-4 text-brand/70" />
        <h3 className="text-sm font-semibold text-foreground/90">Award Badge</h3>
      </div>

      {loadingBadges ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
          <RelayOutpostInlineLoader className="w-3 h-3" />
          Loading your badges...
        </div>
      ) : badges.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">
          {badgesReached
            ? "No badges created yet. Create a badge first."
            : "Couldn't reach the badge relays, so we can't list your badges yet."}
        </p>
      ) : (
        <div className="relative">
          <button
            onClick={() => setBadgeDropdownOpen(!badgeDropdownOpen)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-border/30 bg-background/50 hover:bg-background/70 transition-colors text-left"
          >
            {selectedBadge ? (
              <div className="flex items-center gap-2 min-w-0">
                {(selectedBadge.thumb || selectedBadge.image) ? (
                  <img src={selectedBadge.thumb || selectedBadge.image} alt="" className="w-5 h-5 rounded-sm object-cover" />
                ) : (
                  <Award className="w-4 h-4 text-brand/50" />
                )}
                <span className="text-sm text-foreground/80 truncate">{selectedBadge.name}</span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground/50">Select a badge...</span>
            )}
            {badgeDropdownOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />}
          </button>
          {badgeDropdownOpen && (
            <div className="absolute z-10 top-full mt-1 w-full rounded-md border border-border/30 bg-background shadow-lg max-h-40 overflow-y-auto">
              {badges.map((badge) => (
                <button
                  key={badgeATagValue(badge.pubkey, badge.dTag)}
                  onClick={() => { setSelectedBadge(badge); setBadgeDropdownOpen(false); }}
                  className="flex items-center gap-2 w-full px-3 py-2 hover:bg-brand/10 transition-colors text-left"
                >
                  {(badge.thumb || badge.image) ? (
                    <img src={badge.thumb || badge.image} alt="" className="w-5 h-5 rounded-sm object-cover" />
                  ) : (
                    <Award className="w-4 h-4 text-brand/50" />
                  )}
                  <span className="text-sm text-foreground/80 truncate">{badge.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedBadge && (
        <>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground/60 font-medium">Recipients</label>
            {recipients.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {recipients.map(pk => (
                  <RecipientChip key={pk} pubkey={pk} onRemove={() => removeRecipient(pk)} />
                ))}
              </div>
            )}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
              <Input
                placeholder="Search user or paste npub..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="text-base h-9 pl-8 bg-background/50"
              />
            </div>
            {searchResults.length > 0 && (
              <div className="rounded-md border border-border/30 bg-background max-h-32 overflow-y-auto">
                {searchResults.filter(pk => !recipients.includes(pk)).map(pk => (
                  <UserSearchResult key={pk} pubkey={pk} onSelect={addRecipient} />
                ))}
              </div>
            )}
          </div>
          <Button
            size="sm"
            className="w-full gap-1.5"
            disabled={recipients.length === 0 || awarding || !signer}
            onClick={handleAward}
          >
            {awarding ? <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
            {awarding ? "Awarding..." : `Award to ${recipients.length} user${recipients.length > 1 ? "s" : ""}`}
          </Button>
        </>
      )}
    </div>
  );
}

export function BadgeManagementPanel() {
  const [showCreate, setShowCreate] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award className="w-4.5 h-4.5 text-brand" />
          <h2 className="text-sm font-bold text-foreground/90 uppercase tracking-wider">NIP-58 Badges</h2>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={() => setShowCreate(!showCreate)}
        >
          {showCreate ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
          {showCreate ? "Cancel" : "New Badge"}
        </Button>
      </div>

      {showCreate && (
        <div className="rounded-lg border border-brand/20 bg-brand/5 p-3">
          <BadgeCreationForm onCreated={() => { setShowCreate(false); setRefreshKey(k => k + 1); }} />
        </div>
      )}

      <div className="rounded-lg border border-border/30 bg-card/30 p-3">
        <BadgeAwardForm key={refreshKey} onAwarded={() => setRefreshKey(k => k + 1)} />
      </div>
    </div>
  );
}
