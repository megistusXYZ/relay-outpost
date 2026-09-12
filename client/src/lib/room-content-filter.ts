/**
 * Judge a public room (NIP-29 group) by the only things anyone sees before
 * opening it: its name and description. Pure.
 *
 * - "minors": sexual content paired with a minor. Hidden for good; nothing
 *   reveals it.
 * - "explicit": sexually explicit. Left out unless the viewer opts in.
 * - "ok": everything else.
 *
 * Whole words only, ignoring case and accents, so "Sussex" is not "sex".
 */
export type RoomVerdict = "ok" | "explicit" | "minors";

/** Words that refer to a minor. On their own they're harmless: a teen coding club is fine. */
const MINOR = new Set([
  "teen", "teens", "teenage", "teenager", "teenagers", "underage", "preteen", "preteens",
  "child", "children", "kid", "kids", "minor", "minors", "schoolgirl", "schoolgirls", "schoolboy", "schoolboys",
  // Here, not with the words that need no partner: alone it's a control panel,
  // competitive programming, Canada Post. Beside a sexual word it's hidden for good.
  "cp",
]);

/** Sexual words. Paired with a minor word, the room is hidden for good. */
const SEXUAL = new Set([
  "sex", "sexy", "sexual", "porn", "porno", "nude", "nudes", "naked", "nsfw", "xxx", "erotic", "erotica",
  "horny", "fetish", "kink", "kinky", "bdsm", "slut", "sluts", "whore", "cum", "cock", "dick", "pussy",
  "boobs", "tits", "anal", "blowjob", "onlyfans", "hentai", "cuck", "cucks", "sissy", "milf", "escort", "hookup",
]);

/** Words that on their own mean sexualised children: no second word needed. */
const EXPLOITATION = new Set([
  "jailbait", "loli", "lolis", "lolicon", "shota", "shotacon", "pedo", "pedos", "pedophile", "paedo", "paedophile",
]);

/** The usual stand-ins for letters: p0rn, s3xy, $lut. */
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };

/** Lower-cased, accent-free words, with the usual stand-ins turned back into letters. */
function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[0134579@$]/g, (c) => LEET[c] ?? c)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function classifyRoom(room: { name?: string; about?: string }): RoomVerdict {
  const seen = new Set(words(`${room.name ?? ""} ${room.about ?? ""}`));
  // A plural reads as the word it's built on ("dicks" is "dick"). Found live:
  // the lists hold singulars, and a plural room name slipped past them.
  const has = (list: Set<string>) => [...seen].some((w) =>
    list.has(w) || (w.endsWith("s") && list.has(w.slice(0, -1))) || (w.endsWith("es") && list.has(w.slice(0, -2))));
  if (has(EXPLOITATION)) return "minors";
  if (!has(SEXUAL)) return "ok";
  return has(MINOR) ? "minors" : "explicit";
}

/**
 * A relay's rooms as a list may show them: explicit ones left out unless the
 * viewer opted in, and never a room that sexualises minors. `hidden` is how
 * many were left out, so the list can say so rather than look complete.
 */
export function screenRooms<R extends { name?: string; about?: string }>(
  rooms: R[],
  opts: { showExplicit: boolean },
): { shown: R[]; hidden: number } {
  const shown = rooms.filter((r) => {
    const verdict = classifyRoom(r);
    return verdict === "ok" || (verdict === "explicit" && opts.showExplicit);
  });
  return { shown, hidden: rooms.length - shown.length };
}
