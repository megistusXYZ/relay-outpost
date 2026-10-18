/**
 * What a brand-new account starts with (owner, 2026-10-17): a name, a photo
 * and a banner already chosen, so nothing on the first step has to be typed
 * — "if they care they will update it then or change it later". Each can be
 * shuffled or replaced, and what is chosen is what the profile publishes, so
 * the account looks like someone in every app, not a blank square and an
 * npub. Pure: the photo is an SVG string; components/CreateAccountFlow turns
 * it into a PNG and uploads it like any picture the person picked.
 */

/** A small deterministic generator (mulberry32), so a seed is a picture/name. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed for a new shuffle. */
export function newSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff) + 1;
}

// Plain, friendly words. Every pairing reads as a name someone would keep.
const ADJECTIVES = [
  "Quiet", "Bright", "Gentle", "Swift", "Calm", "Clever", "Brave", "Lucky", "Sunny", "Misty",
  "Silver", "Golden", "Amber", "Cosmic", "Lunar", "Solar", "Starry", "Velvet", "Cedar", "Coral",
  "Copper", "Wandering", "Hidden", "Northern", "Electric", "Curious", "Happy", "Kind", "Bold", "Wild",
  "Little", "Steady", "Polar", "Rapid", "Merry", "Cheerful", "Daring", "Frosty", "Distant", "Mellow",
];
const NOUNS = [
  "Otter", "Falcon", "Fox", "Heron", "Lynx", "Panda", "Badger", "Comet", "Meteor", "Nebula",
  "Orbit", "Rocket", "Harbor", "Meadow", "River", "Canyon", "Willow", "Maple", "Pine", "Fern",
  "Sparrow", "Raven", "Owl", "Wolf", "Bison", "Koala", "Dolphin", "Puffin", "Gecko", "Tiger",
  "Moose", "Beacon", "Lantern", "Compass", "Voyager", "Pilot", "Ranger", "Signal", "Outpost", "Satellite",
];

const pick = <T,>(list: readonly T[], rand: () => number): T => list[Math.floor(rand() * list.length) % list.length];

/** "Quiet Otter": an adjective and a noun. */
export function friendlyName(rand: () => number): string {
  return `${pick(ADJECTIVES, rand)} ${pick(NOUNS, rand)}`;
}

// Two-tone grounds in the app's register: violet first, then its neighbours.
const PALETTES: ReadonlyArray<readonly [string, string]> = [
  ["#7c3aed", "#22d3ee"], ["#4f46e5", "#a78bfa"], ["#0ea5e9", "#14b8a6"], ["#f59e0b", "#ef4444"],
  ["#10b981", "#3b82f6"], ["#db2777", "#8b5cf6"], ["#334155", "#7c3aed"], ["#f97316", "#eab308"],
  ["#0f766e", "#84cc16"], ["#1e3a8a", "#38bdf8"],
];

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A planet with a ring and a few stars on a two-tone ground: a distinct,
 * on-brand picture per seed. Self-contained (no links), 512 × 512.
 */
export function avatarSvg(seed: number): string {
  const rand = seededRandom(seed);
  const [a, b] = pick(PALETTES, rand);
  const angle = Math.floor(rand() * 360);
  const cx = r1(220 + rand() * 72), cy = r1(232 + rand() * 60), r = r1(108 + rand() * 46);
  const tilt = r1(-35 + rand() * 70);
  // The ring stays inside the frame (a ring running off the edge reads as cropped).
  const ringRx = r1(Math.min(r * (1.55 + rand() * 0.35), Math.min(cx, 512 - cx) - 24)), ringRy = r1(r * (0.32 + rand() * 0.16));
  const stars = Array.from({ length: 4 + Math.floor(rand() * 4) }, () => {
    const sx = r1(28 + rand() * 456), sy = r1(28 + rand() * 456), sr = r1(2.5 + rand() * 4.5);
    return `<circle cx="${sx}" cy="${sy}" r="${sr}" fill="#fff" fill-opacity="${r1(0.55 + rand() * 0.4)}"/>`;
  }).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
    `<defs>` +
    `<linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>` +
    `<radialGradient id="p" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity=".55"/></radialGradient>` +
    `</defs>` +
    `<rect width="512" height="512" fill="url(#g)"/>` +
    stars +
    `<g transform="rotate(${tilt} ${cx} ${cy})">` +
    `<ellipse cx="${cx}" cy="${cy}" rx="${ringRx}" ry="${ringRy}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="14"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#p)"/>` +
    `<path d="M ${r1(cx - ringRx)} ${cy} A ${ringRx} ${ringRy} 0 0 0 ${r1(cx + ringRx)} ${cy}" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="14" stroke-linecap="round"/>` +
    `</g>` +
    `</svg>`
  );
}

/** The SVG as an image source, for the preview on the first step. */
export function avatarDataUrl(seed: number): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarSvg(seed))}`;
}

/** The banners a new account can cycle through (the app's own art, regraded). */
export const SIGNUP_BANNERS: ReadonlyArray<{ src: string; name: string }> = [
  { src: "/images/banners/wasteland.jpg", name: "Wasteland" },
  { src: "/images/banners/dusk.jpg", name: "Dusk" },
  { src: "/images/banners/tide.jpg", name: "Tide" },
  { src: "/images/banners/ember.jpg", name: "Ember" },
  { src: "/images/banners/night.jpg", name: "Night" },
];

export function nextBanner(index: number): number {
  return (index + 1) % SIGNUP_BANNERS.length;
}

export function randomBannerIndex(): number {
  return Math.floor(Math.random() * SIGNUP_BANNERS.length);
}

export interface SignupProfileInput {
  typedName: string;
  suggestedName: string;
  username: string;
  bio?: string;
  /** The photo's URL (theirs, or the uploaded one made for them). */
  photoUrl?: string;
  /** The banner's URL (theirs, or the uploaded app banner). */
  bannerUrl?: string;
  nip05?: string;
  website?: string;
  lud16?: string;
}

/** The kind-0 content a new account publishes. Nothing typed? The suggestion. */
export function signupMetadata(input: SignupProfileInput): Record<string, string> {
  const displayName = input.typedName.trim() || input.suggestedName.trim();
  const out: Record<string, string> = {
    name: input.username.trim() || displayName,
    display_name: displayName,
  };
  const add = (key: string, v?: string) => { if (v && v.trim()) out[key] = v.trim(); };
  add("about", input.bio);
  add("picture", input.photoUrl);
  add("banner", input.bannerUrl);
  add("nip05", input.nip05);
  add("website", input.website);
  add("lud16", input.lud16);
  return out;
}
