import { describe, it, expect } from "vitest";
import { clusterNews, significantTokens, type NewsInput } from "./news-corroboration";

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function item(source: string, title: string, ageHours = 1, extra: Partial<NewsInput> = {}): NewsInput {
  return {
    source,
    title,
    link: `https://${source}.test/${title.slice(0, 8)}`,
    pubDateMs: NOW - ageHours * HOUR,
    ...extra,
  };
}

describe("significantTokens", () => {
  it("keeps entities, drops stopwords and filler", () => {
    const t = significantTokens("The BBC reports today: Powell signals rate cut");
    expect(t.has("powell")).toBe(true);
    expect(t.has("rate")).toBe(true);
    expect(t.has("the")).toBe(false);
    expect(t.has("today")).toBe(false);
    expect(t.has("reports")).toBe(false);
  });

  it("normalizes possessives so a name matches across headlines", () => {
    expect(significantTokens("Powell's speech").has("powell")).toBe(true);
  });

  it("drops bare numbers (a year is not a story identifier)", () => {
    expect(significantTokens("Election 2026 results").has("2026")).toBe(false);
  });
});

describe("clusterNews", () => {
  it("merges the same story across outlets into one cluster (the corroboration signal)", () => {
    const clusters = clusterNews([
      item("bbc", "Powell signals interest rate cut at Jackson Hole"),
      item("reuters", "Jackson Hole: Powell signals a rate cut is coming"),
      item("npr", "Powell hints at rate cut in Jackson Hole speech"),
    ], { now: NOW });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].outletCount).toBe(3);
    expect(new Set(clusters[0].sources)).toEqual(new Set(["bbc", "reuters", "npr"]));
  });

  it("counts one outlet once even if it runs the story twice", () => {
    const clusters = clusterNews([
      item("bbc", "Powell signals interest rate cut Jackson Hole", 2),
      item("bbc", "Powell signals interest rate cut Jackson Hole update", 1),
      item("reuters", "Jackson Hole Powell signals rate cut coming", 1),
    ], { now: NOW });
    expect(clusters[0].outletCount).toBe(2);
    // The newest of the duplicate source is kept.
    expect(clusters[0].items.find((i) => i.source === "bbc")!.title).toContain("update");
  });

  it("keeps unrelated stories in separate clusters", () => {
    const clusters = clusterNews([
      item("bbc", "Powell signals interest rate cut Jackson Hole"),
      item("espn", "Chiefs defeat Ravens in overtime thriller"),
    ], { now: NOW });
    expect(clusters).toHaveLength(2);
  });

  it("does not merge headlines that only share stopwords/filler", () => {
    const clusters = clusterNews([
      item("a", "The market news today live"),
      item("b", "Today in live sports news"),
    ], { now: NOW });
    // "market" vs "sports" share nothing significant — two stories.
    expect(clusters).toHaveLength(2);
  });

  it("does not merge the same words far apart in time — a recurring topic is not one event", () => {
    const clusters = clusterNews([
      item("bbc", "Powell signals interest rate cut Jackson Hole", 1),
      item("reuters", "Powell signals interest rate cut Jackson Hole", 100), // >48h
    ], { now: NOW });
    expect(clusters).toHaveLength(2);
  });

  it("ranks a widely-corroborated story above a lightly-covered one of similar age", () => {
    const many = ["a", "b", "c", "d", "e"].map((s) =>
      item(s, "Powell signals interest rate cut Jackson Hole", 2));
    const few = ["x", "y"].map((s) => item(s, "Obscure widget factory opens downtown", 2));
    const clusters = clusterNews([...few, ...many], { now: NOW });
    expect(clusters[0].outletCount).toBe(5);
  });

  it("lets a fresh break outrank a stale pile-up (recency decays corroboration)", () => {
    const stalePile = ["a", "b", "c", "d", "e", "f"].map((s) =>
      item(s, "Old story everyone covered days ago", 40)); // ~40h old, 6 outlets
    const freshBreak = ["x", "y"].map((s) =>
      item(s, "Breaking major event just happened", 0.2)); // 12 min old, 2 outlets
    const clusters = clusterNews([...stalePile, ...freshBreak], { now: NOW });
    expect(clusters[0].sources).toEqual(expect.arrayContaining(["x", "y"]));
  });

  it("picks a lead member that has an image, preferring the newest", () => {
    const clusters = clusterNews([
      item("bbc", "Powell signals interest rate cut Jackson Hole", 3, { thumbnail: "" }),
      item("reuters", "Powell signals interest rate cut Jackson Hole coming", 2, { thumbnail: "https://img.test/a.jpg" }),
      item("npr", "Powell signals interest rate cut Jackson Hole speech", 1, { thumbnail: "" }),
    ], { now: NOW });
    expect(clusters[0].lead.thumbnail).toBe("https://img.test/a.jpg");
  });

  it("drops undated and empty-title items rather than clustering junk", () => {
    const clusters = clusterNews([
      item("bbc", "Powell signals interest rate cut Jackson Hole"),
      { source: "x", title: "", link: "", pubDateMs: NOW },
      { source: "y", title: "Whatever", link: "", pubDateMs: NaN },
    ], { now: NOW });
    expect(clusters).toHaveLength(1);
  });
});
