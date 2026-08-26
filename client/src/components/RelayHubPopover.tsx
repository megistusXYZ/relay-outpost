import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "@/hooks/use-toast";
import { Lock, Globe, Satellite, Check, Radio, ChevronRight, SlidersHorizontal } from "lucide-react";

function RelayHubIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4.91003 11.8396C9.21003 8.51961 14.8 8.51961 19.1 11.8396" />
      <path d="M2 8.35961C8.06 3.67961 15.94 3.67961 22 8.35961" />
      <path d="M6.79004 15.4902C9.94004 13.0502 14.05 13.0502 17.2 15.4902" />
      <path d="M9.40002 19.1494C10.98 17.9294 13.03 17.9294 14.61 19.1494" />
    </svg>
  );
}
import {
  getOutpostRelays,
  getDisabledRelays,
  getPublishRelayPreference,
  savePublishRelayPreference,
  type PublishRelayPreference,
  type RelayPreset,
} from "@/lib/outpost-relays";

const PUBLISH_PRESETS: { key: RelayPreset; label: string; description: string; icon: typeof Satellite; dotColor: string }[] = [
  { key: "all", label: "All Relays", description: "Broadcast everywhere", icon: Satellite, dotColor: "bg-brand" },
  { key: "private", label: "Private Only", description: "Private outpost relays", icon: Lock, dotColor: "bg-amber-400" },
  { key: "public", label: "Public Only", description: "Default & public relays", icon: Globe, dotColor: "bg-green-400" },
];

function getModeIconColor(preset: RelayPreset): { text: string; hover: string; glow: string } | null {
  switch (preset) {
    case "private": return {
      text: "text-amber-500/80 dark:text-amber-400/70",
      hover: "hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-500/10 dark:hover:bg-amber-400/10",
      glow: "drop-shadow-[0_0_4px_rgba(245,158,11,0.3)]",
    };
    case "public": return {
      text: "text-green-500/80 dark:text-green-400/70",
      hover: "hover:text-green-500 dark:hover:text-green-400 hover:bg-green-500/10 dark:hover:bg-green-400/10",
      glow: "drop-shadow-[0_0_4px_rgba(34,197,94,0.3)]",
    };
    case "all": return {
      text: "text-brand/80 dark:text-brand/70",
      hover: "hover:text-brand hover:bg-brand/10",
      glow: "drop-shadow-[0_0_4px_rgba(168,85,247,0.3)]",
    };
    case "custom": return {
      text: "text-slate-500/80 dark:text-slate-400/70",
      hover: "hover:text-slate-500 dark:hover:text-slate-400 hover:bg-slate-500/10 dark:hover:bg-slate-400/10",
      glow: "drop-shadow-[0_0_4px_rgba(100,116,139,0.25)]",
    };
    default: return null;
  }
}

function HubContent({
  preset,
  hasPublishToggle,
  hasAdminRelays,
  onPresetChange,
  onNavigate,
  onClose,
}: {
  preset: RelayPreset;
  hasPublishToggle: boolean;
  hasAdminRelays: boolean;
  onPresetChange: (p: RelayPreset) => void;
  onNavigate: (path: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {hasPublishToggle && (
        <>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground/40 font-medium px-1 pt-0.5 pb-1">
            Publish Mode
          </p>
          <div className="space-y-0.5">
            {PUBLISH_PRESETS.map(({ key, label, description, icon: Icon, dotColor }) => {
              const active = preset === key;
              return (
                <button
                  key={key}
                  onClick={() => {
                    onPresetChange(key);
                    onClose();
                  }}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-150 text-left group min-h-[40px] ${
                    active
                      ? "bg-brand/10 border border-brand/20"
                      : "border border-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.03] hover:border-black/[0.06] dark:hover:border-white/[0.06]"
                  }`}
                  data-testid={`relay-hub-preset-${key}`}
                >
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                    active ? "bg-brand/15 text-brand" : "bg-black/[0.04] dark:bg-white/[0.04] text-muted-foreground/50"
                  }`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`text-[13px] font-medium block leading-tight ${
                      active ? "text-brand" : "text-foreground/80"
                    }`}>{label}</span>
                    <span className="text-[10px] text-muted-foreground/40 leading-tight">{description}</span>
                  </div>
                  {active && (
                    <div className="w-4 h-4 rounded-full bg-brand/20 flex items-center justify-center shrink-0">
                      <Check className="w-2.5 h-2.5 text-brand" />
                    </div>
                  )}
                  {!active && (
                    <div className={`w-2.5 h-2.5 rounded-full ${dotColor} opacity-50 shrink-0`} />
                  )}
                </button>
              );
            })}
          </div>
          {preset === "custom" && (
            <div className="flex items-center gap-2.5 px-2.5 py-1.5 mt-0.5">
              <SlidersHorizontal className="w-3 h-3 text-slate-400/60 shrink-0" />
              <span className="text-[10px] text-slate-400/60 font-medium">Custom selection active</span>
            </div>
          )}
          <div className="h-px bg-black/[0.06] dark:bg-white/[0.06] my-1" />
        </>
      )}

      <button
        onClick={() => { onNavigate("/relays"); onClose(); }}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-150 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.03] border border-transparent hover:border-black/[0.06] dark:hover:border-white/[0.06] min-h-[40px]"
        data-testid="relay-hub-manage-link"
      >
        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-black/[0.04] dark:bg-white/[0.04] text-muted-foreground/50">
          <Satellite className="w-3.5 h-3.5" />
        </div>
        <span className="text-[13px] font-medium text-foreground/80 flex-1">Manage Relays</span>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />
      </button>

      {hasAdminRelays && (
        <button
          onClick={() => { onNavigate("/relays/admin"); onClose(); }}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-150 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.03] border border-transparent hover:border-black/[0.06] dark:hover:border-white/[0.06] min-h-[40px]"
          data-testid="relay-hub-admin-link"
        >
          <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-brand/10 text-brand/70 dark:text-brand/80">
            <Radio className="w-3.5 h-3.5" />
          </div>
          <span className="text-[13px] font-medium text-foreground/80 flex-1">Relay Control</span>
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />
        </button>
      )}
    </div>
  );
}

export function RelayHubHeaderControl() {
  const [location, navigate] = useLocation();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const [hasOutpostRelays, setHasOutpostRelays] = useState(() => getOutpostRelays().length > 0);
  const [hasAdminRelays, setHasAdminRelays] = useState(() => getOutpostRelays().some(r => r.isAdmin));
  const [hasPrivateOutpost, setHasPrivateOutpost] = useState(() => {
    const disabled = getDisabledRelays();
    return getOutpostRelays().some(r => r.access === "private" && !disabled.has(r.url));
  });
  const [preset, setPreset] = useState<RelayPreset>(() => getPublishRelayPreference().preset);

  const prefersReducedMotion = useMemo(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);

  useEffect(() => {
    const refresh = () => {
      const relays = getOutpostRelays();
      const disabled = getDisabledRelays();
      setHasOutpostRelays(relays.length > 0);
      setHasAdminRelays(relays.some(r => r.isAdmin));
      setHasPrivateOutpost(relays.some(r => r.access === "private" && !disabled.has(r.url)));
      setPreset(getPublishRelayPreference().preset);
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("outpost-relays-changed", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("outpost-relays-changed", refresh);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setPreset(getPublishRelayPreference().preset);
      const relays = getOutpostRelays();
      const disabled = getDisabledRelays();
      setHasPrivateOutpost(relays.some(r => r.access === "private" && !disabled.has(r.url)));
      setHasAdminRelays(relays.some(r => r.isAdmin));
    }
  }, [open]);

  const handlePresetChange = useCallback((newPreset: RelayPreset) => {
    const newPref: PublishRelayPreference = { preset: newPreset, selectedUrls: [] };
    savePublishRelayPreference(newPref);
    setPreset(newPreset);

    const messages: Record<string, string> = {
      all: "Publishing to all relays",
      private: "Publishing to private relays only",
      public: "Publishing to public relays only",
    };
    toast({
      title: messages[newPreset] || "Publish mode updated",
      duration: 2000,
    });

    window.dispatchEvent(new CustomEvent("outpost-relays-changed"));
  }, []);

  if (!hasOutpostRelays || !hasPrivateOutpost) return null;

  const isAdminRoute = location.startsWith("/relays/admin");
  const modeColor = hasPrivateOutpost ? getModeIconColor(preset) : null;

  const triggerClassName = `relative w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-300 cursor-pointer shrink-0 ${
    isAdminRoute
      ? "text-brand bg-brand/10"
      : modeColor
        ? `${modeColor.text} ${modeColor.hover} hover:scale-110`
        : "text-brand/70 dark:text-brand/60 hover:text-brand-strong hover:bg-brand/10 hover:scale-110"
  }`;
  const triggerIcon = (
    <RelayHubIcon className={`w-[18px] h-[18px] ${
      isAdminRoute
        ? "drop-shadow-[0_0_4px_rgba(168,85,247,0.35)]"
        : modeColor
          ? modeColor.glow
          : prefersReducedMotion ? "" : "relay-ops-glow-icon"
    }`} />
  );

  const hubProps = {
    preset,
    hasPublishToggle: hasPrivateOutpost,
    hasAdminRelays,
    onPresetChange: handlePresetChange,
    onNavigate: navigate,
    onClose: () => setOpen(false),
  };

  if (isMobile) {
    return (
      <>
        <button
          className={triggerClassName}
          onClick={() => setOpen(true)}
          title="Relay Hub"
          aria-label="Relay Hub"
          data-testid="header-relay-hub"
        >
          {triggerIcon}
        </button>
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="glass-dialog-card border-brand/15 px-4 pb-6 pt-2">
            <div className="flex items-center gap-2 px-1 py-2 mb-1">
              <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${
                modeColor ? `${modeColor.text} bg-black/5 dark:bg-white/5 border-black/[0.08] dark:border-white/[0.06]` : "bg-brand/10 border-brand/20"
              }`}>
                <RelayHubIcon className={`w-4 h-4 ${modeColor ? "" : "text-brand/80"}`} />
              </div>
              <div>
                <span className="font-brand uppercase tracking-widest text-xs block">Relay Hub</span>
                <span className="text-[10px] text-muted-foreground/40 block leading-tight">Manage your broadcast settings</span>
              </div>
            </div>
            <HubContent {...hubProps} />
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={triggerClassName}
          title="Relay Hub"
          aria-label="Relay Hub"
          data-testid="header-relay-hub"
        >
          {triggerIcon}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[240px] p-2.5 glass-dialog-card border-brand/15 shadow-xl"
        data-testid="relay-hub-popover"
      >
        <HubContent {...hubProps} />
      </PopoverContent>
    </Popover>
  );
}
