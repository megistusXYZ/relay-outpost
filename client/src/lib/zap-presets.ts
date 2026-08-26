export interface ZapPreset {
  emoji: string;
  label: string;
  amount: number;
}

export const DEFAULT_ZAP_PRESETS: ZapPreset[] = [
  { emoji: "\u{1FA99}", label: "Tip of the Cap", amount: 21 },
  { emoji: "\u{1F60F}", label: "Nice", amount: 69 },
  { emoji: "\u{1F33F}", label: "Chill", amount: 420 },
  { emoji: "\u26A1", label: "Solid Zap", amount: 1000 },
  { emoji: "\u{1F680}", label: "Stacker", amount: 2100 },
  { emoji: "\u{1F48E}", label: "Whale Move", amount: 10000 },
];

const LS_KEY = "relay-outpost-zap-presets";

export function getZapPresets(): ZapPreset[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const normalized = parsed.slice(0, 6).map((p: Record<string, unknown>) => ({
          emoji: typeof p.emoji === "string" && p.emoji.length > 0 ? p.emoji : "\u26A1",
          label: typeof p.label === "string" && p.label.length > 0 ? p.label : "Zap",
          amount: typeof p.amount === "number" && p.amount > 0 && isFinite(p.amount) ? Math.round(p.amount) : 100,
        }));
        while (normalized.length < 6) {
          normalized.push({ ...DEFAULT_ZAP_PRESETS[normalized.length] || DEFAULT_ZAP_PRESETS[0] });
        }
        return normalized;
      }
    }
  } catch {}
  return [...DEFAULT_ZAP_PRESETS];
}

export function saveZapPresets(presets: ZapPreset[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(presets));
  } catch {}
}

export function getDefaultZapAmount(): number {
  try {
    const saved = localStorage.getItem("defaultZapAmount");
    if (saved) {
      const num = parseInt(saved, 10);
      if (num > 0 && isFinite(num)) return num;
    }
  } catch {}
  return 100;
}

export function saveDefaultZapAmount(amount: number): void {
  try {
    localStorage.setItem("defaultZapAmount", String(amount));
  } catch {}
}

export const EMOJI_OPTIONS = [
  "\u{1F44B}", "\u26A1", "\u{1F525}", "\u{1F680}", "\u{1F48E}", "\u2B50",
  "\u{1F4AA}", "\u{1F49C}", "\u{1F389}", "\u{1F31F}", "\u{1F4B0}", "\u{1F33F}",
  "\u2764\uFE0F", "\u{1F64F}", "\u{1F3C6}", "\u{1F451}", "\u{1F4A1}", "\u{1F308}",
  "\u2615", "\u{1F381}", "\u{1FAE1}", "\u{1F91D}", "\u{1F44D}", "\u{1F60E}",
];
