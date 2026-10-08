/**
 * Light mode: secondary text is one grey (owner, 2026-10-08: "light mode
 * looks just as professional and enterprise ready as dark mode"). The phone
 * audit (ship/a11y-audit.cjs) still found 118 unreadable lines after the
 * status colours, and nearly all were one pattern: the muted grey with an
 * opacity on it. On the lightest tinted surface (--accent) even /90 is under
 * 4.5:1, so there is no "lighter grey" that is still readable — every faint
 * step renders as the muted grey itself, in light mode only.
 *
 * Dark mode is out of scope and must not change: its legibility floor keeps
 * its exact values, now behind `.dark`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = import.meta.dirname;
const CSS = readFileSync(path.join(ROOT, "index.css"), "utf8");
const block = (sel: string) => CSS.slice(CSS.indexOf(sel), CSS.indexOf("}", CSS.indexOf(sel)));
const LIGHT = block(":root {");

const hsl = (name: string): [number, number, number] => {
  const m = LIGHT.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)%\\s+(\\d+)%`));
  if (!m) throw new Error(`no light --${name}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};
function rgb([h, s, l]: [number, number, number]): number[] {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
const lum = (c: number[]) => {
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const over = (fg: number[], bg: number[], a: number) => fg.map((v, i) => v * a + bg[i] * (1 - a));
const ratio = (a: number[], b: number[]) => {
  const A = lum(a), B = lum(b);
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
};

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (p.endsWith(".tsx") && !p.includes(".test.")) out.push(p);
  }
  return out;
}
const ALL = sources(ROOT).map((p) => readFileSync(p, "utf8")).join("\n");
/** Opacity steps the app uses for `text-<token>/NN`, with the variant in front (""/"hover:"/"group-hover:"). */
function used(token: string): Array<[string, number]> {
  const seen = new Set<string>();
  for (const m of ALL.matchAll(new RegExp(`(^|[\\s"'\`{])((?:group-)?hover:)?text-${token}/(\\d+)\\b`, "g"))) seen.add(`${m[2] || ""}|${m[3]}`);
  return [...seen].map((k) => { const [v, n] = k.split("|"); return [v, Number(n)] as [string, number]; });
}
/** The colour the light rule gives a class, or null when no light rule names it. */
function lightColour(variant: string, step: number, token: string): string | null {
  const cls = `.${variant.replace(/:/g, "\\:")}text-${token}\\/${step}`;
  for (const rule of CSS.split("}")) {
    const [sel, body] = rule.split("{");
    if (!body) continue;
    const hit = sel.split(",").some((s) => s.includes(":where(html:not(.dark))") && s.includes(cls) && !s.includes(`${cls}0`) && !new RegExp(`${cls.replace(/[\\.()/:]/g, "\\$&")}\\d`).test(s));
    if (hit) return (body.match(/color:\s*([^;!]+)/) || [])[1]?.trim() ?? null;
  }
  return null;
}

describe("light-mode secondary text", () => {
  const surfaces = ["card", "background", "accent"] as const;

  it("the muted grey itself is readable on every light surface", () => {
    for (const s of surfaces) expect(ratio(rgb(hsl("muted-foreground")), rgb(hsl(s))), s).toBeGreaterThanOrEqual(4.5);
  });

  it("every faint grey the app uses renders as the muted grey (hover too)", () => {
    const missing = used("muted-foreground")
      .filter(([v, n]) => n < 100 && lightColour(v, n, "muted-foreground") !== "hsl(var(--muted-foreground))")
      .map(([v, n]) => `${v}text-muted-foreground/${n}`);
    expect(missing).toEqual([]);
  });

  it("dimmed foreground text never drops below a readable 0.7 (hover too)", () => {
    for (const s of surfaces) expect(ratio(over(rgb(hsl("foreground")), rgb(hsl(s)), 0.7), rgb(hsl(s))), s).toBeGreaterThanOrEqual(4.5);
    const missing = used("foreground")
      .filter(([, n]) => n < 70)
      .filter(([v, n]) => lightColour(v, n, "foreground") !== "hsl(var(--foreground) / 0.7)")
      .map(([v, n]) => `${v}text-foreground/${n}`);
    expect(missing).toEqual([]);
  });

  it("a selected or hovered colour still wins (the light rule is not !important)", () => {
    for (const rule of CSS.split("}")) {
      const [sel, body] = rule.split("{");
      if (body && sel.includes(":where(html:not(.dark))") && /text-(muted-)?foreground\\\//.test(sel)) expect(body, sel.trim().slice(0, 80)).not.toMatch(/!important/);
    }
  });
});

describe("dark mode keeps its legibility floor exactly", () => {
  // The values as they were before light mode got its own rule (index.css,
  // "Legibility floor"). Dark must not move.
  const DARK: Array<[string, number, string]> = [
    ["muted-foreground", 20, "0.42"], ["muted-foreground", 25, "0.48"], ["muted-foreground", 30, "0.54"],
    ["muted-foreground", 35, "0.60"], ["muted-foreground", 40, "0.66"], ["muted-foreground", 45, "0.72"],
    ["muted-foreground", 50, "0.76"],
    ["foreground", 20, "0.46"], ["foreground", 25, "0.52"], ["foreground", 30, "0.58"], ["foreground", 35, "0.64"],
    ["foreground", 40, "0.70"], ["foreground", 45, "0.78"], ["foreground", 50, "0.84"],
  ];
  it.each(DARK)("text-%s/%i stays at %s in dark", (token, step, alpha) => {
    const rule = CSS.split("}").find((r) => r.includes(`:where(.dark) .text-${token}\\/${step},`) && r.includes(`.dark .dark\\:text-${token}\\/${step} {`));
    expect(rule, `dark rule for ${token}/${step}`).toBeDefined();
    expect(rule).toContain(`hsl(var(--${token}) / ${alpha}) !important`);
  });
});
