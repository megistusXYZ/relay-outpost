import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { MissionBriefing, SHIELD_MATRIX_BRIEFING } from "@/components/MissionBriefing";
import { use$ } from "applesauce-react/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useSpamFilter } from "@/hooks/use-spam-filter";
import { useNostrMuteList } from "@/hooks/use-nostr-mute-list";
import { eventStore, fetchProfilesCached } from "@/lib/nostr";
import {
  ShieldCheck, VolumeX, X, Plus, Flag,
  Search, ChevronDown, ChevronUp, RotateCcw, ArrowLeft, Lock,
  Check, AlertTriangle, Sliders,
} from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useStrictnessPreset, PRESET_DEFS } from "@/lib/trust-preset";
import { ShieldMatrixIcon } from "@/components/icons/ShieldMatrixIcon";
import { TrustTierGlyph } from "@/components/nostr-post/trust-tier-glyph";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { useToast } from "@/hooks/use-toast";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import {
  type SignalTier, type TierThresholds, getSignalTierLabel,
  DEFAULT_THRESHOLDS, isCustomTiersEnabled, setCustomTiersEnabled,
  getStoredCustomThresholds, saveCustomThresholds, resetCustomThresholds,
  triggerGrapeRankCalculation,
} from "@/lib/graperank";
import { type ReachDepth } from "@/lib/spam-filter";
import { mutePubkey as localMutePubkey, isMutedPubkey, onMuteChange } from "@/lib/spam-filter";
import { formatNpub, getProfileContent, KIND_METADATA } from "@/lib/nostr-helpers";
import { Link } from "wouter";
import { nip19 } from "nostr-tools";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface ProfileFields {
  display_name?: string;
  name?: string;
  picture?: string;
  about?: string;
  nip05?: string;
}

const TIER_FILTER_OPTIONS: SignalTier[] = ["strong", "moderate", "low", "weak", "none", "flagged"];

const REACH_DEPTH_OPTIONS: { value: ReachDepth; label: string; desc: string }[] = [
  { value: "1hop", label: "Inner Circle", desc: "Closest connections" },
  { value: "2hops", label: "Nearby", desc: "Friends of friends" },
  { value: "3hops", label: "Extended", desc: "Wider trusted network" },
  { value: "global", label: "Everyone", desc: "Any trust score" },
  { value: "off", label: "Off", desc: "No filtering" },
];

const CALIBRATION_TIERS: { key: keyof TierThresholds; tier: SignalTier; label: string; dotColor: string }[] = [
  { key: "strong", tier: "strong", label: "Highly Trusted", dotColor: "bg-emerald-500" },
  { key: "moderate", tier: "moderate", label: "Trusted", dotColor: "bg-blue-500" },
  { key: "low", tier: "low", label: "Neutral", dotColor: "bg-cyan-400/80" },
  { key: "weak", tier: "weak", label: "Low Trust", dotColor: "bg-amber-500" },
];

function ShieldSubSection({ title, description, children, className }: { title: string; description: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg p-3.5 space-y-2.5 ${className || ""}`}
      style={{ background: "rgba(140, 100, 220, 0.04)", border: "1px solid rgba(140, 100, 220, 0.12)" }}
    >
      <div>
        <p className="text-sm font-semibold text-foreground/85">{title}</p>
        <p className="text-xs text-muted-foreground/55 leading-relaxed mt-0.5">{description}</p>
      </div>
      {children}
    </div>
  );
}

function ShieldToggleRow({ label, description, checked, onToggle, testId }: { label: string; description: string; checked: boolean; onToggle: () => void; testId: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground/75">{label}</p>
        <p className="text-[10px] text-muted-foreground/50 mt-0.5 leading-relaxed">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={onToggle}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
          checked ? "bg-brand" : "bg-muted-foreground/30"
        }`}
        data-testid={testId}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function WotToggle() {
  const { wotEnabled, wotReady, setWotEnabled } = useGrapeRankScores();
  return (
    <div
      className="flex items-center justify-between rounded-lg p-4"
      style={{ background: wotEnabled ? "rgba(140, 100, 220, 0.08)" : "rgba(140, 100, 220, 0.04)", border: `1px solid ${wotEnabled ? "rgba(140, 100, 220, 0.25)" : "rgba(140, 100, 220, 0.12)"}` }}
      data-testid="wot-toggle-row"
    >
      <div className="flex-1 min-w-0 mr-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground/90">Web of Trust</p>
          {/* "Active" state is already covered by the header stat + the status
              line below, so we only surface the transient calculating state here. */}
          {wotEnabled && !wotReady && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-500/90 bg-amber-500/10 px-1.5 py-0.5 rounded-md border border-amber-500/15" data-testid="badge-wot-calculating">
              Calculating…
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground/60 leading-relaxed mt-1">
          {wotEnabled
            ? (wotReady
                ? "Scoring people from your social graph. All defenses below are on."
                : "Building your trust network — the first calculation takes about 15–20 minutes. Signals appear automatically when it's done.")
            : "Off — enable to turn on trust scoring, filtering, and all defenses below."}
        </p>
        <a
          href="https://brainstorm.nosfabrica.com/what-is-wot"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] font-medium text-brand/70 hover:text-brand-strong dark:hover:text-brand transition-colors mt-1.5"
        >
          Learn more about Web of Trust
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>
      </div>
      <button
        role="switch"
        aria-checked={wotEnabled}
        onClick={() => setWotEnabled(!wotEnabled)}
        className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
          wotEnabled ? "bg-brand" : "bg-muted-foreground/30"
        }`}
        data-testid="toggle-wot-enabled"
      >
        <span
          className={`pointer-events-none inline-block h-6 w-6 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${
            wotEnabled ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function formatRelativeTime(ts: number): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function WotDiagnosticsCard() {
  const { wotEnabled, diagnostics, retryAuth, clearCooldownAndRefresh, recalculating, notifyRecalculating } = useGrapeRankScores();
  const { pubkey, follows } = useNostrAuth();
  const { toast } = useToast();
  const [retrying, setRetrying] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [showRecalcConfirm, setShowRecalcConfirm] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!wotEnabled) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [wotEnabled]);

  const authOk = diagnostics.authenticated;
  const cooldownRemainingMs = Math.max(0, diagnostics.batchCooldownUntil - now);
  const cooldownActive = cooldownRemainingMs > 0;
  const cooldownSecs = Math.ceil(cooldownRemainingMs / 1000);

  const authHasFail = diagnostics.authLastFailAt > 0 && diagnostics.authLastFailAt >= diagnostics.authLastSuccessAt;
  const connHasFail = diagnostics.connLastFailAt > 0 && diagnostics.connLastFailAt >= diagnostics.connLastSuccessAt;

  // Has the user ever had scores computed? Decides Calculate vs Recalculate wording.
  const hasComputed = diagnostics.batchLastSuccessAt > 0 || diagnostics.connLastSuccessAt > 0;

  const onRetry = async () => {
    setRetrying(true);
    try { await retryAuth(); } finally { setRetrying(false); }
  };

  // Calculate the web of trust IN-APP (no off-site bounce). Same path the
  // Network Signal card uses: sign the challenge, trigger, then the recalc
  // poller picks up the result and refreshes scores automatically.
  const onCalculate = async () => {
    if (!pubkey || triggering || recalculating) return;
    // A trust score reads your social graph — with zero follows the calc comes
    // back empty. Nudge the user to follow someone first.
    if ((follows?.length ?? 0) === 0) {
      toast({ title: "Follow a few people first", description: "Your trust score reads your social graph. Follow at least one account, then calculate.", variant: "destructive" });
      return;
    }
    setTriggering(true);
    try {
      const r = await triggerGrapeRankCalculation(pubkey);
      if (r.ok) {
        notifyRecalculating();
        toast({ title: "Calculating your web of trust…", description: "This takes a few minutes — scores update automatically when it's ready." });
      } else if (r.error === "rate_limited") {
        notifyRecalculating();
        toast({ title: "Calculation already in progress", description: "You requested one recently — results are on the way." });
      } else if (r.error === "auth") {
        toast({ title: "Couldn't start", description: "Approve the signing request with your key to calculate.", variant: "destructive" });
      } else {
        toast({ title: "Couldn't start calculation", description: "Brainstorm is unreachable right now. Please try again shortly.", variant: "destructive" });
      }
    } finally {
      setTriggering(false);
    }
  };

  // Guard, then confirm before firing — a recalculation is slow and signs the
  // user's key, so it shouldn't run on a single accidental tap.
  const requestRecalc = () => {
    if (!pubkey || triggering || recalculating) return;
    if ((follows?.length ?? 0) === 0) {
      toast({ title: "Follow a few people first", description: "Your trust score reads your social graph. Follow at least one account, then calculate.", variant: "destructive" });
      return;
    }
    setShowRecalcConfirm(true);
  };

  return (
    <div
      className="rounded-lg p-4 space-y-3"
      style={{ background: "rgba(140, 100, 220, 0.04)", border: "1px solid rgba(140, 100, 220, 0.12)" }}
      data-testid="wot-diagnostics-card"
    >
      <AlertDialog open={showRecalcConfirm} onOpenChange={setShowRecalcConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{hasComputed ? "Recalculate your web of trust?" : "Calculate your web of trust?"}</AlertDialogTitle>
            <AlertDialogDescription>
              This runs a fresh calculation on Brainstorm and takes a few minutes. Your scores update
              automatically when it's ready — you don't need to wait here. You'll be asked to sign the
              request with your key.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-wot-recalc-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setShowRecalcConfirm(false); void onCalculate(); }}
              data-testid="button-wot-recalc-confirm"
            >
              {hasComputed ? "Recalculate" : "Calculate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground/85">Trust Network Diagnostics</p>
          <p className="text-xs text-muted-foreground/55 leading-relaxed mt-0.5">
            {wotEnabled
              ? "Your connection to Brainstorm, where your web-of-trust scores are computed. Calculate or refresh them right here — no need to leave the app."
              : "Web of Trust is off. Enable it above to activate scoring; status below reflects the last known connection state."}
          </p>
        </div>
      </div>

      <div className="grid gap-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground/70">Signed in</span>
          <span className="flex items-center gap-1.5" data-testid="wot-diag-auth">
            <span className={`w-1.5 h-1.5 rounded-full ${authOk ? "bg-emerald-500" : authHasFail ? "bg-red-500" : "bg-slate-500/50"}`} />
            <span className={authOk ? "text-emerald-500/80" : authHasFail ? "text-red-500/85" : "text-muted-foreground/60"}>
              {authOk ? `Signed in · ${formatRelativeTime(diagnostics.authLastSuccessAt)}` : authHasFail ? `Failed · ${formatRelativeTime(diagnostics.authLastFailAt)}` : "Not yet attempted"}
            </span>
          </span>
        </div>
        {authHasFail && diagnostics.authLastFailReason && (
          <p className="text-[10px] text-red-500/70 pl-2">{diagnostics.authLastFailReason}</p>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground/70">Scores loaded</span>
          <span className="flex items-center gap-1.5" data-testid="wot-diag-conn">
            <span className={`w-1.5 h-1.5 rounded-full ${diagnostics.connLastSuccessAt && !connHasFail ? "bg-emerald-500" : connHasFail ? "bg-red-500" : "bg-slate-500/50"}`} />
            <span className={diagnostics.connLastSuccessAt && !connHasFail ? "text-emerald-500/80" : connHasFail ? "text-red-500/85" : "text-muted-foreground/60"}>
              {connHasFail
                ? `Failed · ${formatRelativeTime(diagnostics.connLastFailAt)}`
                : diagnostics.connLastSuccessAt
                  ? `OK · ${formatRelativeTime(diagnostics.connLastSuccessAt)}`
                  : "Not yet attempted"}
            </span>
          </span>
        </div>
        {connHasFail && diagnostics.connLastError && (
          <p className="text-[10px] text-red-500/70 pl-2">{diagnostics.connLastError}</p>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground/70">Live scoring</span>
          <span className="flex items-center gap-1.5" data-testid="wot-diag-batch">
            <span className={`w-1.5 h-1.5 rounded-full ${cooldownActive ? "bg-amber-500" : diagnostics.batchLastSuccessAt ? "bg-emerald-500" : "bg-slate-500/50"}`} />
            <span className={cooldownActive ? "text-amber-500/85" : diagnostics.batchLastSuccessAt ? "text-emerald-500/80" : "text-muted-foreground/60"}>
              {cooldownActive
                ? `Paused · retry in ${cooldownSecs}s`
                : diagnostics.batchLastSuccessAt
                  ? `OK · ${formatRelativeTime(diagnostics.batchLastSuccessAt)}`
                  : "Idle"}
            </span>
          </span>
        </div>
        {diagnostics.batchLastError && diagnostics.batchLastFailAt >= diagnostics.batchLastSuccessAt && (
          <p className="text-[10px] text-amber-500/75 pl-2">{diagnostics.batchLastError}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          size="sm"
          className="h-7 text-xs bg-brand hover:bg-brand text-white"
          onClick={requestRecalc}
          disabled={triggering || recalculating || !pubkey}
          data-testid="button-wot-calculate"
        >
          {triggering || recalculating ? (
            <><RelayOutpostInlineLoader className="w-3 h-3 mr-1.5" /> Calculating…</>
          ) : (
            <><ShieldMatrixIcon className="w-3.5 h-3.5 mr-1.5" /> {hasComputed ? "Recalculate" : "Calculate my web of trust"}</>
          )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={clearCooldownAndRefresh}
          data-testid="button-wot-clear-cooldown"
        >
          <RotateCcw className="w-3 h-3 mr-1.5" />
          Refresh scores
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={onRetry}
          disabled={retrying}
          data-testid="button-wot-retry-auth"
        >
          <RotateCcw className="w-3 h-3 mr-1.5" />
          {retrying ? "Signing in…" : "Retry sign-in"}
        </Button>
        <a
          href="https://brainstorm.nosfabrica.com"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/50 hover:text-brand/80 transition-colors"
          data-testid="link-wot-recalc"
        >
          Open Brainstorm ↗
        </a>
      </div>
    </div>
  );
}

const WOT_BADGE_LS_KEY = "relay-outpost-wot-badge-detailed";

function WotBadgeStyleToggle() {
  const { wotEnabled } = useGrapeRankScores();
  const [detailed, setDetailed] = useState(() => {
    try { return localStorage.getItem(WOT_BADGE_LS_KEY) === "true"; } catch { return false; }
  });
  const toggle = () => {
    if (!wotEnabled) return;
    const next = !detailed;
    setDetailed(next);
    try { localStorage.setItem(WOT_BADGE_LS_KEY, String(next)); } catch {}
  };
  return (
    <div
      className={`flex items-center justify-between rounded-lg p-4 transition-opacity duration-300 ${!wotEnabled ? "opacity-40 pointer-events-none" : ""}`}
      style={{ background: "rgba(140, 100, 220, 0.04)", border: "1px solid rgba(140, 100, 220, 0.12)" }}
    >
      <div className="flex-1 min-w-0 mr-3">
        <p className="text-sm font-medium text-foreground/85">Detailed WoT Badge</p>
        <p className="text-xs text-muted-foreground/55 leading-relaxed mt-0.5">
          Show the full WoT service card on your Outpost banner instead of the compact pill.
        </p>
      </div>
      <button
        role="switch"
        aria-checked={detailed}
        onClick={toggle}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
          detailed ? "bg-brand" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${
            detailed ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function TierInput({ value, onCommit, testId }: { value: number; onCommit: (v: string) => void; testId: string }) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  return (
    <input
      type="number"
      min={1}
      max={99}
      value={editing ? draft : value}
      onChange={(e) => { setDraft(e.target.value); setEditing(true); }}
      onFocus={() => setEditing(true)}
      onBlur={() => { onCommit(draft); setEditing(false); }}
      onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); } }}
      className="w-11 h-6 text-center text-[11px] rounded border border-brand/20 bg-brand/[0.06] text-foreground/80 focus:outline-none focus:ring-1 focus:ring-brand/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      data-testid={testId}
    />
  );
}

function TrustTierCalibration({ onCustomTiersChange }: { onCustomTiersChange: (active: boolean) => void }) {
  const { wotEnabled } = useGrapeRankScores();
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(() => isCustomTiersEnabled());
  const [thresholds, setThresholds] = useState<TierThresholds>(() => getStoredCustomThresholds());

  const handleToggle = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    setCustomTiersEnabled(next);
    if (next) {
      saveCustomThresholds(thresholds);
    }
    onCustomTiersChange(next);
    toast({
      title: next ? "Custom tiers activated" : "Standard tiers restored",
      description: next
        ? "Trust tier boundaries now use your custom settings."
        : "Trust tier boundaries reverted to Brainstorm defaults.",
    });
  }, [enabled, thresholds, toast, onCustomTiersChange]);

  const handleReset = useCallback(() => {
    resetCustomThresholds();
    setEnabled(false);
    setThresholds({ ...DEFAULT_THRESHOLDS });
    onCustomTiersChange(false);
  }, [onCustomTiersChange]);

  const updateThreshold = useCallback((key: keyof TierThresholds, rawValue: string) => {
    const num = parseInt(rawValue, 10);
    if (isNaN(num) || num < 1 || num > 99) return;

    setThresholds(prev => {
      const order: (keyof TierThresholds)[] = ["weak", "low", "moderate", "strong"];
      const idx = order.indexOf(key);
      const nextKey = idx < order.length - 1 ? order[idx + 1] : null;
      const upperPct = nextKey ? Math.round(prev[nextKey] * 100) - 1 : 100;
      if (num > upperPct) return prev;
      const belowKey = idx > 0 ? order[idx - 1] : null;
      if (belowKey) {
        const belowLower = Math.round(prev[belowKey] * 100);
        if (num <= belowLower) return prev;
      }
      const draft = { ...prev, [key]: num / 100 };
      const normalized = saveCustomThresholds(draft);
      return normalized;
    });
  }, []);

  const updateUpperBound = useCallback((key: keyof TierThresholds, rawValue: string) => {
    const num = parseInt(rawValue, 10);
    if (isNaN(num) || num < 1 || num > 99) return;
    const order: (keyof TierThresholds)[] = ["weak", "low", "moderate", "strong"];
    const idx = order.indexOf(key);
    const nextKey = idx < order.length - 1 ? order[idx + 1] : null;
    if (!nextKey) return;

    setThresholds(prev => {
      const lowerPct = Math.round(prev[key] * 100);
      if (num < lowerPct) return prev;
      const nextIdx = order.indexOf(nextKey);
      const aboveKey = nextIdx < order.length - 1 ? order[nextIdx + 1] : null;
      if (aboveKey) {
        const aboveUpper = Math.round(prev[aboveKey] * 100) - 1;
        if (num + 1 > aboveUpper) return prev;
      }
      const draft = { ...prev, [nextKey]: (num + 1) / 100 };
      const normalized = saveCustomThresholds(draft);
      return normalized;
    });
  }, []);

  if (!wotEnabled) return null;

  const isDefault = thresholds.strong === DEFAULT_THRESHOLDS.strong &&
    thresholds.moderate === DEFAULT_THRESHOLDS.moderate &&
    thresholds.low === DEFAULT_THRESHOLDS.low &&
    thresholds.weak === DEFAULT_THRESHOLDS.weak;

  return (
    <ShieldSubSection
      title="Trust Tier Calibration"
      description="Adjust how GrapeRank influence scores map to trust tiers. This only changes how scores are labeled — the underlying scores from Brainstorm are not affected."
    >
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground/75">Custom thresholds</p>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5 leading-relaxed">
            {enabled
              ? "Active — tier boundaries use your custom values below."
              : "Off — using standard Brainstorm tier boundaries."}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          onClick={handleToggle}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
            enabled ? "bg-brand" : "bg-muted-foreground/30"
          }`}
          data-testid="toggle-custom-tiers"
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${
              enabled ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      <div className="space-y-1.5">
        {CALIBRATION_TIERS.map(({ key, tier, label }) => {
          const displayThresholds = enabled ? thresholds : DEFAULT_THRESHOLDS;
          const lowerPct = Math.round(displayThresholds[key] * 100);
          const order: (keyof TierThresholds)[] = ["weak", "low", "moderate", "strong"];
          const idx = order.indexOf(key);
          const upperKey = idx < order.length - 1 ? order[idx + 1] : null;
          const upperPct = upperKey ? Math.round(displayThresholds[upperKey] * 100) - 1 : 100;
          const isTopTier = key === "strong";

          return (
            <div
              key={key}
              className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5"
              style={{ background: enabled ? "rgba(140, 100, 220, 0.04)" : "transparent" }}
            >
              <TrustTierGlyph tier={tier} size="w-2 h-2" decorative />
              <span className="text-[11px] font-medium text-foreground/70 w-20 shrink-0">{label}</span>
              {enabled ? (
                <div className="flex items-center gap-1 flex-1 justify-end">
                  <TierInput
                    value={lowerPct}
                    onCommit={(v) => updateThreshold(key, v)}
                    testId={`input-threshold-${key}`}
                  />
                  <span className="text-[10px] text-muted-foreground/40">–</span>
                  {isTopTier ? (
                    <span className="w-11 h-6 flex items-center justify-center text-[11px] text-muted-foreground/50">100</span>
                  ) : (
                    <TierInput
                      value={upperPct}
                      onCommit={(v) => updateUpperBound(key, v)}
                      testId={`input-upper-${key}`}
                    />
                  )}
                  <span className="text-[10px] text-muted-foreground/50">%</span>
                </div>
              ) : (
                <span className="text-[10px] text-muted-foreground/50 flex-1 text-right">
                  {lowerPct}% – {upperPct}%
                </span>
              )}
            </div>
          );
        })}
        <div className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5">
          <TrustTierGlyph tier="none" size="w-2 h-2" decorative />
          <span className="text-[11px] font-medium text-foreground/70 w-20 shrink-0">Unverified</span>
          <span className="text-[10px] text-muted-foreground/50 flex-1 text-right">
            0% – {Math.round((enabled ? thresholds : DEFAULT_THRESHOLDS).weak * 100) - 1}%
          </span>
        </div>
      </div>

      {enabled && !isDefault && (
        <div className="flex items-center justify-end pt-1">
          <button
            onClick={handleReset}
            className="flex items-center gap-1 text-[10px] text-brand/60 hover:text-brand-strong transition-colors cursor-pointer"
            data-testid="button-reset-thresholds"
          >
            <RotateCcw className="w-3 h-3" />
            Reset to defaults
          </button>
        </div>
      )}

      {!enabled && (
        <p className="text-[10px] text-muted-foreground/40 italic leading-relaxed">
          These are the standard Brainstorm tier boundaries. Toggle on to customize how influence scores are categorized for your experience.
        </p>
      )}
    </ShieldSubSection>
  );
}

function ReachDepthDefault() {
  const [depth, setDepth] = useState<ReachDepth>(() => {
    try {
      const stored = localStorage.getItem("relay-outpost-reach-depth");
      if (stored === "direct") return "1hop";
      if (stored && ["1hop", "2hops", "3hops", "global", "off"].includes(stored)) return stored as ReachDepth;
      const legacy = localStorage.getItem("relay-outpost-wot-filter");
      if (legacy === "true") return "3hops";
    } catch {}
    return "off";
  });

  const handleChange = useCallback((value: ReachDepth) => {
    setDepth(value);
    try { localStorage.setItem("relay-outpost-reach-depth", value); } catch {}
  }, []);

  const selectedOption = REACH_DEPTH_OPTIONS.find(o => o.value === depth);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {REACH_DEPTH_OPTIONS.map(opt => {
          const selected = depth === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => handleChange(opt.value)}
              className={`px-2.5 py-1.5 rounded-md text-xs transition-all cursor-pointer border ${
                selected
                  ? "border-brand/40 bg-brand/10 dark:bg-brand/15 text-foreground/90"
                  : "border-brand/15 dark:border-brand/10 bg-white/[0.02] hover:border-brand/25 hover:bg-brand/[0.04] text-foreground/55"
              }`}
              data-testid={`button-reach-depth-${opt.value}`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {selectedOption && (
        <p className="text-[10px] text-muted-foreground/45">{selectedOption.desc}</p>
      )}
    </div>
  );
}

function TrustTierFilterPreset() {
  const { wotEnabled, flaggedPubkeys } = useGrapeRankScores();
  const { toast } = useToast();
  const [excluded, setExcluded] = useState<Set<SignalTier>>(() => {
    try {
      const stored = localStorage.getItem("relay-outpost-excluded-tiers");
      if (stored) return new Set(JSON.parse(stored) as SignalTier[]);
    } catch {}
    return new Set();
  });

  const toggle = useCallback((tier: SignalTier) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier); else next.add(tier);
      try { localStorage.setItem("relay-outpost-excluded-tiers", JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setExcluded(new Set());
    try { localStorage.removeItem("relay-outpost-excluded-tiers"); } catch {}
  }, []);

  const [showOnFeed, setShowOnFeed] = useState(() => {
    try { return localStorage.getItem("relay-outpost-tier-filter-expanded") === "true"; } catch { return false; }
  });
  const toggleShowOnFeed = useCallback(() => {
    setShowOnFeed(prev => {
      const next = !prev;
      try { localStorage.setItem("relay-outpost-tier-filter-expanded", next ? "true" : "false"); } catch {}
      return next;
    });
  }, []);

  const [showCommentTrust, setShowCommentTrust] = useState(() => {
    try { return localStorage.getItem("relay-outpost-hide-comment-trust") !== "true"; } catch { return true; }
  });
  const toggleShowCommentTrust = useCallback(() => {
    setShowCommentTrust(prev => {
      const next = !prev;
      try { localStorage.setItem("relay-outpost-hide-comment-trust", next ? "false" : "true"); } catch {}
      return next;
    });
  }, []);

  if (!wotEnabled) return null;

  return (
    <div className="space-y-3">
      <ShieldSubSection
        title="Hidden Trust Tiers"
        description="Tap a tier to hide posts from that trust level. Hidden tiers appear crossed out. This applies to your main feed and comment threads."
      >
        <div className="flex flex-wrap gap-1.5">
          {TIER_FILTER_OPTIONS.map(tier => {
            const isExcluded = excluded.has(tier);
            return (
              <button
                key={tier}
                onClick={() => toggle(tier)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-all cursor-pointer border ${
                  isExcluded
                    ? "opacity-40 line-through text-muted-foreground/40 border-border/20 bg-transparent"
                    : "text-foreground/70 border-brand/20 bg-brand/[0.06] hover:bg-brand/10"
                }`}
              >
                <TrustTierGlyph tier={tier} size="w-2 h-2" decorative className={isExcluded ? "opacity-30" : ""} />
                {getSignalTierLabel(tier)}
              </button>
            );
          })}
        </div>
        {excluded.size > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-brand/50">
              {excluded.size} tier{excluded.size !== 1 ? "s" : ""} hidden
            </p>
            <button
              onClick={clearAll}
              className="text-[10px] text-brand/60 hover:text-brand-strong transition-colors"
            >
              Reset all
            </button>
          </div>
        )}
      </ShieldSubSection>

      <ShieldSubSection
        title="Trust Reach"
        description="Controls how far through your network posts can come from. Inner Circle shows only your closest connections; Everyone shows all scored users."
      >
        <ReachDepthDefault />
        <p className="text-[10px] text-muted-foreground/45 italic">You can also change this on-the-fly from the feed controls.</p>
      </ShieldSubSection>

      <ShieldSubSection
        title="Display Options"
        description="Control how trust information appears in your feed and conversations."
      >
        <ShieldToggleRow
          label="Show filter bar on feed"
          description="Adds trust tier buttons above your feed so you can quickly toggle tiers without opening settings."
          checked={showOnFeed}
          onToggle={toggleShowOnFeed}
          testId="toggle-tier-filter-on-feed"
        />
        <div className="border-t border-brand/8" />
        <ShieldToggleRow
          label="Show trust dots in comments"
          description="Adds a colored trust indicator next to each commenter's name. When on, your hidden tiers also apply to comment threads."
          checked={showCommentTrust}
          onToggle={toggleShowCommentTrust}
          testId="toggle-comment-trust"
        />
      </ShieldSubSection>

      <FlaggedAccountReviewSection flaggedPubkeys={flaggedPubkeys} toast={toast} />
    </div>
  );
}

const DISMISSED_FLAGGED_KEY = "relay-outpost-dismissed-flagged";
const FLAGGED_DETECTION_KEY = "relay-outpost-flagged-detection";

function getDismissedFlagged(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_FLAGGED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch { return new Set(); }
}

function saveDismissedFlagged(set: Set<string>) {
  try { localStorage.setItem(DISMISSED_FLAGGED_KEY, JSON.stringify(Array.from(set))); } catch {}
}

function FlaggedAccountRow({ pk, onMute, onDismiss }: { pk: string; onMute: () => void; onDismiss: () => void }) {
  const profileEvent = use$(() => eventStore.replaceable(KIND_METADATA, pk), [pk]);
  const profileContent = profileEvent ? getProfileContent(profileEvent) : null;
  const profile = profileContent as ProfileFields | null;
  const displayName = profile?.display_name || profile?.name || null;
  const picture = profile?.picture || null;
  const { getAuthorTier } = useGrapeRankScores();
  const tier = getAuthorTier(pk);
  const tierLabel = getSignalTierLabel(tier);
  let npub = "";
  try { npub = nip19.npubEncode(pk); } catch {}
  const shortNpub = npub ? `${npub.slice(0, 12)}...` : pk.slice(0, 12) + "...";

  useEffect(() => {
    fetchProfilesCached([pk]);
  }, [pk]);

  return (
    <div
      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-brand/5 group"
      style={{ border: "1px solid rgba(140, 100, 220, 0.12)" }}
      data-testid={`flagged-user-${pk.slice(0, 8)}`}
    >
      <Link href={`/profile/${npub}`} className="shrink-0">
        <Avatar className="w-8 h-8 border border-border/30">
          <AvatarImage src={picture || undefined} alt={displayName || shortNpub} />
          <AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
            {displayName ? displayName.slice(0, 2).toUpperCase() : shortNpub.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </Link>
      <Link href={`/profile/${npub}`} className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-medium truncate text-foreground/90 hover:underline underline-offset-2">
            {displayName || shortNpub}
          </p>
          <span className="flex items-center gap-1 shrink-0">
            <TrustTierGlyph tier={tier} size="w-1.5 h-1.5" decorative />
            <span className="text-[10px] text-muted-foreground/50">{tierLabel}</span>
          </span>
        </div>
        {displayName && (
          <p className="text-[11px] text-muted-foreground/50 font-mono truncate">{shortNpub}</p>
        )}
      </Link>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="text-[11px] text-muted-foreground/60 gap-1 opacity-70 group-hover:opacity-100 transition-opacity h-7 px-2"
          onClick={onDismiss}
          data-testid={`button-dismiss-${pk.slice(0, 8)}`}
        >
          <X className="w-3 h-3" />
          Dismiss
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-[11px] text-red-500/70 gap-1 opacity-70 group-hover:opacity-100 transition-opacity h-7 px-2"
          onClick={onMute}
          data-testid={`button-mute-flagged-${pk.slice(0, 8)}`}
        >
          <VolumeX className="w-3 h-3" />
          Mute
        </Button>
      </div>
    </div>
  );
}

function FlaggedAccountReviewSection({ flaggedPubkeys, toast }: { flaggedPubkeys: Set<string> | null; toast: ReturnType<typeof useToast>["toast"] }) {
  const [detectionEnabled, setDetectionEnabled] = useState(() => {
    try {
      const newKey = localStorage.getItem(FLAGGED_DETECTION_KEY);
      if (newKey !== null) {
        localStorage.removeItem("relay-outpost-auto-mute-flagged");
        return newKey === "true";
      }
      const oldKey = localStorage.getItem("relay-outpost-auto-mute-flagged");
      localStorage.removeItem("relay-outpost-auto-mute-flagged");
      if (oldKey === "true") {
        localStorage.setItem(FLAGGED_DETECTION_KEY, "true");
        return true;
      }
      return false;
    } catch { return false; }
  });

  const [dismissed, setDismissed] = useState<Set<string>>(getDismissedFlagged);
  const [expanded, setExpanded] = useState(false);
  const [muteVersion, setMuteVersion] = useState(0);

  useEffect(() => {
    return onMuteChange(() => setMuteVersion(v => v + 1));
  }, []);

  const pendingPubkeys = useMemo(() => {
    if (!flaggedPubkeys) return [];
    void muteVersion;
    const result: string[] = [];
    for (const pk of flaggedPubkeys) {
      if (!isMutedPubkey(pk) && !dismissed.has(pk)) {
        result.push(pk);
      }
    }
    return result;
  }, [flaggedPubkeys, dismissed, muteVersion]);

  const toggleDetection = useCallback(() => {
    setDetectionEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem(FLAGGED_DETECTION_KEY, next ? "true" : "false"); } catch {}
      return next;
    });
  }, []);

  const handleMute = useCallback((pk: string) => {
    localMutePubkey(pk);
    toast({ title: "Account muted" });
  }, [toast]);

  const handleDismiss = useCallback((pk: string) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(pk);
      saveDismissedFlagged(next);
      return next;
    });
  }, []);

  const handleMuteAll = useCallback(() => {
    let count = 0;
    for (const pk of pendingPubkeys) {
      if (!isMutedPubkey(pk)) {
        localMutePubkey(pk);
        count++;
      }
    }
    if (count > 0) {
      toast({ title: `${count} account${count !== 1 ? "s" : ""} muted` });
    }
  }, [pendingPubkeys, toast]);

  const handleDismissAll = useCallback(() => {
    setDismissed(prev => {
      const next = new Set(prev);
      for (const pk of pendingPubkeys) next.add(pk);
      saveDismissedFlagged(next);
      return next;
    });
  }, [pendingPubkeys]);

  return (
    <ShieldSubSection
      title="Flagged Account Detection"
      description="Accounts reported by 2+ trusted users in your network are surfaced here for review. You decide whether to mute or dismiss each one."
    >
      <ShieldToggleRow
        label="Enable detection"
        description="Surface flagged accounts for review"
        checked={detectionEnabled}
        onToggle={toggleDetection}
        testId="toggle-flagged-detection"
      />

      {detectionEnabled && (
        <div className="space-y-2 mt-1">
          {!flaggedPubkeys && (
            <p className="text-[11px] text-muted-foreground/50">Loading flagged accounts...</p>
          )}

          {flaggedPubkeys && pendingPubkeys.length === 0 && (
            <p className="text-[11px] text-muted-foreground/50">No flagged accounts pending review</p>
          )}

          {flaggedPubkeys && pendingPubkeys.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setExpanded(e => !e)}
                  className="flex items-center gap-1.5 text-xs text-foreground/70 hover:text-foreground/90 transition-colors cursor-pointer"
                  data-testid="toggle-flagged-expand"
                >
                  {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  <span className="font-medium">{pendingPubkeys.length} pending review</span>
                </button>

                {pendingPubkeys.length >= 2 && (
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[10px] text-muted-foreground/60 h-6 px-2"
                      onClick={handleDismissAll}
                      data-testid="button-dismiss-all"
                    >
                      Dismiss All
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[10px] text-red-500/70 h-6 px-2"
                      onClick={handleMuteAll}
                      data-testid="button-mute-all"
                    >
                      Mute All
                    </Button>
                  </div>
                )}
              </div>

              {expanded && (
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                  {pendingPubkeys.map(pk => (
                    <FlaggedAccountRow
                      key={pk}
                      pk={pk}
                      onMute={() => handleMute(pk)}
                      onDismiss={() => handleDismiss(pk)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ShieldSubSection>
  );
}

function MutedUserRow({ pk, onUnmute }: { pk: string; onUnmute: () => void }) {
  const profileEvent = use$(() => eventStore.replaceable(KIND_METADATA, pk), [pk]);
  const profileContent = profileEvent ? getProfileContent(profileEvent) : null;
  const profile = profileContent as ProfileFields | null;
  const displayName = profile?.display_name || profile?.name || null;
  const picture = profile?.picture || null;
  let npub = "";
  try { npub = nip19.npubEncode(pk); } catch {}
  const shortNpub = npub ? `${npub.slice(0, 12)}...` : pk.slice(0, 12) + "...";

  return (
    <div
      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-brand/5 group"
      style={{ border: "1px solid rgba(140, 100, 220, 0.12)" }}
      data-testid={`muted-user-${pk.slice(0, 8)}`}
    >
      <Link href={`/profile/${npub}`} className="shrink-0" data-testid={`link-muted-avatar-${pk.slice(0, 8)}`}>
        <Avatar className="w-8 h-8 border border-border/30">
          <AvatarImage src={picture || undefined} alt={displayName || shortNpub} />
          <AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
            {displayName ? displayName.slice(0, 2).toUpperCase() : shortNpub.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </Link>
      <Link
        href={`/profile/${npub}`}
        className="flex-1 min-w-0"
        data-testid={`link-muted-profile-${pk.slice(0, 8)}`}
      >
        <p className="text-xs font-medium truncate text-foreground/90 hover:underline underline-offset-2">
          {displayName || shortNpub}
        </p>
        {displayName && (
          <p className="text-[11px] text-muted-foreground/50 font-mono truncate">{shortNpub}</p>
        )}
      </Link>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 text-[11px] text-muted-foreground/60 gap-1 opacity-70 group-hover:opacity-100 transition-opacity"
        onClick={onUnmute}
        data-testid={`button-unmute-${pk.slice(0, 8)}`}
      >
        <VolumeX className="w-3 h-3" />
        Unmute
      </Button>
    </div>
  );
}

function MutedUsersSection({ mutedPubkeys, unmute }: { mutedPubkeys: string[]; unmute: (pk: string) => void }) {
  const [muteSearch, setMuteSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const showSearch = mutedPubkeys.length >= 10;

  const filteredPubkeys = useMemo(() => {
    if (!muteSearch.trim()) return mutedPubkeys;
    const q = muteSearch.trim().toLowerCase();
    return mutedPubkeys.filter((pk) => {
      const profileEvent = eventStore.replaceable(KIND_METADATA, pk)?.value;
      const profileContent = profileEvent ? getProfileContent(profileEvent) : null;
      const name = ((profileContent as any)?.display_name || (profileContent as any)?.name || "").toLowerCase();
      let npub = "";
      try { npub = nip19.npubEncode(pk); } catch {}
      return name.includes(q) || npub.includes(q) || pk.includes(q);
    });
  }, [mutedPubkeys, muteSearch]);

  return (
    <div>
      <button
        className="flex items-center justify-between w-full cursor-pointer group"
        onClick={() => mutedPubkeys.length > 0 && setExpanded(!expanded)}
        data-testid="button-toggle-muted-list"
      >
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-foreground/85">Muted Users</p>
          {mutedPubkeys.length > 0 && (
            <span className="text-[11px] text-muted-foreground/50 font-mono" data-testid="text-muted-count">
              ({mutedPubkeys.length})
            </span>
          )}
        </div>
        {mutedPubkeys.length > 0 && (
          expanded
            ? <ChevronUp className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors" />
        )}
      </button>
      {mutedPubkeys.length === 0 ? (
        <p className="text-xs text-foreground/45 dark:text-muted-foreground/50 mt-2" data-testid="text-no-muted-users">
          No muted users. Use the mute option in post menus to silence accounts.
        </p>
      ) : (
        <>
          {showSearch && (
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
              <Input
                value={muteSearch}
                onChange={(e) => {
                  setMuteSearch(e.target.value);
                  if (e.target.value.trim() && !expanded) setExpanded(true);
                }}
                placeholder="Search muted users..."
                className="text-xs pl-8 bg-white/[0.03] border-brand/25 dark:border-brand/15 focus-visible:border-brand/40 dark:focus-visible:border-brand/30"
                data-testid="input-search-muted"
              />
            </div>
          )}
          {expanded && (
            <div className="mt-2">
              {filteredPubkeys.length === 0 ? (
                <p className="text-xs text-foreground/45 dark:text-muted-foreground/50" data-testid="text-no-muted-match">
                  No muted users match your search.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-0.5" data-testid="list-muted-users">
                  {filteredPubkeys.map((pk) => (
                    <MutedUserRow key={pk} pk={pk} onUnmute={() => unmute(pk)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilteredKeywordsSection({ mutedKeywords, addKeyword, removeKeyword, newKeyword, setNewKeyword }: {
  mutedKeywords: string[];
  addKeyword: (kw: string) => void;
  removeKeyword: (kw: string) => void;
  newKeyword: string;
  setNewKeyword: (v: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        className="flex items-center justify-between w-full cursor-pointer group"
        onClick={() => setExpanded(!expanded)}
        data-testid="button-toggle-keywords-list"
      >
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-foreground/85">Filtered Keywords</p>
          {mutedKeywords.length > 0 && (
            <span className="text-[11px] text-muted-foreground/50 font-mono" data-testid="text-keywords-count">
              ({mutedKeywords.length})
            </span>
          )}
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors" />
          : <ChevronDown className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors" />
        }
      </button>
      {!expanded && mutedKeywords.length === 0 && (
        <p className="text-xs text-foreground/45 dark:text-muted-foreground/50 mt-2" data-testid="text-no-keywords">
          No keyword filters active. Posts containing filtered keywords will be hidden.
        </p>
      )}
      {expanded && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2">
            <Input
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              placeholder="Add keyword to filter..."
              className="text-xs bg-white/[0.03] border-brand/25 dark:border-brand/15 focus-visible:border-brand/40 dark:focus-visible:border-brand/30"
              data-testid="input-mute-keyword"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newKeyword.trim()) {
                  addKeyword(newKeyword.trim().toLowerCase());
                  setNewKeyword("");
                }
              }}
            />
            <Button
              size="icon"
              variant="outline"
              onClick={() => {
                if (newKeyword.trim()) {
                  addKeyword(newKeyword.trim().toLowerCase());
                  setNewKeyword("");
                }
              }}
              disabled={!newKeyword.trim()}
              className="border-brand/25 dark:border-brand/15 bg-white/[0.02]"
              data-testid="button-add-keyword"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          {mutedKeywords.length === 0 ? (
            <p className="text-xs text-foreground/45 dark:text-muted-foreground/50" data-testid="text-no-keywords">
              No keyword filters active. Posts containing filtered keywords will be hidden.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5" data-testid="list-muted-keywords">
              {mutedKeywords.map((kw) => (
                <Badge key={kw} variant="secondary" className="gap-1 text-xs">
                  {kw}
                  <button
                    onClick={() => removeKeyword(kw)}
                    className="ml-0.5 rounded-full p-0.5"
                    data-testid={`button-remove-keyword-${kw}`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReportedContentSection({ reportedItems, removeReport }: {
  reportedItems: { eventId: string; reason: string }[];
  removeReport: (eventId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        className="flex items-center justify-between w-full cursor-pointer group"
        onClick={() => reportedItems.length > 0 && setExpanded(!expanded)}
        data-testid="button-toggle-reports-list"
      >
        <div className="flex items-center gap-1.5">
          <Flag className="w-3.5 h-3.5 text-destructive/70" />
          <p className="text-sm font-medium text-foreground/85">Reported Content</p>
          {reportedItems.length > 0 && (
            <span className="text-[11px] text-muted-foreground/50 font-mono" data-testid="text-reports-count">
              ({reportedItems.length})
            </span>
          )}
        </div>
        {reportedItems.length > 0 && (
          expanded
            ? <ChevronUp className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors" />
        )}
      </button>
      {reportedItems.length === 0 ? (
        <p className="text-xs text-foreground/45 dark:text-muted-foreground/50 mt-2" data-testid="text-no-reports">
          No reported content. Use the report option in post menus to flag content.
        </p>
      ) : expanded ? (
        <div className="space-y-1.5 mt-2" data-testid="list-reported-items">
          {reportedItems.map((item) => (
            <div key={item.eventId} className="flex items-center gap-2 rounded-md px-2.5 py-1.5"
              style={{ background: "rgba(140, 100, 220, 0.06)", border: "1px solid rgba(140, 100, 220, 0.15)" }}
            >
              <div className="flex-1 min-w-0">
                <span className="text-[11px] font-mono text-foreground/55 dark:text-muted-foreground/70 block truncate" data-testid={`text-report-id-${item.eventId.slice(0, 8)}`}>
                  {item.eventId.slice(0, 16)}...
                </span>
                <span className="text-[10px] text-foreground/45 dark:text-muted-foreground/50 capitalize">{item.reason}</span>
              </div>
              <button
                onClick={() => removeReport(item.eventId)}
                className="rounded-full p-0.5 shrink-0"
                data-testid={`button-remove-report-${item.eventId.slice(0, 8)}`}
              >
                <X className="w-2.5 h-2.5 text-muted-foreground/50" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// One-line "is the trust-score service working?" status. Reuses the diagnostics
// from the WoT context (the same ones the detailed WotDiagnosticsCard shows),
// but boils them down to a single plain-language line + at most one action.
// We deliberately avoid the proprietary "Brainstorm" name at this top level.
function TrustHealthLine() {
  const { wotEnabled, diagnostics, retryAuth } = useGrapeRankScores();
  const [retrying, setRetrying] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!wotEnabled) return;
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, [wotEnabled]);
  void now; // keep the relative time fresh

  if (!wotEnabled) return null;

  const authHasFail = diagnostics.authLastFailAt > 0 && diagnostics.authLastFailAt >= diagnostics.authLastSuccessAt;
  const connHasFail = diagnostics.connLastFailAt > 0 && diagnostics.connLastFailAt >= diagnostics.connLastSuccessAt;
  const signedIn = diagnostics.authenticated;
  const scoresLoaded = diagnostics.connLastSuccessAt > 0 && !connHasFail;

  const onRetry = async () => {
    setRetrying(true);
    try { await retryAuth(); } finally { setRetrying(false); }
  };

  // Healthy: signed in and scores have loaded without a more-recent failure.
  if (signedIn && scoresLoaded) {
    const freshest = Math.max(diagnostics.connLastSuccessAt, diagnostics.batchLastSuccessAt);
    return (
      <div
        className="flex items-center gap-2.5 rounded-lg px-4 py-2.5"
        style={{ background: "rgba(16, 185, 129, 0.06)", border: "1px solid rgba(16, 185, 129, 0.18)" }}
        data-testid="trust-health-line"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
          <Check className="h-3 w-3 text-emerald-500" />
        </span>
        <p className="text-xs text-foreground/75">
          <span className="font-medium text-foreground/90">Trust scores up to date</span>
          <span className="text-muted-foreground/55"> · {formatRelativeTime(freshest)}</span>
        </p>
      </div>
    );
  }

  // Problem: signed out / error. Show a plain line + one action.
  const problem = authHasFail || !signedIn
    ? "Not signed in to the trust-score service"
    : connHasFail
      ? "Couldn't load your trust scores"
      : "Trust scores aren't ready yet";

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg px-4 py-2.5"
      style={{ background: "rgba(245, 158, 11, 0.06)", border: "1px solid rgba(245, 158, 11, 0.2)" }}
      data-testid="trust-health-line"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/15">
          <AlertTriangle className="h-3 w-3 text-amber-500" />
        </span>
        <p className="text-xs text-foreground/75 truncate">{problem}</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0 text-xs"
        onClick={onRetry}
        disabled={retrying}
        data-testid="button-trust-health-retry"
      >
        <RotateCcw className="mr-1.5 h-3 w-3" />
        {retrying ? "Fixing…" : "Fix"}
      </Button>
    </div>
  );
}

// "How strict is your feed?" — three plain-language presets that drive the
// underlying reach + hidden-tier knobs. The active one is highlighted; if the
// user has hand-tuned the raw Advanced controls we show a "Custom" note instead.
function StrictnessPresetControl() {
  const { wotEnabled } = useGrapeRankScores();
  const { preset, setPreset } = useStrictnessPreset();

  if (!wotEnabled) return null;

  const options: Exclude<typeof preset, "custom">[] = ["open", "balanced", "strict"];

  return (
    <div className="space-y-2" data-testid="strictness-preset">
      <div>
        <p className="text-sm font-semibold text-foreground/90">How strict is your feed?</p>
        <p className="text-xs text-muted-foreground/55 leading-relaxed mt-0.5">
          How much your network filters for you — fine-tune under Advanced.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {options.map((name) => {
          const def = PRESET_DEFS[name];
          const active = preset === name;
          return (
            <button
              key={name}
              type="button"
              onClick={() => setPreset(name)}
              className={`flex flex-col items-start gap-0.5 rounded-lg border p-2.5 text-left transition-colors min-h-[44px] ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border bg-transparent hover:bg-muted/40 text-foreground/80"
              }`}
              data-testid={`button-strictness-${name}`}
              aria-pressed={active}
            >
              <span className="flex flex-wrap items-center gap-1">
                <span className="text-sm font-semibold">{def.label}</span>
                {name === "balanced" && (
                  <span className={`rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide leading-none ${active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-brand/10 text-brand"}`}>
                    Recommended
                  </span>
                )}
              </span>
              <span className={`text-[11px] leading-snug ${active ? "text-primary-foreground/80" : "text-muted-foreground/60"}`}>
                {def.blurb}
              </span>
            </button>
          );
        })}
      </div>
      {preset === "custom" && (
        <p className="text-[11px] text-muted-foreground/60" data-testid="strictness-custom-note">
          Custom — using your Advanced settings.
        </p>
      )}
    </div>
  );
}

export default function ShieldMatrix({ embedded = false }: { embedded?: boolean } = {}) {
  useDocumentTitle("Trust & safety");
  const { pubkey } = useNostrAuth();
  const [newKeyword, setNewKeyword] = useState("");
  const { stats, reportedItems, removeReport } = useSpamFilter();
  const { mutedPubkeys, mutedKeywords, unmutePubkey: unmute, addKeyword, removeKeyword } = useNostrMuteList();
  const { flaggedPubkeys, wotEnabled } = useGrapeRankScores();
  const [customTiersActive, setCustomTiersActive] = useState(() => isCustomTiersEnabled());
  // Advanced trust controls are collapsed by default — but if custom tiers are
  // active, open them so the header "Custom Tiers" badge (which scrolls to
  // #trust-tiers, now nested inside Advanced) actually reveals the control.
  const [advancedOpen, setAdvancedOpen] = useState(() => isCustomTiersEnabled());
  useEffect(() => {
    if (customTiersActive) setAdvancedOpen(true);
  }, [customTiersActive]);

  useEffect(() => {
    if (mutedPubkeys.length > 0) {
      fetchProfilesCached(mutedPubkeys);
    }
  }, [mutedPubkeys]);

  const threatCount = stats.spamPubkeys + (flaggedPubkeys?.size ?? 0);

  return (
    <div className={embedded ? "" : "min-h-screen"}>
      <MissionBriefing pageId="shield-matrix" steps={SHIELD_MATRIX_BRIEFING} />
      <div className={embedded ? "space-y-5" : "max-w-2xl mx-auto px-4 py-5 space-y-5"}>
        <div className="relative overflow-hidden rounded-xl border border-brand/20 dark:border-brand/15"
          style={{ background: "linear-gradient(135deg, rgba(139, 92, 246, 0.06) 0%, rgba(124, 58, 237, 0.03) 50%, rgba(109, 40, 217, 0.06) 100%)" }}
        >
          <div className="absolute inset-0 opacity-20 pointer-events-none"
            style={{ background: "radial-gradient(ellipse at 30% 20%, rgba(139, 92, 246, 0.15) 0%, transparent 60%), radial-gradient(ellipse at 70% 80%, rgba(124, 58, 237, 0.1) 0%, transparent 50%)" }}
          />
          <div className="relative px-4 py-4 sm:px-5 sm:py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="w-11 h-11 shrink-0 rounded-lg bg-brand/10 dark:bg-brand/15 border border-brand/20 flex items-center justify-center shadow-[0_0_15px_rgba(139,92,246,0.1)] dark:shadow-[0_0_20px_rgba(139,92,246,0.15)]">
                  <ShieldMatrixIcon className="w-5.5 h-5.5 text-brand/80" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg font-bold text-foreground/95 tracking-tight flex flex-wrap items-center gap-x-2 gap-y-1">
                    Trust &amp; safety
                    {customTiersActive && (
                      <button
                        type="button"
                        onClick={() => document.getElementById("trust-tiers")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                        className="shrink-0 whitespace-nowrap rounded-md border border-brand/15 bg-brand/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-brand/80 transition-colors hover:bg-brand/20 hover:text-brand-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                        data-testid="button-custom-tiers"
                        title="Edit custom trust tiers"
                        aria-label="Custom tiers active — edit trust tiers"
                      >
                        Custom Tiers
                      </button>
                    )}
                  </h1>
                  <p className="text-xs text-muted-foreground/55 mt-0.5">
                    Web of Trust &amp; moderation
                  </p>
                </div>
              </div>
              {!embedded && (
                <Link href="/settings" className="shrink-0">
                  <Button variant="ghost" size="sm" className="text-xs text-muted-foreground/50 hover:text-muted-foreground gap-1.5 h-8">
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Settings
                  </Button>
                </Link>
              )}
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 text-xs">
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${wotEnabled ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]" : "bg-slate-500/50"}`} />
                <span className="text-muted-foreground/60">WoT {wotEnabled ? "Active" : "Off"}</span>
              </div>
              {wotEnabled && <span className="text-muted-foreground/40" data-testid="text-spam-known">{threatCount} known threats</span>}
              {wotEnabled && <span className="text-muted-foreground/40" data-testid="text-spam-flagged">{flaggedPubkeys?.size ?? 0} flagged</span>}
              <span className="text-muted-foreground/40" data-testid="text-spam-muted">{mutedPubkeys.length} muted</span>
              <span className="text-muted-foreground/40" data-testid="text-spam-keywords">{mutedKeywords.length} keywords</span>
              <span className="text-muted-foreground/40" data-testid="text-spam-reports">{reportedItems.length} reported</span>
            </div>
          </div>
        </div>

        {/* ① TRUST — automatic protection from your social graph */}
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-brand/70 dark:text-brand/60">
              Trust
            </h2>
            <p className="text-xs text-muted-foreground/55 leading-relaxed mt-1">
              Your network scores people automatically — turning down accounts no one you follow vouches for.
            </p>
          </div>

          <WotToggle />
          <TrustHealthLine />
          <StrictnessPresetControl />

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 min-h-[44px] text-left transition-colors hover:bg-muted/30"
                style={{ background: "rgba(140, 100, 220, 0.04)", border: "1px solid rgba(140, 100, 220, 0.12)" }}
                data-testid="toggle-advanced-trust"
              >
                <span className="flex items-center gap-2">
                  <Sliders className="h-3.5 w-3.5 text-brand/70" />
                  <span className="text-sm font-medium text-foreground/85">Advanced trust controls</span>
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform duration-200 ${advancedOpen ? "rotate-180" : ""}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-3">
              <TrustTierFilterPreset />
              <div id="trust-tiers" className="scroll-mt-4">
                <TrustTierCalibration onCustomTiersChange={setCustomTiersActive} />
              </div>
              <WotBadgeStyleToggle />
              <WotDiagnosticsCard />
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* ② SAFETY — tools the user controls by hand */}
        <div className="relative rounded-xl border border-brand/20 dark:border-brand/12 overflow-visible"
          style={{ background: "rgba(140, 100, 220, 0.02)" }}
        >
          <div className="p-4 space-y-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-brand/70 dark:text-brand/60">
                Safety
              </h2>
              <p className="text-xs text-muted-foreground/55 mt-1">
                Tools you control by hand.
              </p>
            </div>
            <MutedUsersSection mutedPubkeys={mutedPubkeys} unmute={unmute} />
            <div className="border-t border-brand/8" />
            <FilteredKeywordsSection
              mutedKeywords={mutedKeywords}
              addKeyword={addKeyword}
              removeKeyword={removeKeyword}
              newKeyword={newKeyword}
              setNewKeyword={setNewKeyword}
            />
            <div className="border-t border-brand/8" />
            <ReportedContentSection reportedItems={reportedItems} removeReport={removeReport} />
          </div>
        </div>

        {/* Network Vouches — hidden for public beta (this was a placeholder-only
            "Coming Soon" card with no backing feature). Wrapped so it's a one-line
            re-enable once vouches ship. */}
        {false && (
        <section className="relative min-h-[280px] rounded-xl overflow-hidden">
          <div
            className="absolute inset-0 hidden dark:block"
            style={{ background: "rgb(5, 2, 15)" }}
          />
          <div
            className="absolute inset-0 dark:hidden"
            style={{ background: "rgb(250, 248, 255)" }}
          />
          <div className="absolute inset-0 overflow-hidden dark:block hidden">
            {Array.from({ length: 20 }).map((_, i) => (
              <div
                key={i}
                className="absolute rounded-full bg-white"
                style={{
                  width: `${Math.random() * 2 + 0.5}px`,
                  height: `${Math.random() * 2 + 0.5}px`,
                  top: `${Math.random() * 100}%`,
                  left: `${Math.random() * 100}%`,
                  opacity: Math.random() * 0.4 + 0.1,
                  animation: `pulse ${Math.random() * 3 + 2}s ease-in-out infinite`,
                  animationDelay: `${Math.random() * 3}s`,
                }}
              />
            ))}
          </div>
          <div className="absolute inset-0 overflow-hidden dark:hidden">
            {Array.from({ length: 15 }).map((_, i) => (
              <div
                key={i}
                className="absolute rounded-full bg-brand"
                style={{
                  width: `${Math.random() * 2 + 0.5}px`,
                  height: `${Math.random() * 2 + 0.5}px`,
                  top: `${Math.random() * 100}%`,
                  left: `${Math.random() * 100}%`,
                  opacity: Math.random() * 0.15 + 0.05,
                  animation: `pulse ${Math.random() * 3 + 2}s ease-in-out infinite`,
                  animationDelay: `${Math.random() * 3}s`,
                }}
              />
            ))}
          </div>
          <div className="relative flex flex-col items-center justify-center min-h-[280px] px-6 py-10 text-center">
            <div className="mb-4">
              <ShieldCheck className="w-9 h-9 text-brand" />
            </div>
            <h3 className="text-sm font-brand tracking-wider uppercase text-foreground/90 dark:text-white/90 mb-1.5">
              Network Vouches
            </h3>
            <p className="text-[11px] leading-relaxed text-muted-foreground/70 dark:text-white/50 max-w-[260px] mb-4">
              A peer-to-peer trust layer where users vouch for each other across the Nostr network — strengthening your Web of Trust.
            </p>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand/8 dark:bg-brand/10 border border-brand/15 mb-4">
              <Lock className="w-3 h-3 text-brand/60 dark:text-brand/50" />
              <span className="text-[9px] font-medium text-brand/70 dark:text-brand/60 tracking-wide uppercase">
                Coming Soon
              </span>
            </div>
            <div className="flex items-center gap-4 text-[9px] text-muted-foreground/40 dark:text-white/25">
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-emerald-500/50" />
                Vouches
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-brand/50" />
                Endorsements
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-cyan-500/50" />
                Reputation
              </span>
            </div>
          </div>
        </section>
        )}

      </div>
    </div>
  );
}
