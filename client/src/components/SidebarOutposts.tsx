import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ChevronDown, ChevronRight, Gauge, GripVertical, Pencil, RotateCcw } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/components/ui/sidebar";
import { getOutpostRelays, reorderOutpostRelays, setBadgeCustomName, getBadgeDisplayName, type OutpostRelay } from "@/lib/outpost-relays";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getPinnedFeeds, groupPinsByRelay, pinUrl, type PinnedFeed } from "@/lib/pinned-feeds";
import { TAB_ICON, pinDisplayLabel } from "@/lib/pin-meta";
import { OutpostIcon } from "@/components/icons/OutpostIcon";

// Reddit-style "your communities" tree. Your joined outposts are the communities;
// each expands to the sub-views you've pinned (Timeline / Waves / Channels /
// Horizon) for quick hopping. All data + persistence already exist in
// outpost-relays.ts and pinned-feeds.ts — this just surfaces them in the sidebar.

const SECTION_KEY = "relay-outpost-sidebar-outposts-open";
const OPS_SECTION_KEY = "relay-outpost-sidebar-ops-open";
// Master fold for the whole Outposts subtree (Relays you run + Joined). Lets a
// long relay list collapse in one click; each sub-section keeps its own state.
const MASTER_KEY = "relay-outpost-sidebar-outposts-master-open";
// Pinned channels under an outpost show EXPANDED by default (no extra click to
// see what's there — Cooper's excise); this stores the urls the user has chosen
// to collapse, so the list is open by default and the choice persists.
const PINS_COLLAPSED_KEY = "relay-outpost-sidebar-pins-collapsed";

function normalize(u: string): string {
  return u.replace(/\/+$/, "").toLowerCase();
}

export function SidebarOutposts({
  closeMobileNav,
  operatorIndicator,
  filterQuery,
}: {
  closeMobileNav: () => void;
  operatorIndicator?: ReactNode;
  /**
   * Optional case-insensitive live filter over community names (used by the
   * desktop rail's Communities flyout search). Empty/undefined = full list.
   * While a filter is active the sub-sections are forced open so matches are
   * always visible regardless of the user's saved collapse state.
   */
  filterQuery?: string;
}) {
  const [location] = useLocation();
  const { pubkey } = useNostrAuth();
  const [outposts, setOutposts] = useState<OutpostRelay[]>(() => getOutpostRelays());
  const [pins, setPins] = useState<PinnedFeed[]>(() => getPinnedFeeds());
  const [sectionOpen, setSectionOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(SECTION_KEY) !== "0"; } catch { return true; }
  });
  const [opsSectionOpen, setOpsSectionOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(OPS_SECTION_KEY) !== "0"; } catch { return true; }
  });
  const [masterOpen, setMasterOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(MASTER_KEY) !== "0"; } catch { return true; }
  });
  const [collapsedPins, setCollapsedPins] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(PINS_COLLAPSED_KEY);
      return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
    } catch { return new Set<string>(); }
  });

  useEffect(() => {
    const sync = () => { setOutposts(getOutpostRelays()); setPins(getPinnedFeeds()); };
    window.addEventListener("outpost-relays-changed", sync);
    window.addEventListener("pinned-feeds-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("outpost-relays-changed", sync);
      window.removeEventListener("pinned-feeds-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const pinsByRelay = useMemo(() => groupPinsByRelay(pins), [pins]);

  // Rename (per-user alias, reuses the badge-name store) + drag-to-reorder.
  const [renamingUrl, setRenamingUrl] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const dragUrlRef = useRef<string | null>(null);
  const [dragOverUrl, setDragOverUrl] = useState<string | null>(null);

  const nameFor = useCallback((o: OutpostRelay) => getBadgeDisplayName(pubkey ?? "", o.url, o.label), [pubkey]);

  const startRename = useCallback((o: OutpostRelay) => {
    setRenameDraft(getBadgeDisplayName(pubkey ?? "", o.url, o.label));
    setRenamingUrl(o.url);
  }, [pubkey]);

  const commitRename = useCallback(() => {
    setRenamingUrl((url) => {
      if (url && pubkey) {
        setBadgeCustomName(pubkey, url, renameDraft.trim());
        window.dispatchEvent(new CustomEvent("outpost-relays-changed"));
      }
      return null;
    });
    setRenameDraft("");
  }, [pubkey, renameDraft]);


  const toggleSection = useCallback(() => setSectionOpen((v) => !v), []);
  const toggleOpsSection = useCallback(() => setOpsSectionOpen((v) => !v), []);
  const toggleMaster = useCallback(() => setMasterOpen((v) => !v), []);

  // Persist as a side effect (NOT inside the updater — StrictMode double-invokes
  // updaters, which would desync the stored value).
  useEffect(() => {
    try { localStorage.setItem(SECTION_KEY, sectionOpen ? "1" : "0"); } catch {}
  }, [sectionOpen]);
  useEffect(() => {
    try { localStorage.setItem(OPS_SECTION_KEY, opsSectionOpen ? "1" : "0"); } catch {}
  }, [opsSectionOpen]);
  useEffect(() => {
    try { localStorage.setItem(MASTER_KEY, masterOpen ? "1" : "0"); } catch {}
  }, [masterOpen]);

  useEffect(() => {
    try { localStorage.setItem(PINS_COLLAPSED_KEY, JSON.stringify(Array.from(collapsedPins))); } catch {}
  }, [collapsedPins]);

  const toggleOutpost = useCallback((url: string) => {
    setCollapsedPins((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url); else next.add(url);
      return next;
    });
  }, []);

  const decodedLocation = useMemo(() => {
    try { return decodeURIComponent(location); } catch { return location; }
  }, [location]);

  const q = (filterQuery ?? "").trim().toLowerCase();
  const filtering = q.length > 0;
  const matchesQuery = useCallback(
    (o: OutpostRelay) => !q || o.label.toLowerCase().includes(q),
    [q],
  );
  const operatedRelays = useMemo(
    () => outposts.filter((o) => o.isAdmin && matchesQuery(o)).sort((a, b) => a.label.localeCompare(b.label)),
    [outposts, matchesQuery],
  );
  // Communities you've joined (excluding the ones you operate — those live in
  // their own group above). Rendered in STORED order (not alphabetical) so the
  // user's manual drag-reordering sticks; new joins append to the end.
  const communityOutposts = useMemo(
    () => outposts.filter((o) => !o.isAdmin && matchesQuery(o)),
    [outposts, matchesQuery],
  );

  // While a filter is active, force every section open so matches always show
  // regardless of the user's saved collapse state; otherwise honor saved state.
  const effMasterOpen = filtering || masterOpen;
  const effOpsSectionOpen = filtering || opsSectionOpen;
  const effSectionOpen = filtering || sectionOpen;

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {/* Parent — links to the full browser to discover/join new outposts.
              The chevron is a master fold for both sub-groups below (Relays you
              run / Joined); each still keeps its own per-section toggle. */}
          <SidebarMenuItem>
            <div className="flex items-center">
              <SidebarMenuButton asChild isActive={location === "/outposts"} tooltip="Browse communities" className="flex-1">
                <Link href="/outposts" data-testid="link-sidebar-outposts" onClick={closeMobileNav}>
                  <OutpostIcon className="w-4 h-4" />
                  <span className="flex-1">Communities</span>
                  {operatorIndicator}
                </Link>
              </SidebarMenuButton>
              {pubkey && (operatedRelays.length > 0 || communityOutposts.length > 0) && (
                <button
                  type="button"
                  onClick={toggleMaster}
                  className="shrink-0 p-1 mr-1 rounded text-muted-foreground/40 hover:text-foreground transition-colors"
                  data-testid="button-sidebar-outposts-master-toggle"
                  aria-label={masterOpen ? "Collapse communities list" : "Expand communities list"}
                  aria-expanded={masterOpen}
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${masterOpen ? "" : "-rotate-90"}`} />
                </button>
              )}
            </div>
          </SidebarMenuItem>

          {/* Logged-out visitors see only the "Outposts" link — no counts and no
              expandable run/joined lists (those are personal to a signed-in user). */}
          {pubkey && effMasterOpen && (<>
          {/* Relays you operate — its own collapsible group, separate from the
              communities you've merely joined. Quick links into Relay Control. */}
          {operatedRelays.length > 0 && (
            <>
              <SidebarMenuItem>
                <button
                  type="button"
                  onClick={toggleOpsSection}
                  className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-[11px] font-mono font-semibold uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-300 hover:text-emerald-700 dark:hover:text-emerald-200 transition-colors"
                  data-testid="button-sidebar-ops-toggle"
                  aria-label="Toggle relays you run"
                >
                  <ChevronDown className={`w-3 h-3 shrink-0 transition-transform duration-200 ${effOpsSectionOpen ? "" : "-rotate-90"}`} />
                  <span className="flex-1 text-left">Relays you run</span>
                  <span className="tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{operatedRelays.length}</span>
                </button>
              </SidebarMenuItem>
              {effOpsSectionOpen && operatedRelays.map((o) => {
                const encoded = encodeURIComponent(o.url);
                const opsActive = decodedLocation.startsWith(`/relay-ops-center/${o.url.replace(/\/+$/, "")}`);
                return (
                  <SidebarMenuItem key={`ops-${o.url}`}>
                    <SidebarMenuButton asChild isActive={opsActive} tooltip={`Relay control · ${o.label}`} className="text-xs">
                      <Link href={`/relay-ops-center/${encoded}`} data-testid={`link-sidebar-relay-ops-${normalize(o.url).slice(0, 24)}`} onClick={closeMobileNav}>
                        <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
                          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/60 animate-ping" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        </span>
                        <span className="flex-1 truncate">{o.label}</span>
                        <Gauge className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </>
          )}

          {/* Outposts you've joined. Labeled "Joined" (not "Outposts") to avoid
              repeating the parent's word — both sub-groups instead name the
              user's relationship to the community ("Relays you run" / "Joined"),
              which is more scannable (Krug, omit needless words). */}
          {communityOutposts.length > 0 && (
            <SidebarMenuItem className={operatedRelays.length > 0 ? "mt-1" : ""}>
              <button
                type="button"
                onClick={toggleSection}
                className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-[11px] font-mono font-semibold uppercase tracking-[0.12em] text-brand hover:text-brand-strong transition-colors"
                data-testid="button-sidebar-communities-toggle"
                aria-label="Toggle joined communities"
              >
                <ChevronDown className={`w-3 h-3 shrink-0 transition-transform duration-200 ${effSectionOpen ? "" : "-rotate-90"}`} />
                <span className="flex-1 text-left">Joined</span>
                <span className="tabular-nums font-semibold text-brand">{communityOutposts.length}</span>
              </button>
            </SidebarMenuItem>
          )}

          {effSectionOpen && communityOutposts.map((o) => {
            const relayPins = pinsByRelay.get(normalize(o.url)) || [];
            const isExpanded = !collapsedPins.has(o.url); // pins visible by default; collapsible
            const encoded = encodeURIComponent(o.url);
            const active = decodedLocation.startsWith(`/outposts/${o.url.replace(/\/+$/, "")}`);
            const name = nameFor(o);
            const isRenaming = renamingUrl === o.url;
            const hasCustom = name !== o.label;
            return (
              <SidebarMenuItem key={o.url}>
                <div
                  className={`group/row flex items-center rounded-md ${dragOverUrl === o.url ? "shadow-[inset_0_2px_0_0_hsl(var(--primary))]" : ""}`}
                  onDragOver={filtering ? undefined : (e) => { e.preventDefault(); if (dragOverUrl !== o.url) setDragOverUrl(o.url); }}
                  onDragLeave={() => setDragOverUrl((u) => (u === o.url ? null : u))}
                  onDrop={filtering ? undefined : (e) => {
                    e.preventDefault();
                    const from = dragUrlRef.current; dragUrlRef.current = null; setDragOverUrl(null);
                    if (!from || from === o.url) return;
                    const urls = communityOutposts.map((c) => c.url);
                    const fromIdx = urls.indexOf(from);
                    if (fromIdx < 0) return;
                    urls.splice(fromIdx, 1);
                    const toIdx = urls.indexOf(o.url);
                    urls.splice(toIdx < 0 ? urls.length : toIdx, 0, from);
                    reorderOutpostRelays([...operatedRelays.map((r) => r.url), ...urls]);
                    setOutposts(getOutpostRelays());
                  }}
                >
                  {isRenaming ? (
                    <div className="flex flex-1 min-w-0 items-center gap-1 mx-1 my-0.5">
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitRename(); } else if (e.key === "Escape") { setRenamingUrl(null); setRenameDraft(""); } }}
                        onBlur={commitRename}
                        maxLength={60}
                        placeholder={o.label}
                        className="flex-1 min-w-0 h-7 px-2 rounded-md bg-muted/50 text-xs border border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/40"
                        data-testid={`input-rename-outpost-${normalize(o.url).slice(0, 24)}`}
                      />
                      {/* Quick reset to the relay's own name. onMouseDown keeps the
                          input focused so its onBlur doesn't commit the typed draft first. */}
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (pubkey) { setBadgeCustomName(pubkey, o.url, ""); window.dispatchEvent(new CustomEvent("outpost-relays-changed")); }
                          setRenamingUrl(null); setRenameDraft("");
                        }}
                        className="shrink-0 p-1 rounded text-muted-foreground/50 hover:text-foreground transition-colors"
                        aria-label="Reset to default name"
                        title="Reset to default name"
                        data-testid={`reset-outpost-${normalize(o.url).slice(0, 24)}`}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      {!filtering && (
                        <button
                          type="button"
                          draggable
                          onDragStart={() => { dragUrlRef.current = o.url; }}
                          onDragEnd={() => { dragUrlRef.current = null; setDragOverUrl(null); }}
                          className="shrink-0 cursor-grab active:cursor-grabbing p-0.5 -ml-0.5 text-muted-foreground/30 hover:text-muted-foreground/70 opacity-0 group-hover/row:opacity-100 transition-opacity"
                          aria-label={`Drag to reorder ${name}`}
                          title="Drag to reorder"
                          data-testid={`drag-outpost-${normalize(o.url).slice(0, 24)}`}
                        >
                          <GripVertical className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {/* No `tooltip` here: in the expanded flyout the name is
                          already visible, and the hover tooltip popped over the
                          ⋯ / grip controls on the right, blocking them. */}
                      <SidebarMenuButton asChild isActive={active} className="flex-1 min-w-0 text-xs">
                        <Link href={`/outposts/${encoded}`} data-testid={`link-sidebar-outpost-${normalize(o.url).slice(0, 24)}`} onClick={closeMobileNav}>
                          <span className="w-1.5 h-1.5 rounded-full bg-brand/50 shrink-0" />
                          <span className="flex-1 truncate">{name}</span>
                          {relayPins.length === 0 && o.access === "private" && (
                            <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/40">prv</span>
                          )}
                        </Link>
                      </SidebarMenuButton>
                      {/* Direct rename button (no dropdown): the flyout closes
                          on mouse-leave, so a portaled menu vanished before it
                          could be clicked. Pencil → inline rename, in-DOM.
                          hasCustom shows a reset affordance on the input itself. */}
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); startRename(o); }}
                        className="shrink-0 p-1 rounded text-muted-foreground/40 hover:text-foreground opacity-0 group-hover/row:opacity-100 transition-opacity"
                        aria-label={`Rename ${name}`}
                        title={hasCustom ? "Rename (clear to reset)" : "Rename"}
                        data-testid={`rename-outpost-${normalize(o.url).slice(0, 24)}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {relayPins.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleOutpost(o.url)}
                          className="shrink-0 p-1 mr-1 rounded text-muted-foreground/40 hover:text-foreground transition-colors"
                          data-testid={`button-sidebar-outpost-expand-${normalize(o.url).slice(0, 24)}`}
                          aria-label={`Toggle ${name} channels`}
                        >
                          <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`} />
                        </button>
                      )}
                    </>
                  )}
                </div>
                {isExpanded && relayPins.length > 0 && (
                  <SidebarMenuSub>
                    {relayPins.map((pin) => {
                      const Icon = TAB_ICON[pin.tab];
                      const label = pinDisplayLabel(pin);
                      return (
                        <SidebarMenuSubItem key={pin.id}>
                          <SidebarMenuSubButton asChild className="text-xs">
                            <Link href={pinUrl(pin)} data-testid={`link-sidebar-pin-${pin.id.slice(0, 32)}`} onClick={closeMobileNav}>
                              <Icon className="w-3 h-3 text-brand/70" />
                              <span className="flex-1 truncate">{label}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      );
                    })}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>
            );
          })}

          {filtering && operatedRelays.length === 0 && communityOutposts.length === 0 && (
            <SidebarMenuItem>
              <p className="px-2 py-2 text-xs text-muted-foreground/60" data-testid="sidebar-outposts-no-matches">
                No joined community matches. Press Enter to search all.
              </p>
            </SidebarMenuItem>
          )}
          </>)}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
