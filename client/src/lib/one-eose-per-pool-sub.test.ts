/**
 * One subscribeMany, ONE oneose.
 *
 * nostr-tools' pool.subscribeMany(relays, …) calls `oneose` once, after every
 * relay in the set has sent EOSE or failed (node_modules/nostr-tools pool.js,
 * handleEose). Code that counts those calls up to relays.length never gets
 * there with more than one relay and silently waits out its timeout. Found
 * 2026-10-06: synced settings (private mode among them) landed 12 s after
 * sign-in; read marks and news bookmarks had the same 10 s wait, and the
 * persistent subscription behind group chats and notifications never said
 * "loaded" at all.
 *
 * Counting is fine when each subscription is to ONE relay (`[relay]`) — then
 * one oneose per subscription is one per relay. This test flags a counter
 * inside a subscribeMany over a whole relay list.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");

// Known, fixed separately: the persistent subscription behind group chats and
// notifications. Finishing there sooner changes when group-chat history stops
// loading, so it ships with a browser check of that, not blind. Remove this
// entry with that fix.
const KNOWN = ["function openPersistentSub("];

function sources(dir: string, out: string[] = []): string[] {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) && !/ 2\.tsx?$/.test(d.name)) out.push(p);
  }
  return out;
}

describe("a pool subscription over many relays says it's done once", () => {
  it("no code counts oneose calls of a many-relay subscribeMany", () => {
    const hits: string[] = [];
    for (const file of sources(SRC)) {
      const src = fs.readFileSync(file, "utf8");
      const re = /subscribeMany\(\s*([^,]+),/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (m[1].trim().startsWith("[")) continue; // one relay per subscription
        const fnStart = src.lastIndexOf("\nfunction ", m.index);
        if (KNOWN.some((k) => src.startsWith(k, fnStart + 1))) continue;
        const next = src.indexOf("subscribeMany(", m.index + 1);
        const body = src.slice(m.index, next === -1 ? m.index + 2000 : Math.min(next, m.index + 2000));
        const oneose = body.search(/oneose\s*(\(\)|:)/);
        if (oneose !== -1 && /eose[A-Za-z]*\s*(\+\+|\+=)/.test(body.slice(oneose, oneose + 400))) {
          hits.push(`${path.relative(SRC, file)}:${src.slice(0, m.index).split("\n").length}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
