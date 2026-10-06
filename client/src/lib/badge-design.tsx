/**
 * The badge designer's model (owner, 2026-10-06 — badges-plan): a template
 * opens as a design; a design is a shape, a colour and a symbol; badgeSvg()
 * draws it. The live preview shows that drawing and Publish rasterises the
 * same drawing (badge-render.ts), so what you see is what people get.
 *
 * The name and description are never drawn on the picture: text is unreadable
 * at the 16px a badge shows beside a name. They sit next to it instead.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Award, Star, Heart, Shield, Crown, Trophy, Medal, Flame, Zap, Rocket, Sparkles, ThumbsUp,
  Users, MessageCircle, Lightbulb, Wrench, Camera, Music, Mic, Calendar, Flag, Gem, Leaf, Coffee,
  type LucideIcon,
} from "lucide-react";

export type BadgeShape = "circle" | "shield" | "star" | "hexagon";
export const BADGE_SHAPES: BadgeShape[] = ["circle", "shield", "star", "hexagon"];

export const BADGE_COLOURS = {
  violet: { label: "Violet", light: "#A78BFA", dark: "#5B21B6" },
  blue: { label: "Blue", light: "#60A5FA", dark: "#1D4ED8" },
  teal: { label: "Teal", light: "#2DD4BF", dark: "#0F766E" },
  green: { label: "Green", light: "#4ADE80", dark: "#15803D" },
  rose: { label: "Rose", light: "#FB7185", dark: "#BE123C" },
  gold: { label: "Gold", light: "#FDE68A", dark: "#B7791F" },
  silver: { label: "Silver", light: "#F1F5F9", dark: "#8B95A3" },
  bronze: { label: "Bronze", light: "#F2B07A", dark: "#8A4B20" },
} as const;
export type BadgeColour = keyof typeof BADGE_COLOURS;

export const BADGE_ICONS: Record<string, LucideIcon> = {
  award: Award, star: Star, heart: Heart, shield: Shield, crown: Crown, trophy: Trophy, medal: Medal, flame: Flame,
  zap: Zap, rocket: Rocket, sparkles: Sparkles, "thumbs-up": ThumbsUp, users: Users, chat: MessageCircle,
  idea: Lightbulb, tools: Wrench, camera: Camera, music: Music, mic: Mic, calendar: Calendar, flag: Flag,
  gem: Gem, leaf: Leaf, coffee: Coffee,
};
export const BADGE_SYMBOLS = Object.keys(BADGE_ICONS);

export type BadgeSymbol = { kind: "icon"; id: string } | { kind: "emoji"; char: string };

export interface BadgeDesign {
  name: string;
  description: string;
  shape: BadgeShape;
  colour: BadgeColour;
  symbol: BadgeSymbol;
}

const icon = (id: string): BadgeSymbol => ({ kind: "icon", id });
export const BADGE_TEMPLATES: Array<{ id: string; design: BadgeDesign }> = [
  { id: "founding", design: { name: "Founding member", description: "Here from day one.", shape: "shield", colour: "gold", symbol: icon("flag") } },
  { id: "moderator", design: { name: "Moderator", description: "Helps keep this place friendly.", shape: "hexagon", colour: "blue", symbol: icon("shield") } },
  { id: "helper", design: { name: "Helper", description: "Always ready to lend a hand.", shape: "circle", colour: "teal", symbol: icon("heart") } },
  { id: "top", design: { name: "Top contributor", description: "Shares the good stuff, often.", shape: "star", colour: "violet", symbol: icon("trophy") } },
  { id: "event", design: { name: "Event attendee", description: "Was there.", shape: "circle", colour: "rose", symbol: icon("calendar") } },
  { id: "supporter", design: { name: "Supporter", description: "Backs this community.", shape: "shield", colour: "green", symbol: icon("gem") } },
  { id: "thanks", design: { name: "Thank you", description: "For being awesome.", shape: "circle", colour: "gold", symbol: { kind: "emoji", char: "🙏" } } },
  { id: "welcome", design: { name: "Welcome", description: "Glad you're here.", shape: "hexagon", colour: "violet", symbol: { kind: "emoji", char: "👋" } } },
  { id: "blank", design: { name: "", description: "", shape: "circle", colour: "violet", symbol: icon("award") } },
];

function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

function shapeMarkup(shape: BadgeShape, attrs: string): string {
  switch (shape) {
    case "circle": return `<circle cx="50" cy="50" r="46" ${attrs}/>`;
    case "shield": return `<path d="M50 4 L90 17 V47 C90 71 72 87 50 96 C28 87 10 71 10 47 V17 Z" ${attrs}/>`;
    case "star": return `<polygon points="${starPoints(50, 53, 48, 26)}" stroke-linejoin="round" ${attrs}/>`;
    case "hexagon": return `<polygon points="50,4 90,27 90,73 50,96 10,73 10,27" stroke-linejoin="round" ${attrs}/>`;
  }
}

function symbolMarkup(symbol: BadgeSymbol, shape: BadgeShape): string {
  const size = shape === "star" ? 28 : 40;
  const y = shape === "star" ? 53 : 50;
  if (symbol.kind === "emoji") {
    const char = symbol.char.replace(/[<>&"]/g, "");
    return `<text x="50" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="${size}" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif">${char}</text>`;
  }
  const Icon = BADGE_ICONS[symbol.id] ?? Award;
  const inner = renderToStaticMarkup(createElement(Icon, { size, color: "#FFFFFF", strokeWidth: 2 }));
  return `<g transform="translate(${50 - size / 2} ${y - size / 2})">${inner}</g>`;
}

/** The badge picture for a design, as a square SVG (viewBox 0 0 100 100). */
export function badgeSvg(d: Pick<BadgeDesign, "shape" | "colour" | "symbol">): string {
  const c = BADGE_COLOURS[d.colour] ?? BADGE_COLOURS.violet;
  const gid = `g-${d.colour}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">`,
    `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.light}"/><stop offset="1" stop-color="${c.dark}"/></linearGradient></defs>`,
    shapeMarkup(d.shape, `fill="url(#${gid})"`),
    shapeMarkup(d.shape, `fill="none" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="2.5" transform="translate(5 5) scale(0.9)"`),
    symbolMarkup(d.symbol, d.shape),
    `</svg>`,
  ].join("");
}
