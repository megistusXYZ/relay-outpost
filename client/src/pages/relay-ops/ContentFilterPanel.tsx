/**
 * Content's Filter panel and Views menu (owner, 2026-10-03: "think Salesforce
 * but simple"). A popover on a desktop, a sheet from the bottom on a phone.
 *
 * Kinds are found by name, number or NIP (lib/kind-catalog.ts); people by
 * name or npub; hashtags typed. Everything chosen goes to the relay
 * (content-filters.ts) and shows as a chip under the search field.
 */
import { useMemo, useState, type ReactNode } from "react";
import { nip19 } from "nostr-tools";
import { Bookmark, Check, Plus, Trash2, X } from "lucide-react";
import { findKinds, kindName, plainKindName } from "@/lib/kind-catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TIME_RANGES, type RangeId } from "./event-query";
import type { SortDir, SortKey } from "./content-model";
import type { ContentFilters, SavedView } from "./content-filters";
import type { ProfileInfo } from "./shared";

const QUICK_KINDS = [1, 7, 9735, 6, 30023, 0, 1984];

const pill = (on: boolean) =>
  `min-h-[40px] px-3.5 rounded-full text-[13px] font-medium transition-colors ${on ? "bg-brand text-white" : "bg-black/[0.05] dark:bg-white/[0.06] text-foreground/80 hover:bg-black/[0.08] dark:hover:bg-white/[0.1]"}`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[12px] font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Picked({ items, onRemove, testId }: { items: Array<{ key: string; label: string }>; onRemove: (key: string) => void; testId: string }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId}>
      {items.map((it) => (
        <button key={it.key} type="button" onClick={() => onRemove(it.key)} className="inline-flex items-center gap-1 min-h-[36px] pl-3 pr-2 rounded-full bg-brand/10 text-brand text-[13px] font-medium" aria-label={`Remove ${it.label}`}>
          {it.label}<X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function toHex(input: string): string | null {
  const s = input.trim().replace(/^nostr:/, "");
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
  try {
    const d = nip19.decode(s);
    if (d.type === "npub") return d.data as string;
    if (d.type === "nprofile") return (d.data as { pubkey: string }).pubkey;
  } catch {}
  return null;
}

export interface FilterPanelProps {
  wide: boolean;
  filters: ContentFilters;
  setFilters: (f: ContentFilters) => void;
  range: RangeId | "custom";
  setRange: (r: RangeId | "custom") => void;
  customSince: string;
  customUntil: string;
  setCustomSince: (v: string) => void;
  setCustomUntil: (v: string) => void;
  sort: { key: SortKey; dir: SortDir };
  setSort: (s: { key: SortKey; dir: SortDir }) => void;
  profiles: Map<string, ProfileInfo>;
  activeCount: number;
}

export function FilterPanel(p: FilterPanelProps) {
  const [open, setOpen] = useState(false);
  const [kindQuery, setKindQuery] = useState("");
  const [personQuery, setPersonQuery] = useState("");
  const [tagInput, setTagInput] = useState("");
  const { filters, setFilters } = p;

  const kindHits = useMemo(() => (kindQuery.trim() ? findKinds(kindQuery, 8) : QUICK_KINDS.map((k) => ({ kind: k, label: kindName(k) }))), [kindQuery]);
  const toggleKind = (k: number) => setFilters({ ...filters, kinds: filters.kinds.includes(k) ? filters.kinds.filter((x) => x !== k) : [...filters.kinds, k] });

  const peopleHits = useMemo(() => {
    const q = personQuery.trim().toLowerCase();
    if (!q) return [] as Array<{ pk: string; name: string }>;
    const hex = toHex(personQuery);
    if (hex) return [{ pk: hex, name: p.profiles.get(hex)?.name ?? `${nip19.npubEncode(hex).slice(0, 14)}…` }];
    return [...p.profiles.entries()]
      .filter(([, prof]) => prof.name?.toLowerCase().includes(q))
      .slice(0, 6)
      .map(([pk, prof]) => ({ pk, name: prof.name ?? pk.slice(0, 8) }));
  }, [personQuery, p.profiles]);
  const addPerson = (pk: string) => { if (!filters.people.includes(pk)) setFilters({ ...filters, people: [...filters.people, pk] }); setPersonQuery(""); };
  const addTag = () => {
    const t = tagInput.trim().replace(/^#+/, "").toLowerCase();
    if (t && !filters.hashtags.includes(t)) setFilters({ ...filters, hashtags: [...filters.hashtags, t] });
    setTagInput("");
  };

  const body = (
    <div className="space-y-5" data-testid="ops-content-filter-panel">
      <Section title="Kinds">
        <Picked testId="ops-filter-kinds-picked" items={filters.kinds.map((k) => ({ key: String(k), label: plainKindName(k) }))} onRemove={(k) => toggleKind(Number(k))} />
        <Input value={kindQuery} onChange={(e) => setKindQuery(e.target.value)} placeholder="Find a kind — reaction, article, 1311, NIP-25" className="min-h-[44px]" aria-label="Find a kind" data-testid="ops-filter-kind-search" />
        <ul className="max-h-56 overflow-y-auto -mx-1" role="listbox" aria-label="Kinds" aria-multiselectable="true">
          {kindHits.map((k) => {
            const on = filters.kinds.includes(k.kind);
            return (
              <li key={k.kind}>
                <button type="button" role="option" aria-selected={on} onClick={() => toggleKind(k.kind)} className="w-full flex items-center gap-3 min-h-[44px] px-2 rounded-lg text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.05]" data-testid={`ops-filter-kind-${k.kind}`}>
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md border ${on ? "bg-brand border-brand text-white" : "border-black/20 dark:border-white/25"}`}>{on && <Check className="w-3.5 h-3.5" aria-hidden="true" />}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="block text-[14px] truncate">{plainKindName(k.kind)}</span>
                    {plainKindName(k.kind) !== k.label && <span className="block text-[12px] text-muted-foreground truncate">{k.label}</span>}
                  </span>
                  <span className="text-[12px] tabular-nums text-muted-foreground">{k.kind}{"nip" in k && k.nip ? ` · ${k.nip}` : ""}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="People">
        <Picked testId="ops-filter-people-picked" items={filters.people.map((pk) => ({ key: pk, label: p.profiles.get(pk)?.name ?? `${pk.slice(0, 8)}…` }))} onRemove={(pk) => setFilters({ ...filters, people: filters.people.filter((x) => x !== pk) })} />
        <Input value={personQuery} onChange={(e) => setPersonQuery(e.target.value)} placeholder="A name or an npub" className="min-h-[44px]" aria-label="Find a person" data-testid="ops-filter-person-search"
          onKeyDown={(e) => { if (e.key === "Enter" && peopleHits[0]) { e.preventDefault(); addPerson(peopleHits[0].pk); } }} />
        {peopleHits.length > 0 && (
          <ul className="-mx-1">
            {peopleHits.map((h) => (
              <li key={h.pk}>
                <button type="button" onClick={() => addPerson(h.pk)} className="w-full flex items-center gap-2 min-h-[44px] px-2 rounded-lg text-left text-[14px] hover:bg-black/[0.04] dark:hover:bg-white/[0.05]" data-testid="ops-filter-person-hit">
                  <Plus className="w-4 h-4 text-muted-foreground" aria-hidden="true" />{h.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Hashtags">
        <Picked testId="ops-filter-tags-picked" items={filters.hashtags.map((t) => ({ key: t, label: `#${t}` }))} onRemove={(t) => setFilters({ ...filters, hashtags: filters.hashtags.filter((x) => x !== t) })} />
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addTag(); }}>
          <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="#bitcoin" className="min-h-[44px] flex-1" aria-label="Add a hashtag" data-testid="ops-filter-tag-input" />
          <Button type="submit" variant="outline" className="min-h-[44px] rounded-full px-4" disabled={!tagInput.trim()}>Add</Button>
        </form>
      </Section>

      <Section title="Time">
        <div className="flex flex-wrap gap-1.5">
          {[...TIME_RANGES, { id: "custom" as const, label: "Custom" }].map((r) => (
            <button key={r.id} type="button" onClick={() => p.setRange(r.id)} aria-pressed={p.range === r.id} data-testid={`ops-events-range-${r.id}`} className={pill(p.range === r.id)}>{r.label}</button>
          ))}
        </div>
        {p.range === "custom" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <label className="block space-y-1"><span className="text-[12px] text-muted-foreground">From</span>
              <input type="datetime-local" value={p.customSince} onChange={(e) => p.setCustomSince(e.target.value)} className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background text-sm dark:[color-scheme:dark]" />
            </label>
            <label className="block space-y-1"><span className="text-[12px] text-muted-foreground">To</span>
              <input type="datetime-local" value={p.customUntil} onChange={(e) => p.setCustomUntil(e.target.value)} className="w-full min-h-[44px] px-3 rounded-md border border-input bg-background text-sm dark:[color-scheme:dark]" />
            </label>
          </div>
        )}
      </Section>

      <Section title="Sort">
        <div className="flex flex-wrap gap-1.5">
          {([["time", "desc", "Newest"], ["time", "asc", "Oldest"], ["who", "asc", "Who"], ["type", "asc", "Type"]] as const).map(([key, dir, label]) => (
            <button key={label} type="button" onClick={() => p.setSort({ key, dir })} aria-pressed={p.sort.key === key && p.sort.dir === dir} data-testid={`ops-content-sort-${label.toLowerCase()}`} className={pill(p.sort.key === key && p.sort.dir === dir)}>{label}</button>
          ))}
        </div>
      </Section>

      <div className="flex items-center justify-between gap-2 pt-1">
        <Button type="button" variant="ghost" className="min-h-[44px] rounded-full px-4" onClick={() => { setFilters({ kinds: [], people: [], hashtags: [] }); p.setRange("any"); }} data-testid="ops-filter-clear">Clear all</Button>
        <Button type="button" className="min-h-[44px] rounded-full px-6" onClick={() => setOpen(false)} data-testid="ops-filter-done">Done</Button>
      </div>
    </div>
  );

  const trigger = (
    <Button type="button" variant="outline" className="relative h-11 w-11 p-0 sm:h-10 sm:w-auto sm:px-3.5 rounded-full shrink-0 text-[13px]" aria-label={p.activeCount ? `Filter — ${p.activeCount} on` : "Filter"} data-active={p.activeCount > 0} data-testid="ops-events-filter" onClick={p.wide ? undefined : () => setOpen(true)}>
      <span className="sr-only sm:not-sr-only">Filter</span>
      {p.activeCount > 0 && <span className="absolute -top-1 -right-1 sm:static sm:ml-1.5 inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-brand px-1 text-[11px] font-semibold text-white">{p.activeCount}</span>}
      <svg className="w-4 h-4 sm:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
    </Button>
  );

  if (!p.wide) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <SheetTitle className="mb-4 text-[17px]">Filter</SheetTitle>
            {body}
          </SheetContent>
        </Sheet>
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-[26rem] max-h-[min(80dvh,44rem)] overflow-y-auto p-4">{body}</PopoverContent>
    </Popover>
  );
}

/** Saved views: reopen a set of filters in one tap; save the current one under a name. */
export function ViewsMenu({ views, onOpen, onSave, onDelete, canSave }: {
  views: SavedView[];
  onOpen: (v: SavedView) => void;
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
  canSave: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="min-h-[44px] sm:min-h-9 px-3 text-[13px]" data-testid="ops-content-views-menu">
          <Bookmark className="w-4 h-4 mr-1.5" aria-hidden="true" />Views{views.length ? <span className="ml-1 tabular-nums text-muted-foreground">{views.length}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        {views.length === 0 ? (
          <p className="px-2 py-2 text-[13px] text-muted-foreground">No saved views yet. Filter the list, then save it here.</p>
        ) : (
          <ul className="space-y-0.5" data-testid="ops-content-saved-views">
            {views.map((v) => (
              <li key={v.id} className="flex items-center gap-1">
                <button type="button" onClick={() => { onOpen(v); setOpen(false); }} className="flex-1 min-h-[44px] px-2 rounded-md text-left text-[14px] hover:bg-muted truncate" data-testid="ops-content-saved-view">{v.name}</button>
                <button type="button" onClick={() => onDelete(v.id)} className="inline-flex items-center justify-center w-11 h-11 rounded-md text-muted-foreground hover:text-foreground" aria-label={`Delete ${v.name}`}><Trash2 className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
        )}
        <form className="mt-2 flex gap-1.5 border-t border-border pt-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onSave(name); setName(""); } }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={canSave ? "Name this view" : "Filter first, then save"} disabled={!canSave} className="min-h-[44px] flex-1" aria-label="Name this view" data-testid="ops-content-view-name" />
          <Button type="submit" disabled={!canSave || !name.trim()} className="min-h-[44px] rounded-full px-4" data-testid="ops-content-view-save">Save</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
