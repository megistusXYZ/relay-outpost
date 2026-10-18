/**
 * Production allows exactly the inline scripts of the build it serves, by
 * their SHA-256, instead of any inline script at all. These tests pin how the
 * scripts are found and fingerprinted; the page itself was checked in a
 * browser against a production build.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inlineScriptHashes, scriptHashesForDir } from "./csp-hashes";

// The well-known CSP example: this script's sha256, as the spec examples give it.
const HELLO = "alert('Hello, world.');";
const HELLO_HASH = "'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='";

describe("inlineScriptHashes", () => {
  it("fingerprints an inline script's exact text", () => {
    expect(inlineScriptHashes(`<html><script>${HELLO}</script></html>`)).toEqual([HELLO_HASH]);
  });

  it("covers every inline script, with attributes, data blocks included, across lines", () => {
    const html = `<head><script>${HELLO}</script>
<script type="application/ld+json">{"a":1}</script>
<script data-x="y">
  window.x = 1;
</script></head>`;
    const hashes = inlineScriptHashes(html);
    expect(hashes).toHaveLength(3);
    expect(hashes[0]).toBe(HELLO_HASH);
    expect(new Set(hashes).size).toBe(3);
  });

  it("skips scripts loaded from a file", () => {
    expect(inlineScriptHashes(`<script type="module" src="/assets/index.js"></script><script src='/a.js' defer></script>`)).toEqual([]);
  });

  it("is whitespace-exact: one changed byte is a different fingerprint", () => {
    const [a] = inlineScriptHashes(`<script>${HELLO}</script>`);
    const [b] = inlineScriptHashes(`<script>${HELLO} </script>`);
    expect(a).not.toBe(b);
  });
});

describe("scriptHashesForDir", () => {
  it("reads every page at the top of the build folder, once per distinct script", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "csp-"));
    fs.writeFileSync(path.join(dir, "index.html"), `<script>${HELLO}</script><script>b()</script>`);
    fs.writeFileSync(path.join(dir, "other.html"), `<script>${HELLO}</script>`);
    fs.writeFileSync(path.join(dir, "app.js"), `<script>c()</script>`);
    const hashes = scriptHashesForDir(dir);
    expect(hashes).toHaveLength(2);
    expect(hashes).toContain(HELLO_HASH);
  });
});
