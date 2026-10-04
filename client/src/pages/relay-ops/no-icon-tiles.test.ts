import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";

/**
 * No square tinted icon tiles in the operator console (owner, 2026-10-03,
 * "enterprise look": plain icons, hairlines). A tile is a small fixed square
 * with rounded corners and a tinted fill holding an icon. Cover-art
 * placeholders on audio cards are pictures, not tiles — marked data-art.
 */
const DIR = resolve(__dirname);
const FILES = [resolve(DIR, "../RelayOpsCenter.tsx"), ...readdirSync(DIR).filter((f) => f.endsWith(".tsx") && !f.includes(" 2.")).map((f) => resolve(DIR, f))];
const TILE = /\bw-(7|8|9|10|11|12) h-(7|8|9|10|11|12)\b[^"]*\brounded-(md|lg|xl|2xl)\b[^"]*\bbg-(brand|primary|muted)\/|\brounded-(md|lg|xl|2xl)\b[^"]*\bw-(7|8|9|10|11|12) h-(7|8|9|10|11|12)\b[^"]*\bbg-(brand|primary|muted)\//;

describe("the console has no icon tiles", () => {
  it("rows and empty states use plain icons", () => {
    const tiles: string[] = [];
    for (const f of FILES) readFileSync(f, "utf8").split("\n").forEach((l, i) => { if (TILE.test(l) && !/data-art/.test(l)) tiles.push(`${f.split("/").slice(-2).join("/")}:${i + 1}`); });
    expect(tiles).toEqual([]);
  });
});
