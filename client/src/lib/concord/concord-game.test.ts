import { describe, it, expect } from "vitest";
import { tagToMedia } from "./concord-media";
import { gameCard, isGame, withoutGameLinks } from "./concord-game";

// A game as Armada attaches one (its ChatComposer registerGame): a public .xdc,
// its display name, a filename, the shared session id written twice, and an icon.
const ARMADA_GAME = [
  "imeta",
  "url https://blossom.primal.net/40b3fdab.xdc",
  "m application/vnd.webxdc+zip",
  "webxdc-topic 7hq2w9",
  "webxdc 7hq2w9",
  "summary The Legend of Zelda: Link",
  "name The Legend of Zelda: Link.xdc",
  "image https://cdn.example/zelda.png",
  "thumb https://cdn.example/zelda.png",
];

describe("games in group chats", () => {
  it("keeps a game's name, icon and session from Armada's attachment", () => {
    expect(tagToMedia(ARMADA_GAME)).toMatchObject({
      url: "https://blossom.primal.net/40b3fdab.xdc",
      mime: "application/vnd.webxdc+zip",
      name: "The Legend of Zelda: Link.xdc",
      summary: "The Legend of Zelda: Link",
      thumb: "https://cdn.example/zelda.png",
      webxdc: "7hq2w9",
    });
  });

  it("shows a game by its display name and icon, and never an icon it can't trust", () => {
    const game = tagToMedia(ARMADA_GAME)!;
    expect(gameCard(game)).toEqual({ name: "The Legend of Zelda: Link", icon: "https://cdn.example/zelda.png" });
    // Stored before display names were read: the file name, and the plain game glyph.
    expect(gameCard({ url: game.url, mime: game.mime, name: "The Legend of Zelda: Link.xdc" }))
      .toEqual({ name: "The Legend of Zelda: Link", icon: undefined });
    // An encrypted attachment's thumb is ciphertext; anything but https isn't loaded.
    expect(gameCard({ ...game, key: "aa".repeat(32), iv: "bb".repeat(12) }).icon).toBeUndefined();
    expect(gameCard({ ...game, thumb: "http://cdn.example/zelda.png" }).icon).toBeUndefined();
    expect(gameCard({ ...game, thumb: "javascript:alert(1)" }).icon).toBeUndefined();
    // Nothing to go on at all.
    expect(gameCard({ url: game.url, mime: game.mime }).name).toBe("Game");
  });

  it("spots a game by its type, or by a .xdc name when the type is generic", () => {
    expect(isGame(tagToMedia(ARMADA_GAME)!)).toBe(true);
    expect(isGame({ url: "https://x/y", mime: "application/octet-stream", name: "Chess.xdc" })).toBe(true);
    expect(isGame({ url: "https://x/cat.png", mime: "image/png", name: "cat.png" })).toBe(false);
    expect(isGame({ url: "https://x/doc", mime: "application/pdf", name: "notes.pdf" })).toBe(false);
  });

  it("hides the link in the text that repeats the game's own link, and nothing else", () => {
    const game = tagToMedia(ARMADA_GAME)!;
    const link = "https://blossom.primal.net/40b3fdab.xdc";
    expect(withoutGameLinks(link, [game])).toBe("");
    expect(withoutGameLinks(`Play this!\n${link}`, [game])).toBe("Play this!");
    expect(withoutGameLinks(`see https://example.com and ${link}`, [game])).toBe("see https://example.com and");
    // No game attached: the text is left exactly as written.
    expect(withoutGameLinks(link, [])).toBe(link);
  });
});
