import type { Event as NostrEvent } from "nostr-tools";
import { useState, useEffect, useCallback, useMemo } from "react";
import { pool, publishEvent } from "@/lib/nostr";
import { type Nip11Document } from "@/lib/nip11";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";
import { OpsCard, OpsSectionHeader } from "./ops-ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  KIND_CURATION_SET,
  parseCurationSet,
  buildCurationSetTags,
  relayFeaturedSets,
  detectFeedPaste,
  curationItemLabel,
  type CurationSet,
  type CurationItem,
} from "@/lib/curation-set";
import {
  Sparkles,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  X,
  FileText,
  MessageSquare,
  Radio,
  Film,
  Tag,
  Link2,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";

/** Icon per item flavor — same vocabulary the public Featured tab renders with. */
function itemIcon(item: CurationItem) {
  if (item.type === "url") return Link2;
  if (item.type === "note") return MessageSquare;
  switch (item.kind) {
    case 30023: return FileText;
    case 30311: return Radio;
    case 30402: return Tag;
    case 34235:
    case 34236: return Film;
    default: return FileText;
  }
}

interface DraftState {
  /** null d = brand-new feed (slug minted from the title on first publish). */
  dTag: string | null;
  title: string;
  description: string;
  items: CurationItem[];
}

function slugify(title: string): string {
  const base = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || `feed-${Date.now().toString(36)}`;
}

export function FeaturedTab({ relayUrl, nip11 }: { relayUrl: string; nip11: Nip11Document | null }) {
  const { pubkey, signer } = useNostrAuth();
  const { toast } = useToast();

  const [sets, setSets] = useState<CurationSet[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reachFailed, setReachFailed] = useState(false);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [pasteValue, setPasteValue] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CurationSet | null>(null);

  const refresh = useCallback(async () => {
    setLoaded(false);
    setReachFailed(false);
    try {
      const events = await pool.querySync([relayUrl], { kinds: [KIND_CURATION_SET], limit: 100 });
      setSets(relayFeaturedSets(events, { pubkey: nip11?.pubkey, moderators: nip11?.moderators }));
    } catch {
      setReachFailed(true);
    } finally {
      setLoaded(true);
    }
  }, [relayUrl, nip11?.pubkey, nip11?.moderators]);

  useEffect(() => { refresh(); }, [refresh]);

  const openEditor = useCallback((set?: CurationSet) => {
    setPasteValue("");
    setDraft(set
      ? { dTag: set.dTag, title: set.title, description: set.description || "", items: [...set.items] }
      : { dTag: null, title: "", description: "", items: [] });
  }, []);

  const addPaste = useCallback(() => {
    if (!draft) return;
    const parsed = detectFeedPaste(pasteValue);
    if (!parsed) {
      toast({ title: "Not recognized", description: "Paste a post link, note/nevent/naddr, or a web URL.", variant: "destructive" });
      return;
    }
    if (parsed.type === "profile") {
      toast({ title: "That's a person", description: "Browsing a profile to pick their content is coming next — for now paste a link to the specific post, article, or stream." });
      return;
    }
    setDraft({ ...draft, items: [...draft.items, parsed] });
    setPasteValue("");
  }, [draft, pasteValue, toast]);

  const move = useCallback((index: number, dir: -1 | 1) => {
    if (!draft) return;
    const next = [...draft.items];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setDraft({ ...draft, items: next });
  }, [draft]);

  const removeItem = useCallback((index: number) => {
    if (!draft) return;
    setDraft({ ...draft, items: draft.items.filter((_, i) => i !== index) });
  }, [draft]);

  const publish = useCallback(async () => {
    if (!draft || !signer || !pubkey) return;
    const title = draft.title.trim();
    if (!title) {
      toast({ title: "Name the feed", description: "A feed needs a name people will see.", variant: "destructive" });
      return;
    }
    // Wipe guard (replaceable-event rule): an empty publish would ERASE the
    // feed's contents for every reader. Deleting is its own explicit action.
    if (draft.items.length === 0) {
      toast({ title: "Add something first", description: "Publishing an empty feed would clear it for everyone. Use Delete to remove a feed.", variant: "destructive" });
      return;
    }
    setPublishing(true);
    try {
      const dTag = draft.dTag ?? slugify(title);
      const template = {
        kind: KIND_CURATION_SET,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: buildCurationSetTags({ dTag, title, description: draft.description.trim() || undefined, items: draft.items }),
      };
      const signed = await signWithTimeout(signer, template);
      await publishEvent(signed, [relayUrl]);
      const parsed = parseCurationSet(signed as NostrEvent);
      if (parsed) {
        setSets((prev) => {
          const rest = prev.filter((s) => !(s.pubkey === parsed.pubkey && s.dTag === parsed.dTag));
          return [parsed, ...rest];
        });
      }
      setDraft(null);
      toast({ title: "Feed published", description: "It's live on this relay's Featured tab." });
    } catch (err) {
      if (isSignerError(err)) handleSignerError(err, toast);
      else toast({ title: "Couldn't publish", description: err instanceof Error ? err.message : "The relay didn't accept the feed.", variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  }, [draft, signer, pubkey, relayUrl, toast]);

  const deleteFeed = useCallback(async (set: CurationSet) => {
    if (!signer || !pubkey) return;
    try {
      const template = {
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        content: "feed removed by curator",
        tags: [
          ["a", `${KIND_CURATION_SET}:${set.pubkey}:${set.dTag}`],
          ["e", set.id],
          ["k", String(KIND_CURATION_SET)],
        ],
      };
      const signed = await signWithTimeout(signer, template);
      await publishEvent(signed, [relayUrl]);
      setSets((prev) => prev.filter((s) => !(s.pubkey === set.pubkey && s.dTag === set.dTag)));
      toast({ title: "Feed deleted" });
    } catch (err) {
      if (isSignerError(err)) handleSignerError(err, toast);
      else toast({ title: "Couldn't delete", description: "The relay didn't accept the deletion.", variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  }, [signer, pubkey, relayUrl, toast]);

  const mine = useMemo(() => sets.filter((s) => s.pubkey === pubkey), [sets, pubkey]);
  const others = useMemo(() => sets.filter((s) => s.pubkey !== pubkey), [sets, pubkey]);

  return (
    <div className="space-y-4" data-testid="featured-tab">
      <OpsSectionHeader icon={Sparkles} label="Featured feeds">
        <p className="text-xs text-muted-foreground">
          Curate what greets people on this relay's Featured tab — any post, article, listing, stream, or link, from anyone, old or new.
        </p>
      </OpsSectionHeader>

      {!loaded ? (
        <OpsCard><p className="text-sm text-muted-foreground py-4 text-center">Loading feeds…</p></OpsCard>
      ) : reachFailed ? (
        <OpsCard>
          <div className="flex items-center gap-2 py-3 justify-center text-sm text-muted-foreground">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Couldn't reach the relay to load feeds.
            <Button size="sm" variant="outline" onClick={refresh}><RefreshCw className="w-3.5 h-3.5 mr-1" />Retry</Button>
          </div>
        </OpsCard>
      ) : draft ? (
        <OpsCard>
          <div className="space-y-4" data-testid="featured-editor">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{draft.dTag ? "Edit feed" : "New feed"}</p>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)} data-testid="button-featured-cancel"><X className="w-4 h-4" /></Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Feed name — e.g. Weekly Picks"
                data-testid="input-featured-title"
              />
              <Input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="One-line description (optional)"
                data-testid="input-featured-description"
              />
            </div>

            <div className="flex gap-2">
              <Input
                value={pasteValue}
                onChange={(e) => setPasteValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Return") { e.preventDefault(); addPaste(); } }}
                placeholder="Paste anything — a post link, nevent, naddr, or web URL"
                data-testid="input-featured-paste"
              />
              <Button onClick={addPaste} disabled={!pasteValue.trim()} data-testid="button-featured-add">
                <Plus className="w-4 h-4 mr-1" />Add
              </Button>
            </div>

            {draft.items.length === 0 ? (
              <p className="text-xs text-muted-foreground/70 text-center py-4">Nothing here yet — paste the first thing worth featuring.</p>
            ) : (
              <ul className="space-y-1.5" data-testid="featured-item-list">
                {draft.items.map((item, i) => {
                  const Icon = itemIcon(item);
                  return (
                    <li key={`${i}-${item.type === "url" ? item.url : item.type === "note" ? item.id : `${item.kind}:${item.identifier}`}`} className="flex items-center gap-2 rounded-lg border border-border/30 bg-muted/10 px-2.5 py-1.5">
                      <Icon className="w-3.5 h-3.5 text-brand/70 shrink-0" />
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0">{curationItemLabel(item)}</Badge>
                      <span className="text-xs text-muted-foreground truncate flex-1 font-mono">
                        {item.type === "url" ? item.url : item.type === "note" ? item.id.slice(0, 16) + "…" : item.identifier || `${item.kind}:${item.pubkey.slice(0, 8)}…`}
                      </span>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button className="p-1 rounded hover:bg-muted/40 disabled:opacity-30" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp className="w-3.5 h-3.5" /></button>
                        <button className="p-1 rounded hover:bg-muted/40 disabled:opacity-30" onClick={() => move(i, 1)} disabled={i === draft.items.length - 1} aria-label="Move down"><ArrowDown className="w-3.5 h-3.5" /></button>
                        <button className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500" onClick={() => removeItem(i)} aria-label="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
              <Button onClick={publish} disabled={publishing} data-testid="button-featured-publish">
                {publishing ? "Publishing…" : "Publish feed"}
              </Button>
            </div>
          </div>
        </OpsCard>
      ) : (
        <>
          <div className="flex justify-end">
            <Button onClick={() => openEditor()} data-testid="button-featured-new">
              <Plus className="w-4 h-4 mr-1" />New feed
            </Button>
          </div>

          {mine.length === 0 && others.length === 0 && (
            <OpsCard>
              <div className="text-center py-6 space-y-1.5">
                <Sparkles className="w-6 h-6 text-brand/50 mx-auto" />
                <p className="text-sm font-medium">No featured feeds yet</p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Create one and it becomes the Featured tab on this relay's public page — a curated front door you control.
                </p>
              </div>
            </OpsCard>
          )}

          {mine.map((set) => (
            <OpsCard key={`${set.pubkey}:${set.dTag}`}>
              <div className="flex items-start justify-between gap-3" data-testid={`featured-feed-${set.dTag}`}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{set.title}</p>
                  {set.description && <p className="text-xs text-muted-foreground truncate mt-0.5">{set.description}</p>}
                  <p className="text-[10px] text-muted-foreground/60 mt-1">{set.items.length} item{set.items.length !== 1 ? "s" : ""}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => openEditor(set)} data-testid={`button-featured-edit-${set.dTag}`}>Edit</Button>
                  <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-red-500" onClick={() => setDeleteTarget(set)} aria-label="Delete feed"><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            </OpsCard>
          ))}

          {others.length > 0 && (
            <OpsCard>
              <p className="text-xs text-muted-foreground">
                {others.length} feed{others.length !== 1 ? "s" : ""} by other curators of this relay (only their author can edit them).
              </p>
            </OpsCard>
          )}
        </>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the feed from the relay's Featured tab for everyone. The featured posts themselves are untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && deleteFeed(deleteTarget)} className="bg-red-600 hover:bg-red-700">Delete feed</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
