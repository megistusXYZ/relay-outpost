/**
 * The Relays welcome speaks to a person about their relay as a space of their
 * own — their people, their posts, their rules — not about the protocol
 * (owner, 2026-10-03: "saying too much about the protocol in the software and
 * not about the user and the experience"; 2026-10-09: say "relay", and make
 * it feel like a space or a community).
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { RelaysWelcome } from "./RelaysWelcome";

const html = renderToStaticMarkup(createElement(Router, { ssrPath: "/my-relays" }, createElement(RelaysWelcome)));
// The self-host card names real software on purpose (owner, 2026-10-03): that
// list is where those names belong, so the jargon check reads everything else.
const SOFTWARE = /<ul[^>]*data-testid="relays-software"[\s\S]*?<\/ul>/;
const words = html.replace(SOFTWARE, " ").replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("the Relays welcome", () => {
  it("opens on your relay as a space of your own, not the technology", () => {
    expect(words).toMatch(/Give your relay a home/);
    expect(words).toMatch(/A relay is a space of your own: your people, their posts, your rules/);
  });

  it("uses no protocol or software words a newcomer would have to look up", () => {
    for (const jargon of [/\bNIP-?\d*\b/i, /\bpyramid\b/i, /\bhaven\b/i, /\bstrfry\b/i, /\bkinds?\b/i, /\bnpub/i, /\bwebsocket|wss:/i, /\bnostr1\b/i]) {
      expect(words, String(jargon)).not.toMatch(jargon);
    }
  });

  it("says 'relay' as the thing you get, every time with 'your' beside it — a space, not a server", () => {
    // Owner, 2026-10-09. Not counting the brand ("Relay Outpost") or the provider ("relay.tools").
    const mentions = words.match(/\b(?:your|a) relays?\b(?!\.tools| Outpost)/gi) ?? [];
    const bare = (words.match(/\brelays?\b(?!\.tools| Outpost)/gi) ?? []).length;
    expect(mentions.length).toBeGreaterThanOrEqual(3);
    expect(bare).toBe(mentions.length);
  });

  it("the hosted card carries the provider's own mark, readable in light as well as dark", () => {
    const hosted = html.match(/<section[^>]*data-testid="relays-start-hosted"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(hosted).toMatch(/data-testid="relay-tools-logo"/);
    expect(hosted).toMatch(/aria-label="relay.tools"/);
    expect(hosted).toMatch(/fill="currentColor"/);
    expect(hosted).toMatch(/relay\.tools keeps it running/);
  });

  it("leads with how to start, and keeps connecting one you have", () => {
    expect(words.indexOf("Choose how to start")).toBeGreaterThan(-1);
    expect(words.indexOf("Choose how to start")).toBeLessThan(words.indexOf("Already have one?"));
    expect(html).toContain('href="/my-relays/connect"');
  });

  it("names real software to run yourself, each linking to its own project", () => {
    const list = html.match(SOFTWARE)?.[0] ?? "";
    for (const name of ["Pyramid", "Newlay", "strfry", "Haven"]) expect(list).toContain(name);
    expect((list.match(/href="https:\/\//g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("opens every link to somewhere else in a new tab, and keeps our own pages in the app", () => {
    const links = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
    const external = links.filter((a) => /href="https?:\/\//.test(a));
    const internal = links.filter((a) => /href="\//.test(a));
    expect(external.length).toBeGreaterThanOrEqual(6);
    for (const a of external) {
      expect(a, a).toMatch(/target="_blank"/);
      expect(a, a).toMatch(/rel="[^"]*noopener[^"]*"/);
    }
    expect(internal.length).toBeGreaterThan(0);
    for (const a of internal) expect(a, a).not.toMatch(/target=/);
  });

  it("says plainly that it's theirs and we take no cut", () => {
    expect(words).toMatch(/never hosts your relay or takes a cut/);
  });
});
