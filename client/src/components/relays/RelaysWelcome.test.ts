/**
 * The Relays welcome speaks to a person about their community, not about the
 * protocol (owner, 2026-10-03: "saying too much about the protocol in the
 * software and not about the user and the experience").
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { RelaysWelcome } from "./RelaysWelcome";

const html = renderToStaticMarkup(createElement(Router, { ssrPath: "/my-relays" }, createElement(RelaysWelcome)));
const words = html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("the Relays welcome", () => {
  it("opens on the community, not the technology", () => {
    expect(words).toMatch(/Give your community a home/);
  });

  it("uses no protocol or software words a newcomer would have to look up", () => {
    for (const jargon of [/\bNIP-?\d*\b/i, /\bpyramid\b/i, /\bhaven\b/i, /\bstrfry\b/i, /\bkinds?\b/i, /\bnpub/i, /\bwebsocket|wss:/i, /\bnostr1\b/i]) {
      expect(words, String(jargon)).not.toMatch(jargon);
    }
  });

  it("says 'relay' once, to name the thing — not in every line", () => {
    // Not counting the brand ("Relay Outpost") or a provider's address ("relay.tools").
    const mentions = words.match(/\brelays?\b(?!\.tools| Outpost)/gi) ?? [];
    expect(mentions.length).toBeLessThanOrEqual(1);
  });

  it("leads with how to start, and keeps connecting one you have", () => {
    expect(words.indexOf("Choose how to start")).toBeGreaterThan(-1);
    expect(words.indexOf("Choose how to start")).toBeLessThan(words.indexOf("Already have one?"));
    expect(html).toContain('href="/my-relays/connect"');
  });

  it("says plainly that it's theirs and we take no cut", () => {
    expect(words).toMatch(/never hosts your community or takes a cut/);
  });
});
