/**
 * No screen titles on app pages (owner call, 2026-09-28).
 *
 * Pages used to open with a title block ("ACCOUNT", "Analytics Dashboard",
 * "Lightning Wallet", "Relays"…), each styled differently, often with a
 * tagline and sometimes a second Back button under the top bar's. The owner
 * asked for them gone: a page starts with its content, the top bar's back is
 * the only back, and any control or status the title row carried moves into
 * the shared slim PageToolbar so every page lines up the same way.
 *
 * What stays is CONTENT: the name of the thing you opened (a stream, an
 * article, a podcast episode, a profile, a community), help guides and legal
 * documents, whose headline is the document.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const PAGES = resolve(__dirname, "../pages");

// Pages whose <h1> is the content itself. Adding a file here is a deliberate
// call that its heading names a THING, not the screen.
const CONTENT_HEADING_PAGES = new Set([
  // Help guides and legal documents: the headline is the document.
  "ConnectingWallet.tsx", "DataSovereignty.tsx", "EncryptedMessages.tsx",
  "FirstTenMinutes.tsx", "ManagingCrew.tsx", "NostrVsAlternatives.tsx",
  "PublishingPrivacy.tsx", "RelayCommunities.tsx", "SettingUpOutpost.tsx",
  "UsingContentCalendar.tsx", "WhereNostrIsHeading.tsx", "WhyDecentralization.tsx",
  "WotVsAlgorithms.tsx", "WtfIsThis.tsx", "Privacy.tsx", "Covenant.tsx", "ChildSafety.tsx",
  // The thing you opened.
  "ArticleDetail.tsx", "ArticleEditor.tsx", "Community.tsx", "Profile.tsx", "Thread.tsx",
  "MyOutpost.tsx", "LiveStreams.tsx", "RSSFeed.tsx",
  // Relay Control's head names the relay you run, not the console.
  "RelayOpsCenter.tsx",
  // Standalone moments, not app screens.
  "Welcome.tsx", "not-found.tsx", "Generator.tsx",
]);

// In the mixed pages every <h1> must be a content heading, tagged as such.
const CONTENT_H1_TESTIDS: Record<string, string[]> = {
  "LiveStreams.tsx": ["stream-title", "feed-stream-title"],
  "RSSFeed.tsx": ["text-listen-title", "text-article-title", "text-playlist-title"],
  "MyOutpost.tsx": ["text-outpost-name"],
};

function pageFiles() {
  return readdirSync(PAGES).filter((f) => f.endsWith(".tsx") && !f.includes(".test."));
}

function h1Tags(src: string): string[] {
  return src.match(/<h1\b[^>]*>/g) ?? [];
}

describe("app pages open with their content, not a title block", () => {
  it("only content pages render an <h1>", () => {
    const offenders = pageFiles().filter((f) => {
      const src = readFileSync(resolve(PAGES, f), "utf8");
      return h1Tags(src).length > 0 && !CONTENT_HEADING_PAGES.has(f);
    });
    expect(offenders).toEqual([]);
  });

  it("in pages that mix both, every <h1> names the thing you opened", () => {
    const offenders: string[] = [];
    for (const [file, allowed] of Object.entries(CONTENT_H1_TESTIDS)) {
      const src = readFileSync(resolve(PAGES, file), "utf8");
      for (const tag of h1Tags(src)) {
        const id = tag.match(/data-testid="([^"]+)"/)?.[1];
        if (!id || !allowed.includes(id)) offenders.push(`${file}: ${tag.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the top bar's back is the only back on a full page", () => {
  // Each of these sat under the top bar's own back arrow.
  const SECOND_BACKS = [
    "button-manage-back", // the You › Manage pages (wallet, bookmarks, analytics…)
  ];

  it("no page renders a second back under the top bar", () => {
    const offenders = pageFiles().filter((f) => {
      const src = readFileSync(resolve(PAGES, f), "utf8");
      return SECOND_BACKS.some((id) => src.includes(`"${id}"`));
    });
    expect(offenders).toEqual([]);
  });

  it("Analytics has no back of its own", () => {
    const src = readFileSync(resolve(PAGES, "AnalyticsDashboard.tsx"), "utf8");
    expect(src).not.toContain('data-testid="button-back"');
  });

  it("Trust & safety has no '← Settings' link", () => {
    const src = readFileSync(resolve(PAGES, "ShieldMatrix.tsx"), "utf8");
    expect(src).not.toMatch(/<ArrowLeft[^>]*\/>\s*Settings/);
  });
});
