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

// Grounds from the brand palette (design canvas "Outpost rebrand", 2026-11-16):
// Space White, Paper, Galaxy, Night, Slate and quiet neighbours. Each names
// the ink that sits on it. The Ember dot is the one colour on every picture.
const GROUNDS: ReadonlyArray<readonly [string, string]> = [
  ["#F7F7F8", "#0D0F12"], ["#0A0C10", "#F3F5F8"], ["#FFFFFF", "#0D0F12"], ["#141820", "#F3F5F8"],
  ["#565D69", "#F3F5F8"], ["#E6E8EC", "#0D0F12"], ["#1F2430", "#F3F5F8"], ["#D9DCE3", "#0D0F12"],
  ["#2A3240", "#F3F5F8"], ["#0E1116", "#F3F5F8"],
];
const EMBER = "#FF5B2E";

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Otto's eyes, one mood per picture (the landing's marks, same geometry). */
const MOODS: ReadonlyArray<(ink: string) => string> = [
  (ink) => `<ellipse cx="42" cy="51" rx="3.6" ry="5.2" fill="${ink}"/><ellipse cx="58" cy="51" rx="3.6" ry="5.2" fill="${ink}"/>`,
  (ink) => `<ellipse cx="47" cy="45" rx="3.4" ry="4.8" fill="${ink}"/><ellipse cx="61" cy="45" rx="3.4" ry="4.8" fill="${ink}"/>`,
  (ink) => `<path d="M37 53.5q5-8 10 0M53 53.5q5-8 10 0" fill="none" stroke="${ink}" stroke-width="4.2" stroke-linecap="round"/>`,
  (ink) => `<circle cx="42" cy="50" r="5" fill="${ink}"/><circle cx="58" cy="50" r="5" fill="${ink}"/>`,
  (ink) => `<path d="M37 51.5h10M53 51.5h10" fill="none" stroke="${ink}" stroke-width="4.2" stroke-linecap="round"/>`,
];

/**
 * Otto as a profile picture: the open ring is the head, the Ember dot sits
 * at its opening, and the eyes carry a mood. A distinct picture per seed
 * (ground, mood, size, a slight turn). Self-contained (no links), 512 × 512.
 */
export function avatarSvg(seed: number): string {
  const rand = seededRandom(seed);
  const [ground, ink] = pick(GROUNDS, rand);
  const eyes = pick(MOODS, rand)(ink);
  const scale = r1(3.3 + rand() * 0.6);
  const turn = r1(-9 + rand() * 18);
  const dx = r1(-10 + rand() * 20), dy = r1(-6 + rand() * 12);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
    `<rect width="512" height="512" fill="${ground}"/>` +
    `<g transform="translate(${r1(256 + dx)} ${r1(256 + dy)}) rotate(${turn}) scale(${scale}) translate(-50 -50)">` +
    `<path d="M78.98 42.24 A30 30 0 1 1 57.76 21.02" fill="none" stroke="${ink}" stroke-width="9" stroke-linecap="round"/>` +
    `<circle cx="71.2" cy="28.8" r="6.5" fill="${EMBER}"/>` +
    eyes +
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
