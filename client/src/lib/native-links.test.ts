// @vitest-environment jsdom
/**
 * A tap on a link to another Nostr client (primal, njump, snort, coracle…)
 * opens the same thing inside Relay Outpost (owner, 2026-09-29). One
 * app-wide handler, so every surface is covered: DMs, chats, bios, captions,
 * event and listing descriptions, articles, link cards. Measured before: most
 * of those opened the other client in a new tab.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { nip19 } from "nostr-tools";
import { installNativeLinks } from "./native-links";

const PK = "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2";
const note = nip19.noteEncode("b".repeat(64));
const npub = nip19.npubEncode(PK);
const calendar = nip19.naddrEncode({ kind: 31922, pubkey: PK, identifier: "x" });

let uninstall: (() => void) | null = null;
afterEach(() => { uninstall?.(); uninstall = null; document.body.innerHTML = ""; });

function setup() {
  const navigate = vi.fn();
  const openTab = vi.fn();
  uninstall = installNativeLinks({ navigate, openTab, origin: "https://relayop.xyz" });
  return { navigate, openTab };
}

function link(href: string, attrs: Record<string, string> = {}) {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  a.textContent = "link";
  document.body.appendChild(a);
  return a;
}

function tap(a: HTMLElement, init: MouseEventInit = {}, type = "click") {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  a.dispatchEvent(e);
  return e;
}

describe("links to other Nostr clients open natively", () => {
  it("a primal note link opens our thread page, not a new tab", () => {
    const { navigate, openTab } = setup();
    const e = tap(link(`https://primal.net/e/${note}`));
    expect(e.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith(`/thread/${note}`);
    expect(openTab).not.toHaveBeenCalled();
  });

  it("an njump profile link opens our profile page", () => {
    const { navigate } = setup();
    tap(link(`https://njump.me/${npub}`));
    expect(navigate).toHaveBeenCalledWith(`/profile/${npub}`);
  });

  it("a nostr: link opens natively too", () => {
    const { navigate } = setup();
    tap(link(`nostr:${npub}`));
    expect(navigate).toHaveBeenCalledWith(`/profile/${npub}`);
  });

  it("the tap doesn't also reach the card around the link", () => {
    setup();
    const card = document.createElement("div");
    const cardClick = vi.fn();
    card.addEventListener("click", cardClick);
    document.body.appendChild(card);
    const a = link(`https://primal.net/e/${note}`);
    card.appendChild(a);
    tap(a);
    expect(cardClick).not.toHaveBeenCalled();
  });

  it("Cmd/Ctrl-click and middle-click open OUR page in a new tab", () => {
    const { navigate, openTab } = setup();
    const a = link(`https://primal.net/e/${note}`);
    tap(a, { metaKey: true });
    tap(a, { ctrlKey: true });
    tap(a, { button: 1 }, "auxclick");
    expect(openTab).toHaveBeenCalledTimes(3);
    expect(openTab).toHaveBeenCalledWith(`https://relayop.xyz/thread/${note}`);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("something we have no page for keeps its original link", () => {
    const { navigate, openTab } = setup();
    const e = tap(link(`https://njump.me/${calendar}`));
    expect(e.defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(openTab).not.toHaveBeenCalled();
  });

  it("ordinary links, our own links and downloads are left alone", () => {
    const { navigate } = setup();
    expect(tap(link("https://example.com/article")).defaultPrevented).toBe(false);
    expect(tap(link(`https://relayop.xyz/thread/${note}`)).defaultPrevented).toBe(false);
    expect(tap(link(`https://primal.net/e/${note}`, { download: "" })).defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
