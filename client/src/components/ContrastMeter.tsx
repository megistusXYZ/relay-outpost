import { useLayoutEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/hooks/use-theme";
import { useContrast } from "@/hooks/use-contrast";
import {
  readTokenColor,
  contrastRatio,
  wcagLevel,
  WCAG_AAA_NORMAL,
  type WcagLevel,
} from "@/lib/contrast-utils";

// The key text/background token pairs we report. Measured live from CSS custom
// properties, so the readout reflects the current theme AND contrast level.
const PAIRS: Array<{ label: string; fg: string; bg: string; large?: boolean }> = [
  { label: "Body text", fg: "--foreground", bg: "--background" },
  { label: "Muted / secondary text", fg: "--muted-foreground", bg: "--background" },
  { label: "Card text", fg: "--card-foreground", bg: "--card" },
  { label: "Primary button", fg: "--primary-foreground", bg: "--primary" },
];

interface Row {
  label: string;
  ratio: number;
  level: WcagLevel;
}

function levelBadge(level: WcagLevel): { text: string; variant: "default" | "secondary" | "destructive" } {
  if (level === "AAA") return { text: "AAA", variant: "default" };
  if (level === "AA") return { text: "AA", variant: "secondary" };
  return { text: "Fail", variant: "destructive" };
}

export function ContrastMeter() {
  const { theme } = useTheme();
  const { level } = useContrast();
  const [rows, setRows] = useState<Row[]>([]);

  // Recompute whenever the theme or contrast level changes (the token values
  // behind the CSS variables change, so we re-read the computed styles).
  useLayoutEffect(() => {
    const next: Row[] = [];
    for (const p of PAIRS) {
      const fg = readTokenColor(p.fg);
      const bg = readTokenColor(p.bg);
      if (!fg || !bg) continue;
      const ratio = contrastRatio(fg, bg);
      next.push({ label: p.label, ratio, level: wcagLevel(ratio, { large: p.large }) });
    }
    setRows(next);
  }, [theme, level]);

  return (
    <div className="space-y-2.5" data-testid="contrast-meter">
      {rows.map((row) => {
        const badge = levelBadge(row.level);
        // Scale the bar against the AAA threshold (7:1) so passing fills it.
        const pct = Math.min(100, Math.round((row.ratio / WCAG_AAA_NORMAL) * 100));
        return (
          <div key={row.label} className="space-y-1" data-testid={`contrast-row-${row.level}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-foreground/80">{row.label}</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {row.ratio.toFixed(2)}:1
                </span>
                <Badge variant={badge.variant} className="text-[10px] px-1.5 py-0">
                  {badge.text}
                </Badge>
              </div>
            </div>
            <Progress value={pct} className="h-1.5" />
          </div>
        );
      })}
      <p className="text-[10px] text-muted-foreground/70 pt-0.5">
        WCAG 2.1 contrast ratios for the current theme. AA needs 4.5:1, AAA needs 7:1.
      </p>
    </div>
  );
}
