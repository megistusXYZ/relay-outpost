import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NIP86_METHODS, isNip86Method } from "./nip86-methods";

const root = path.resolve(import.meta.dirname, "..");

describe("the relay management methods", () => {
  it("include saving a community's banner and moderators", () => {
    expect(isNip86Method("changerelaybanner")).toBe(true);
    expect(isNip86Method("changerelaymoderators")).toBe(true);
    expect(isNip86Method("rm -rf")).toBe(false);
  });

  it("are one list: the server's proxy allows exactly what the app can call", () => {
    const routes = readFileSync(path.join(root, "server/routes.ts"), "utf8");
    expect(routes).toMatch(/NIP86_ALLOWED_METHODS = new Set<string>\(NIP86_METHODS\)/);
    expect(routes).not.toMatch(/NIP86_ALLOWED_METHODS = new Set\(\[/);
    const client = readFileSync(path.join(root, "client/src/lib/nip86.ts"), "utf8");
    expect(client).toMatch(/from "@shared\/nip86-methods"/);
    expect(client).not.toMatch(/export type Nip86Method =\s*\n\s*\|/);
  });

  it("every method the app calls by name is in the list", () => {
    const client = readFileSync(path.join(root, "client/src/lib/nip86.ts"), "utf8");
    const called = [...client.matchAll(/nip86Call(?:<[^>]*>)?\(\s*relayUrl,\s*"([a-z]+)"/g)].map((m) => m[1]);
    expect(called.length).toBeGreaterThan(10);
    for (const m of called) expect(NIP86_METHODS, m).toContain(m);
  });
});
