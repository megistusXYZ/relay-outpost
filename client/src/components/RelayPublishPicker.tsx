import { useState, useEffect, useMemo, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Radio, Lock, Globe, Satellite, Check, ChevronDown, Compass } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocation } from "wouter";
import {
  getOutpostRelays,
  getActiveDefaultRelays,
  getDisabledRelays,
  getPublishRelayPreference,
  savePublishRelayPreference,
  resolvePublishRelays,
  getPresetLabel,
  type PublishRelayPreference,
  type RelayPreset,
} from "@/lib/outpost-relays";

// Remembers the user's curated outpost picks across an off/on flick of the
// "Also post to Outposts" switch, so toggling is reversible instead of a
// preset jump that wipes a hand-built selection. Device-local by design.
const OUTPOST_STASH_KEY = "relay-outpost-publish-outpost-stash";

interface RelayPublishPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPreferenceChange?: (pref: PublishRelayPreference) => void;
}

const PRESETS: { key: RelayPreset; label: string; icon: React.ReactNode; activeClasses: string; checkBg: string; checkIcon: string; iconActive: string }[] = [
  {
    key: "all", label: "All Relays", icon: <Satellite className="w-3.5 h-3.5" />,
    activeClasses: "border-primary/40 bg-primary/10 text-primary dark:text-brand shadow-[0_0_12px_-3px_rgba(168,85,247,0.25)]",
    checkBg: "bg-primary/20 dark:bg-brand/20", checkIcon: "text-primary dark:text-brand", iconActive: "text-primary dark:text-brand",
  },
  {
    key: "private", label: "Private Only", icon: <Lock className="w-3.5 h-3.5" />,
    activeClasses: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 shadow-[0_0_12px_-3px_rgba(245,158,11,0.25)]",
    checkBg: "bg-amber-500/20", checkIcon: "text-amber-800", iconActive: "text-amber-600 dark:text-amber-400",
  },
  {
    key: "public", label: "Public Only", icon: <Globe className="w-3.5 h-3.5" />,
    activeClasses: "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300 shadow-[0_0_12px_-3px_rgba(34,197,94,0.25)]",
    checkBg: "bg-green-500/20", checkIcon: "text-green-800", iconActive: "text-green-600 dark:text-green-400",
  },
];

function PickerBody({
  pref,
  resolvedUrls,
  hasPrivateRelays,
  outpostRelays,
  defaultRelays,
  disabledUrls,
  handlePreset,
  handleToggleRelay,
  handleOutpostToggle,
  handleDeselectAll,
  onClose,
  onBrowseOutposts,
}: {
  pref: PublishRelayPreference;
  resolvedUrls: Set<string>;
  hasPrivateRelays: boolean;
  outpostRelays: ReturnType<typeof getOutpostRelays>;
  defaultRelays: string[];
  disabledUrls: Set<string>;
  handlePreset: (preset: RelayPreset) => void;
  handleToggleRelay: (url: string, checked: boolean) => void;
  handleOutpostToggle: (checked: boolean) => void;
  handleDeselectAll: () => void;
  onClose: () => void;
  onBrowseOutposts: () => void;
}) {
  const hasOutposts = outpostRelays.length > 0;
  const enabledOutposts = outpostRelays.filter((r) => !disabledUrls.has(r.url));
  const outpostsSelectedCount = enabledOutposts.filter((r) => resolvedUrls.has(r.url)).length;
  const defaultsSelectedCount = defaultRelays.filter((url) => resolvedUrls.has(url)).length;
  const includesAnyOutpost = outpostsSelectedCount > 0;
  // Honest count: "3 of 16" when a subset is selected, plain total otherwise
  // (off = "16 available"; on-with-all = "posting to all 16").
  const outpostCountLabel =
    outpostsSelectedCount > 0 && outpostsSelectedCount < enabledOutposts.length
      ? `${outpostsSelectedCount} of ${enabledOutposts.length}`
      : `${enabledOutposts.length}`;

  return (
    <>
      {hasOutposts ? (
        <>
          <div
            className="flex items-center justify-between gap-3 px-2.5 py-2.5 rounded-lg border border-brand/20 bg-brand/[0.04]/[0.06]"
            data-testid="container-outpost-toggle"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-md bg-brand/15 flex items-center justify-center shrink-0">
                <Satellite className="w-3.5 h-3.5 text-brand/90" />
              </div>
              <div className="min-w-0">
                <span className="block text-[12px] sm:text-[13px] font-medium text-foreground/90 truncate">
                  Also post to Communities ({outpostCountLabel})
                </span>
                <span className="block text-[10px] sm:text-[11px] text-muted-foreground/55 truncate">
                  {includesAnyOutpost ? "Reaching your communities + defaults" : "Posting only to default relays"}
                </span>
              </div>
            </div>
            <Switch
              checked={includesAnyOutpost}
              onCheckedChange={handleOutpostToggle}
              data-testid="switch-also-post-outposts"
              className="shrink-0 data-[state=checked]:bg-primary dark:data-[state=checked]:bg-brand"
            />
          </div>

          <div className="grid grid-cols-3 gap-1.5 sm:gap-2 px-1" data-testid="container-relay-presets">
            {PRESETS.map(({ key, label, icon, activeClasses, checkBg, checkIcon, iconActive }) => {
              if (key === "private" && !hasPrivateRelays) return null;
              const active = pref.preset === key;
              return (
                <button
                  key={key}
                  className={`relative flex flex-col items-center gap-1 sm:gap-1.5 py-3 sm:py-3 px-2 rounded-lg border transition-all duration-200 text-center min-h-[52px]
                    ${active
                      ? activeClasses
                      : "border-black/[0.08] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.02] text-muted-foreground/70 hover:border-black/[0.14] dark:hover:border-white/[0.12] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                    }`}
                  onClick={() => handlePreset(key)}
                  data-testid={`button-preset-${key}`}
                >
                  {active && (
                    <div className={`absolute top-1 right-1 sm:top-1.5 sm:right-1.5 w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full ${checkBg} flex items-center justify-center`}>
                      <Check className={`w-2 h-2 sm:w-2.5 sm:h-2.5 ${checkIcon}`} />
                    </div>
                  )}
                  <span className={`${active ? iconActive : "text-muted-foreground/50"}`}>{icon}</span>
                  <span className="text-[10px] sm:text-[11px] font-medium leading-tight">{label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-start gap-1.5 mt-1 px-1">
            <button
              onClick={() => handlePreset("all")}
              className="text-[10px] sm:text-[11px] font-medium text-brand hover:text-brand/80 dark:hover:text-brand transition-colors px-1.5 py-0.5 rounded hover:bg-brand/10"
              data-testid="button-select-all-relays"
            >
              Select All
            </button>
            <span className="text-muted-foreground/20 text-[10px]">|</span>
            <button
              onClick={handleDeselectAll}
              className="text-[10px] sm:text-[11px] font-medium text-muted-foreground/60 hover:text-foreground/70 transition-colors px-1.5 py-0.5 rounded hover:bg-muted/30"
              data-testid="button-deselect-all-relays"
            >
              Deselect All
            </button>
          </div>
        </>
      ) : (
        <button
          onClick={onBrowseOutposts}
          className="flex items-center justify-between gap-3 px-2.5 py-2.5 rounded-lg border border-brand/20 bg-brand/[0.04]/[0.06] hover:border-brand/35 hover:bg-brand/[0.08]/[0.08] transition-colors text-left"
          data-testid="button-discover-outposts-empty"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-md bg-brand/15 flex items-center justify-center shrink-0">
              <Compass className="w-3.5 h-3.5 text-brand/90" />
            </div>
            <div className="min-w-0">
              <span className="block text-[12px] sm:text-[13px] font-medium text-foreground/90 truncate">
                Discover Outposts
              </span>
              <span className="block text-[10px] sm:text-[11px] text-muted-foreground/55 truncate">
                Community relays for topics & groups you care about
              </span>
            </div>
          </div>
          <span className="text-[11px] font-medium text-brand/90 shrink-0 pr-1">Browse →</span>
        </button>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 mt-1.5 px-1" data-testid="container-relay-list">
        {hasOutposts && (
          <CollapsibleRelayGroup
            label="Outpost Relays"
            count={enabledOutposts.length}
            storageKey="picker-section-outposts-collapsed"
            defaultCollapsed={false}
          >
            {outpostRelays.map((relay) => {
              const isDisabled = disabledUrls.has(relay.url);
              return (
                <RelayItem
                  key={relay.url}
                  url={relay.url}
                  label={relay.label}
                  access={relay.access}
                  checked={!isDisabled && resolvedUrls.has(relay.url)}
                  onToggle={handleToggleRelay}
                  disabled={isDisabled}
                />
              );
            })}
          </CollapsibleRelayGroup>
        )}

        {defaultRelays.length > 0 && (
          <CollapsibleRelayGroup
            label="Default Relays"
            count={defaultRelays.length}
            storageKey="picker-section-defaults-collapsed"
            defaultCollapsed={hasOutposts}
          >
            {defaultRelays.map((url) => (
              <RelayItem
                key={url}
                url={url}
                checked={resolvedUrls.has(url)}
                onToggle={handleToggleRelay}
              />
            ))}
          </CollapsibleRelayGroup>
        )}

        {outpostRelays.length === 0 && defaultRelays.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Satellite className="w-8 h-8 text-muted-foreground/20 mb-2" />
            <p className="text-sm text-muted-foreground/50">No relays configured.</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-3 mt-2 border-t border-black/[0.08] dark:border-white/[0.06] px-1">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${resolvedUrls.size > 0 ? "bg-green-400/80" : "bg-muted-foreground/30"}`} />
            <span className="text-[11px] sm:text-xs text-muted-foreground/70 truncate">
              {hasOutposts && outpostsSelectedCount > 0 ? (
                <>
                  <span className="font-medium text-brand">{outpostsSelectedCount}</span>{" "}
                  Outpost{outpostsSelectedCount !== 1 ? "s" : ""}
                  {defaultsSelectedCount > 0 && (
                    <>
                      <span className="text-muted-foreground/40 mx-1">·</span>
                      <span className="font-medium text-foreground/70">{defaultsSelectedCount}</span>{" "}
                      Default{defaultsSelectedCount !== 1 ? "s" : ""}
                    </>
                  )}
                </>
              ) : (
                <>
                  {resolvedUrls.size} relay{resolvedUrls.size !== 1 ? "s" : ""} selected
                </>
              )}
              {/* Public posts also land on the user's advertised NIP-65 write
                  relays (the outbox floor in CreatePost) — say so, so a narrow
                  selection doesn't read as the complete broadcast list. */}
              {pref.preset !== "private" && (
                <>
                  <span className="text-muted-foreground/40 mx-1">·</span>
                  <span className="text-muted-foreground/50">+ your outbox</span>
                </>
              )}
            </span>
          </div>
          <span className="text-[9px] sm:text-[10px] text-muted-foreground/40 pl-3">Saved as your default</span>
        </div>
        <Button
          size="sm"
          className="h-10 sm:h-9 px-6 text-sm sm:text-sm font-medium"
          onClick={onClose}
          data-testid="button-relay-picker-done"
        >
          Done
        </Button>
      </div>
    </>
  );
}

export function RelayPublishPicker({ open, onOpenChange, onPreferenceChange }: RelayPublishPickerProps) {
  const isMobile = useIsMobile();
  const [, setLocation] = useLocation();
  const [pref, setPref] = useState<PublishRelayPreference>(getPublishRelayPreference);

  const outpostRelays = useMemo(() => getOutpostRelays(), [open]);
  const disabledUrls = useMemo(() => getDisabledRelays(), [open]);
  const defaultRelays = useMemo(() => {
    const active = getActiveDefaultRelays();
    const outpostUrls = new Set(outpostRelays.map((r) => r.url));
    return active.filter((url) => !outpostUrls.has(url));
  }, [open, outpostRelays]);

  useEffect(() => {
    if (open) {
      setPref(getPublishRelayPreference());
    }
  }, [open]);

  const handlePreset = useCallback((preset: RelayPreset) => {
    const newPref: PublishRelayPreference = { preset, selectedUrls: [] };
    setPref(newPref);
    savePublishRelayPreference(newPref);
    onPreferenceChange?.(newPref);
    window.dispatchEvent(new CustomEvent("outpost-relays-changed"));
  }, [onPreferenceChange]);

  const handleToggleRelay = useCallback((url: string, checked: boolean) => {
    setPref((prev) => {
      let selected: string[];
      if (prev.preset !== "custom") {
        const currentResolved = resolvePublishRelays(prev);
        selected = checked
          ? [...new Set([...currentResolved, url])]
          : currentResolved.filter((u) => u !== url);
      } else {
        selected = checked
          ? [...new Set([...prev.selectedUrls, url])]
          : prev.selectedUrls.filter((u) => u !== url);
      }
      const newPref: PublishRelayPreference = selected.length === 0
        ? { preset: "custom", selectedUrls: [], explicitEmpty: true }
        : { preset: "custom", selectedUrls: selected };
      savePublishRelayPreference(newPref);
      onPreferenceChange?.(newPref);
      setTimeout(() => window.dispatchEvent(new CustomEvent("outpost-relays-changed")), 0);
      return newPref;
    });
  }, [onPreferenceChange]);

  const handleDeselectAll = useCallback(() => {
    const newPref: PublishRelayPreference = { preset: "custom", selectedUrls: [], explicitEmpty: true };
    setPref(newPref);
    savePublishRelayPreference(newPref);
    onPreferenceChange?.(newPref);
    setTimeout(() => window.dispatchEvent(new CustomEvent("outpost-relays-changed")), 0);
  }, [onPreferenceChange]);

  // The "Also post to Outposts" switch preserves the user's curation instead of
  // jumping presets: OFF stashes the current outpost picks and keeps the
  // default-relay selection untouched; ON restores the stash (or selects all
  // enabled outposts if the user never curated a subset). A hand-built
  // "3 outposts + 4 defaults" selection survives an off/on flick intact.
  const handleOutpostToggle = useCallback((checked: boolean) => {
    setPref((prev) => {
      const current = resolvePublishRelays(prev);
      const outpostUrlSet = new Set(getOutpostRelays().map((r) => r.url));
      let selected: string[];
      if (!checked) {
        const stash = current.filter((u) => outpostUrlSet.has(u));
        try { localStorage.setItem(OUTPOST_STASH_KEY, JSON.stringify(stash)); } catch {}
        selected = current.filter((u) => !outpostUrlSet.has(u));
      } else {
        let stash: string[] = [];
        try { stash = JSON.parse(localStorage.getItem(OUTPOST_STASH_KEY) || "[]"); } catch {}
        const disabled = getDisabledRelays();
        const restorable = stash.filter((u) => outpostUrlSet.has(u) && !disabled.has(u));
        const toAdd = restorable.length > 0
          ? restorable
          : Array.from(outpostUrlSet).filter((u) => !disabled.has(u));
        selected = [...new Set([...current, ...toAdd])];
      }
      const newPref: PublishRelayPreference = selected.length === 0
        ? { preset: "custom", selectedUrls: [], explicitEmpty: true }
        : { preset: "custom", selectedUrls: selected };
      savePublishRelayPreference(newPref);
      onPreferenceChange?.(newPref);
      setTimeout(() => window.dispatchEvent(new CustomEvent("outpost-relays-changed")), 0);
      return newPref;
    });
  }, [onPreferenceChange]);

  const resolvedUrls = useMemo(() => new Set(resolvePublishRelays(pref)), [pref]);
  const hasPrivateRelays = outpostRelays.some((r) => r.access === "private" && !disabledUrls.has(r.url));

  const headerContent = (
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center">
        <Radio className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-brand/80" />
      </div>
      <div>
        <span className="font-brand uppercase tracking-widest text-xs sm:text-sm block">Publish To</span>
        <span className="text-[10px] text-muted-foreground/40 block leading-tight">Choose your broadcast targets</span>
      </div>
    </div>
  );

  const bodyProps = {
    pref,
    resolvedUrls,
    hasPrivateRelays,
    outpostRelays,
    defaultRelays,
    disabledUrls,
    handlePreset,
    handleToggleRelay,
    handleOutpostToggle,
    handleDeselectAll,
    onClose: () => onOpenChange(false),
    onBrowseOutposts: () => { onOpenChange(false); setLocation("/outposts"); },
  };

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="glass-dialog-card border-border dark:border-brand/15 max-h-[85vh] px-4 pb-6">
          <DrawerHeader className="px-0 pt-2 pb-3 text-left">
            <DrawerTitle className="sr-only">Publish To</DrawerTitle>
            {headerContent}
          </DrawerHeader>
          <div className="flex flex-col gap-3 overflow-hidden flex-1">
            <PickerBody {...bodyProps} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-sm sm:max-w-[420px] glass-dialog-card border-border dark:border-brand/15 max-h-[80vh] overflow-hidden flex flex-col gap-3 p-5"
        data-testid="dialog-relay-picker"
      >
        <DialogHeader className="pb-0">
          <DialogTitle className="sr-only">Publish To</DialogTitle>
          {headerContent}
        </DialogHeader>
        <PickerBody {...bodyProps} />
      </DialogContent>
    </Dialog>
  );
}

function CollapsibleRelayGroup({
  label,
  count,
  children,
  storageKey,
  defaultCollapsed = false,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
  storageKey: string;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === "true") return true;
      if (stored === "false") return false;
    } catch {}
    return defaultCollapsed;
  });

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(storageKey, next ? "true" : "false"); } catch {}
      return next;
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1.5 w-full px-1 py-0.5 rounded hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors"
        data-testid={`section-toggle-${storageKey}`}
      >
        <ChevronDown
          className={`w-3 h-3 text-muted-foreground/40 transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
        />
        <span className="text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
          {label}
        </span>
        <span className="text-[9px] sm:text-[10px] text-muted-foreground/35 font-medium">·</span>
        <span className="text-[9px] sm:text-[10px] text-muted-foreground/40 font-medium">{count}</span>
      </button>
      {!collapsed && (
        <div className="space-y-0.5 mt-1.5">
          {children}
        </div>
      )}
    </div>
  );
}

function RelayItem({
  url,
  label,
  access,
  checked,
  onToggle,
  disabled = false,
}: {
  url: string;
  label?: string;
  access?: "public" | "private";
  checked: boolean;
  onToggle: (url: string, checked: boolean) => void;
  disabled?: boolean;
}) {
  const displayUrl = url.replace("wss://", "").replace(/\/$/, "");

  return (
    <label
      className={`flex items-center gap-3 px-2.5 sm:px-3 py-2.5 sm:py-2.5 rounded-lg transition-all duration-150 group min-h-[44px] ${disabled ? "opacity-45 cursor-not-allowed border border-transparent" : checked ? "bg-brand/[0.06] border border-brand/15/[0.06] cursor-pointer" : "bg-transparent border border-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.03] hover:border-black/[0.08] dark:hover:border-white/[0.06] cursor-pointer" }`}
      data-testid={`relay-item-${displayUrl}`}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(val) => { if (!disabled) onToggle(url, !!val); }}
        disabled={disabled}
        className="shrink-0 h-4 w-4 sm:h-[18px] sm:w-[18px] rounded border-black/20 dark:border-white/20 data-[state=checked]:bg-primary data-[state=checked]:border-primary dark:data-[state=checked]:bg-brand dark:data-[state=checked]:border-brand"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {label ? (
            <span className={`text-[13px] sm:text-sm font-medium truncate ${disabled ? "text-muted-foreground/50" : "text-foreground/90"}`}>{label}</span>
          ) : (
            <span className={`text-[13px] sm:text-sm truncate font-mono ${disabled ? "text-muted-foreground/40" : "text-foreground/75"}`}>{displayUrl}</span>
          )}
          {access && (
            <Badge
              variant="outline"
              className={`text-[8px] sm:text-[9px] px-1.5 py-0 h-4 shrink-0 gap-0.5 ${
                access === "private"
                  ? "border-amber-500/30 text-amber-600 dark:text-amber-500/80 bg-amber-500/[0.06]"
                  : "border-green-500/30 text-green-600 dark:text-green-500/80 bg-green-500/[0.06]"
              }`}
            >
              {access === "private" ? (
                <Lock className="w-2 h-2 sm:w-2.5 sm:h-2.5" />
              ) : (
                <Globe className="w-2 h-2 sm:w-2.5 sm:h-2.5" />
              )}
              {access}
            </Badge>
          )}
          {disabled && (
            <Badge variant="outline" className="text-[8px] sm:text-[9px] px-1.5 py-0 h-4 shrink-0 border-muted-foreground/20 text-muted-foreground/50">
              Disabled
            </Badge>
          )}
        </div>
        {label && (
          <span className={`text-[9px] sm:text-[10px] truncate block font-mono mt-0.5 ${disabled ? "text-muted-foreground/25" : "text-muted-foreground/40"}`}>{displayUrl}</span>
        )}
      </div>
    </label>
  );
}

export function usePublishRelayPreference() {
  const [pref, setPref] = useState<PublishRelayPreference>(getPublishRelayPreference);

  const relays = useMemo(() => resolvePublishRelays(pref), [pref]);
  const label = useMemo(() => getPresetLabel(pref), [pref]);

  const refresh = useCallback(() => {
    setPref(getPublishRelayPreference());
  }, []);

  useEffect(() => {
    const sync = () => setPref(getPublishRelayPreference());
    window.addEventListener("outpost-relays-changed", sync);
    return () => window.removeEventListener("outpost-relays-changed", sync);
  }, []);

  const updatePref = useCallback((newPref: PublishRelayPreference) => {
    setPref(newPref);
  }, []);

  return { pref, relays, label, refresh, updatePref };
}
