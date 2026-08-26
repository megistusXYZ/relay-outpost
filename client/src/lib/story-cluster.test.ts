import { describe, it, expect } from "vitest";
import {
  CLUSTER_SIMILARITY_THRESHOLD,
  clusterStories,
  similarityMatrix,
  tokenize,
  type ClusterableStory,
} from "./story-cluster";

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Real-shaped multi-outlet coverage: the same story phrased the way different
// outlets phrase it (BBC wire-style, NPR explanatory, Verge conversational),
// plus distinct stories that deliberately share keywords. The threshold is
// tuned so these group/separate correctly.

const story = (
  id: string,
  sourceUrl: string,
  title: string,
  description: string,
  pubDate?: string,
): ClusterableStory => ({ id, sourceUrl, title, description, pubDate });

// Story A — a Fed rate cut, three outlets, three phrasings.
const fedBBC = story(
  "bbc-fed",
  "https://feeds.bbci.co.uk/news/rss.xml",
  "Federal Reserve cuts interest rates by half a point",
  "The US central bank has lowered its benchmark interest rate by 0.5 percentage points, citing cooling inflation and a softening labour market.",
  "Wed, 15 Jul 2026 14:02:00 GMT",
);
const fedNPR = story(
  "npr-fed",
  "https://feeds.npr.org/1001/rss.xml",
  "Fed slashes interest rates in surprise half-point cut",
  "The Federal Reserve cut its benchmark interest rate by 50 basis points on Wednesday, a larger move than many economists expected as inflation cools.",
  "Wed, 15 Jul 2026 14:31:00 GMT",
);
const fedVerge = story(
  "verge-fed",
  "https://www.theverge.com/rss/index.xml",
  "The Fed just cut interest rates — here's what it means for you",
  "The Federal Reserve announced a half-point cut to its benchmark interest rate today. Mortgages, savings accounts, and credit cards will all feel it.",
  "Wed, 15 Jul 2026 15:10:00 GMT",
);

// Story B — an earthquake, two outlets.
const quakeBBC = story(
  "bbc-quake",
  "https://feeds.bbci.co.uk/news/rss.xml",
  "Powerful 7.1 magnitude earthquake strikes off the coast of Japan",
  "A magnitude 7.1 earthquake struck off the coast of northern Japan on Thursday, prompting tsunami advisories for coastal prefectures. No casualties reported so far.",
  "Thu, 16 Jul 2026 03:12:00 GMT",
);
const quakeNPR = story(
  "npr-quake",
  "https://feeds.npr.org/1001/rss.xml",
  "Japan issues tsunami advisories after 7.1 magnitude earthquake",
  "A powerful earthquake with a preliminary magnitude of 7.1 hit off northern Japan, and authorities issued tsunami advisories for parts of the coast.",
  "Thu, 16 Jul 2026 03:40:00 GMT",
);

// Distinct stories that SHARE KEYWORDS — must stay separate.
// C1/C2: "Apple" the company vs apples the fruit.
const appleTech = story(
  "verge-apple",
  "https://www.theverge.com/rss/index.xml",
  "Apple announces iPhone satellite messaging expansion",
  "Apple is expanding satellite messaging on the iPhone to more countries, letting users text emergency services without cellular coverage.",
  "Thu, 16 Jul 2026 09:00:00 GMT",
);
const appleFarm = story(
  "npr-apple",
  "https://feeds.npr.org/1001/rss.xml",
  "Washington apple harvest hits record as growers battle heat",
  "Orchardists in Washington state expect a record apple harvest this fall, even as growers battle extreme heat and rising labor costs.",
  "Thu, 16 Jul 2026 10:00:00 GMT",
);
// D1/D2: two DIFFERENT security-patch stories sharing boilerplate vocabulary
// ("releases", "update", "fixing", "security", "flaw") — the classic TF-IDF trap.
const iosPatch = story(
  "verge-ios",
  "https://www.theverge.com/rss/index.xml",
  "Apple releases iOS update fixing zero-day security flaw",
  "Apple shipped an emergency iOS update patching a zero-day security flaw that was being actively exploited through malicious WebKit content.",
  "Thu, 16 Jul 2026 11:00:00 GMT",
);
const androidPatch = story(
  "bbc-android",
  "https://feeds.bbci.co.uk/news/rss.xml",
  "Google releases Android update fixing Bluetooth security flaw",
  "Google has released an Android security update fixing a Bluetooth vulnerability that could let nearby attackers run code on unpatched phones.",
  "Thu, 16 Jul 2026 11:30:00 GMT",
);

// A lone story with no sibling coverage.
const lone = story(
  "npr-otters",
  "https://feeds.npr.org/1001/rss.xml",
  "Sea otter population rebounds along the California coast",
  "Decades of conservation work are paying off as southern sea otters return to kelp forests along the central California coast.",
  "Thu, 16 Jul 2026 12:00:00 GMT",
);

const CORPUS = [fedNPR, quakeBBC, appleTech, fedBBC, androidPatch, lone, quakeNPR, appleFarm, iosPatch, fedVerge];

const clusterOf = (clusters: ReturnType<typeof clusterStories>, id: string) => {
  const c = clusters.find((cl) => cl.itemIds.includes(id));
  expect(c, `no cluster contains ${id}`).toBeDefined();
  return c!;
};

// Harder, real-shaped cases exercised in their own suite below.
// Same story, one outlet phrasing it tersely:
const unitedSky = story(
  "sky-united",
  "https://feeds.skynews.com/feeds/rss/home.xml",
  "Manchester United sack head coach after derby defeat",
  "Manchester United have sacked their head coach following Sunday's derby defeat, with the club sitting twelfth in the Premier League table.",
  "Sun, 12 Jul 2026 20:00:00 GMT",
);
const unitedBBC = story(
  "bbc-united",
  "https://feeds.bbci.co.uk/sport/rss.xml",
  "Man Utd part ways with head coach",
  "Manchester United have parted company with their head coach after the weekend's derby loss left them twelfth in the table.",
  "Sun, 12 Jul 2026 20:45:00 GMT",
);
// Distinct story in the SAME league vocabulary — must not join the United cluster.
const arsenal = story(
  "sky-arsenal",
  "https://feeds.skynews.com/feeds/rss/home.xml",
  "Arsenal go top of the Premier League with late winner",
  "A stoppage-time goal sent Arsenal to the top of the Premier League table on Sunday.",
  "Sun, 12 Jul 2026 19:00:00 GMT",
);
// Shared-entity DISTINCT stories (same person, different events).
const tariffs = story(
  "bbc-tariffs",
  "https://feeds.bbci.co.uk/news/rss.xml",
  "Trump announces new tariffs on Chinese imports",
  "The president said sweeping new tariffs on goods imported from China will take effect next month, escalating the trade dispute.",
  "Fri, 17 Jul 2026 08:00:00 GMT",
);
const fedNominee = story(
  "npr-nominee",
  "https://feeds.npr.org/1001/rss.xml",
  "Trump nominates economist to Federal Reserve board",
  "The president announced his pick for a vacant seat on the Federal Reserve board of governors, an economist known for favoring lower rates.",
  "Fri, 17 Jul 2026 09:00:00 GMT",
);

// ── Grouping / separation (the tuned-threshold contract) ─────────────────────

describe("clusterStories grouping", () => {
  const clusters = clusterStories(CORPUS);

  it("groups the same story across differently-phrased outlets", () => {
    const fed = clusterOf(clusters, "bbc-fed");
    expect([...fed.itemIds].sort()).toEqual(["bbc-fed", "npr-fed", "verge-fed"]);
    const quake = clusterOf(clusters, "bbc-quake");
    expect([...quake.itemIds].sort()).toEqual(["bbc-quake", "npr-quake"]);
  });

  it("keeps distinct stories apart even when they share keywords", () => {
    // Apple-the-company vs apples-the-fruit.
    expect(clusterOf(clusters, "verge-apple").itemIds).toEqual(["verge-apple"]);
    expect(clusterOf(clusters, "npr-apple").itemIds).toEqual(["npr-apple"]);
    // Two different patch stories sharing "releases … update fixing … security flaw".
    expect(clusterOf(clusters, "verge-ios").itemIds).toEqual(["verge-ios"]);
    expect(clusterOf(clusters, "bbc-android").itemIds).toEqual(["bbc-android"]);
  });

  it("leaves singletons as singletons and covers every input exactly once", () => {
    expect(clusterOf(clusters, "npr-otters").itemIds).toEqual(["npr-otters"]);
    const all = clusters.flatMap((c) => c.itemIds).sort();
    expect(all).toEqual(CORPUS.map((s) => s.id).sort());
  });

  it("counts unique outlets per cluster", () => {
    expect(clusterOf(clusters, "bbc-fed").outletCount).toBe(3);
    expect(clusterOf(clusters, "bbc-quake").outletCount).toBe(2);
    expect(clusterOf(clusters, "npr-otters").outletCount).toBe(1);
  });
});

describe("harder real-shaped cases", () => {
  const HARD = [...CORPUS, unitedSky, unitedBBC, arsenal, tariffs, fedNominee];
  const clusters = clusterStories(HARD);

  it("merges a tersely-phrased sibling of the same story", () => {
    const united = clusterOf(clusters, "sky-united");
    expect([...united.itemIds].sort()).toEqual(["bbc-united", "sky-united"]);
  });

  it("keeps a same-league distinct story out of the cluster", () => {
    expect(clusterOf(clusters, "sky-arsenal").itemIds).toEqual(["sky-arsenal"]);
  });

  it("keeps shared-entity distinct stories apart (same person, different events)", () => {
    expect(clusterOf(clusters, "bbc-tariffs").itemIds).toEqual(["bbc-tariffs"]);
    expect(clusterOf(clusters, "npr-nominee").itemIds).toEqual(["npr-nominee"]);
    // …and neither joins the Fed rate-cut cluster despite "Federal Reserve".
    expect(clusterOf(clusters, "bbc-fed").itemIds).not.toContain("npr-nominee");
  });

  it("the threshold sits inside the measured margin between the two bands", () => {
    const m = similarityMatrix(HARD);
    const idx = new Map(HARD.map((s, i) => [s.id, i]));
    const sim = (a: string, b: string) => m[idx.get(a)!][idx.get(b)!];
    // Same-story pairs clear the threshold…
    for (const [a, b] of [
      ["npr-fed", "verge-fed"],
      ["bbc-quake", "npr-quake"],
      ["sky-united", "bbc-united"],
    ] as const) {
      expect(sim(a, b)).toBeGreaterThan(CLUSTER_SIMILARITY_THRESHOLD);
    }
    // …and the worst distinct-story traps stay under it.
    for (const [a, b] of [
      ["verge-ios", "bbc-android"], // shared boilerplate vocabulary
      ["bbc-tariffs", "npr-nominee"], // shared entity, different events
      ["sky-united", "sky-arsenal"], // same league vocabulary
      ["verge-apple", "npr-apple"], // company vs fruit
    ] as const) {
      expect(sim(a, b)).toBeLessThan(CLUSTER_SIMILARITY_THRESHOLD);
    }
  });
});

// ── Lead selection + stable ids ──────────────────────────────────────────────

describe("lead selection and cluster identity", () => {
  it("lead = earliest-published member; clusterId matches it; members ordered by time", () => {
    const clusters = clusterStories(CORPUS);
    const fed = clusterOf(clusters, "bbc-fed");
    expect(fed.leadItemId).toBe("bbc-fed"); // 14:02 < 14:31 < 15:10
    expect(fed.clusterId).toBe("bbc-fed");
    expect(fed.itemIds).toEqual(["bbc-fed", "npr-fed", "verge-fed"]);
  });

  it("keeps the cluster id stable as later copies of the story stream in", () => {
    // Same corpus, minus the latest-published fed item → then it streams in.
    const withoutVerge = CORPUS.filter((s) => s.id !== "verge-fed");
    const before = clusterOf(clusterStories(withoutVerge), "bbc-fed");
    const after = clusterOf(clusterStories(CORPUS), "bbc-fed");
    expect(before.clusterId).toBe("bbc-fed");
    expect(after.clusterId).toBe("bbc-fed"); // new later-published member joins, id unchanged
    expect(after.itemIds).toEqual(["bbc-fed", "npr-fed", "verge-fed"]);
  });

  it("undated members sort after dated ones; ties fall back to input order", () => {
    const undated = { ...fedVerge, id: "verge-undated", pubDate: undefined };
    const corpus = CORPUS.map((s) => (s.id === "verge-fed" ? undated : s));
    const c = clusterOf(clusterStories(corpus), "bbc-fed");
    expect(c.leadItemId).toBe("bbc-fed");
    expect(c.itemIds).toEqual(["bbc-fed", "npr-fed", "verge-undated"]);
  });
});

// ── Determinism / memoization ────────────────────────────────────────────────

describe("determinism and memoization", () => {
  it("re-clustering identical input yields identical output (and the memoized reference)", () => {
    const a = clusterStories(CORPUS);
    const b = clusterStories(CORPUS.map((s) => ({ ...s }))); // same ids, fresh objects
    expect(b).toBe(a); // single-entry memo keyed on the item-id set
    expect(b).toEqual(a);
  });

  it("produces the same grouping for the same input after an unrelated call", () => {
    const first = clusterStories(CORPUS);
    clusterStories([lone, appleFarm]); // bust the memo
    const again = clusterStories(CORPUS);
    expect(again).not.toBe(first); // recomputed…
    expect(again).toEqual(first); // …but identical
  });

  it("cluster order follows first appearance in the input", () => {
    const clusters = clusterStories([lone, fedNPR, fedBBC]);
    expect(clusters.map((c) => c.clusterId)).toEqual(["npr-otters", "bbc-fed"]);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("thin items (too few distinct terms) never cluster", () => {
    const thinA = story("thin-a", "https://a.example/feed", "Update", "");
    const thinB = story("thin-b", "https://b.example/feed", "Update", "");
    const clusters = clusterStories([thinA, thinB]);
    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.itemIds.length === 1)).toBe(true);
  });

  it("handles empty input", () => {
    expect(clusterStories([])).toEqual([]);
  });

  it("strips HTML markup from descriptions before tokenizing", () => {
    expect(tokenize('<p>Fed cuts <b>rates</b> &amp; markets rally</p>')).toEqual([
      "fed", "cuts", "rates", "markets", "rally",
    ]);
  });

  it("same story from the SAME outlet twice still forms one cluster with outletCount 1", () => {
    const rev1 = story(
      "bbc-fed-1",
      "https://feeds.bbci.co.uk/news/rss.xml",
      "Federal Reserve cuts interest rates by half a point",
      "The US central bank has lowered its benchmark interest rate by 0.5 percentage points, citing cooling inflation.",
      "Wed, 15 Jul 2026 14:02:00 GMT",
    );
    const rev2 = story(
      "bbc-fed-2",
      "https://feeds.bbci.co.uk/news/rss.xml",
      "Federal Reserve cuts interest rates by half a point in surprise move",
      "The US central bank lowered its benchmark interest rate by 0.5 percentage points on Wednesday, citing cooling inflation and slower growth.",
      "Wed, 15 Jul 2026 14:20:00 GMT",
    );
    const clusters = clusterStories([rev1, rev2, lone]);
    const c = clusterOf(clusters, "bbc-fed-1");
    expect(c.itemIds).toEqual(["bbc-fed-1", "bbc-fed-2"]);
    expect(c.outletCount).toBe(1);
  });

  it("exposes the tuned threshold", () => {
    expect(CLUSTER_SIMILARITY_THRESHOLD).toBeGreaterThan(0);
    expect(CLUSTER_SIMILARITY_THRESHOLD).toBeLessThan(1);
  });
});
