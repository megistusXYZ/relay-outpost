import { describe, it, expect } from "vitest";
import { parseBuzzDirectory, parseBuzzCommunityRelay, resolveBuzzDirectory } from "./buzz-directory";

// Realistic slice of buzz.directory's Next RSC payload: hrefs to community
// pages with the display name and an access badge streamed nearby.
const FIXTURE = String.raw`
self.__next_f.push([1,"35:[\"$\",\"img\",null,{\"src\":\"https://cdn.example/listing-images/aaa/45ba6083-f4cb-433c-9c73-2c240c1cb4d2/banner.png\"}],[\"$\",\"img\",null,{\"src\":\"https://cdn.example/listing-images/aaa/45ba6083-f4cb-433c-9c73-2c240c1cb4d2/avatar.png\"}]"])
self.__next_f.push([1,"36:[\"$\",\"li\",\"x\",{\"children\":[[\"$\",\"a\",null,{\"href\":\"/communities/buzzbuild-45ba6083f4cb433c9c732c240c1cb4d2\",\"children\":\"Buzzbuild\"}],[\"$\",\"p\",null,{\"className\":\"line-clamp-3\",\"children\":\"A builder community on Buzz where humans and AI agents work side by side.\"}]]}]"])
self.__next_f.push([1,"37:[\"$\",\"img\",null,{\"src\":\"/defaults/community-banner.png\"}],[\"$\",\"img\",null,{\"src\":\"/defaults/community-avatar.png\"}],[\"$\",\"a\",null,{\"href\":\"/communities/malibu-1669bd44ef1340b287814069469ea4c2\",\"children\":\"malibu\"}],[\"$\",\"span\",null,{\"children\":\"Invite\"}]"])
self.__next_f.push([1,"38:[\"$\",\"a\",null,{\"href\":\"/communities/tech-5ffd917e0c0f4dac94c5355dc9a8224f\",\"children\":\"tech\"}],[\"$\",\"span\",null,{\"children\":\"Public\"}]"])
self.__next_f.push([1,"39:[\"$\",\"a\",null,{\"href\":\"/communities/malibu-1669bd44ef1340b287814069469ea4c2\",\"children\":\"dup ignored\"}]"])
`;

describe("parseBuzzDirectory (Buzz communities from the directory's served page)", () => {
  it("extracts slug, display name, the derived relay url, and the access badge", () => {
    const got = parseBuzzDirectory(FIXTURE);
    expect(got).toHaveLength(3);
    expect(got[0]).toMatchObject({
      slug: "buzzbuild-45ba6083f4cb433c9c732c240c1cb4d2",
      name: "Buzzbuild",
      relayUrl: "wss://buzzbuild-45ba6083f4cb433c9c732c240c1cb4d2.communities.buzz.xyz",
      access: null,
    });
    expect(got[1].access).toBe("invite");
    expect(got[2].access).toBe("public");
  });

  it("dedupes by slug — first appearance wins", () => {
    const got = parseBuzzDirectory(FIXTURE);
    expect(got.filter((c) => c.slug.startsWith("malibu")).length).toBe(1);
    expect(got.find((c) => c.slug.startsWith("malibu"))!.name).toBe("malibu");
  });

  it("carries the directory's own description and images when present", () => {
    const got = parseBuzzDirectory(FIXTURE);
    const bb = got.find((c) => c.slug.startsWith("buzzbuild"))!;
    expect(bb.description).toBe("A builder community on Buzz where humans and AI agents work side by side.");
    expect(bb.avatar).toBe("https://cdn.example/listing-images/aaa/45ba6083-f4cb-433c-9c73-2c240c1cb4d2/avatar.png");
    expect(bb.banner).toBe("https://cdn.example/listing-images/aaa/45ba6083-f4cb-433c-9c73-2c240c1cb4d2/banner.png");
    // Entries with no media/copy stay honest: fields absent, not invented —
    // and the directory's DEFAULT placeholder images never count as media.
    const tech = got.find((c) => c.slug.startsWith("tech"))!;
    expect(tech.description).toBeUndefined();
    expect(tech.avatar).toBeUndefined();
    const malibu = got.find((c) => c.slug.startsWith("malibu"))!;
    expect(malibu.avatar).toBeUndefined();
    expect(malibu.banner).toBeUndefined();
  });

  it("returns [] for a page with no communities — never invents entries", () => {
    expect(parseBuzzDirectory("<html><body>maintenance</body></html>")).toEqual([]);
  });
});

describe("parseBuzzCommunityRelay (the community page's own buzz:// deep link)", () => {
  // The ws host is NOT derivable from the directory slug: "Virtual Oranges"
  // lists as virtual-oranges-<uuid> but its relay is virtualoranges.… (hyphens
  // dropped), and PlotPickle's relay is plotpickleplayhouse.… (a different name
  // entirely). The detail page's deep link carries the real URL — measured live
  // 2026-08-28, in both the plain href attribute (&amp;-escaped) and the RSC
  // payload (&-escaped).
  it("extracts the relay from the add-community href form", () => {
    const html = `<a class="x" href="buzz://add-community?relay=wss%3A%2F%2Fvirtualoranges.communities.buzz.xyz%2F&amp;name=Virtual+Oranges">Join</a>`;
    expect(parseBuzzCommunityRelay(html)).toEqual({ relayUrl: "wss://virtualoranges.communities.buzz.xyz" });
  });

  it("extracts the relay from the RSC payload form", () => {
    const html = String.raw`tySlug\":\"virtual-oranges-a8e01c517eac47c6a8e218767d4d28a5\",\"href\":\"buzz://add-community?relay=wss%3A%2F%2Fvirtualoranges.communities.buzz.xyz%2F&name=Virtual+Oranges\"`;
    expect(parseBuzzCommunityRelay(html)).toEqual({ relayUrl: "wss://virtualoranges.communities.buzz.xyz" });
  });

  it("extracts relay AND invite code from the join?relay form", () => {
    // Some communities publish a buzz://join link with a public invite code —
    // passing it in the kind-9021 lets the relay admit the requester directly.
    const html = `href="buzz://join?relay=wss%3A%2F%2Fbuzzbuild.communities.buzz.xyz&amp;code=v2.6-AGUNRVGlsJk7JlEPmw09NQuAO"`;
    expect(parseBuzzCommunityRelay(html)).toEqual({
      relayUrl: "wss://buzzbuild.communities.buzz.xyz",
      inviteCode: "v2.6-AGUNRVGlsJk7JlEPmw09NQuAO",
    });
  });

  it("returns null when the page carries no deep link — never guesses a host", () => {
    expect(parseBuzzCommunityRelay("<html><body>Page not found</body></html>")).toBeNull();
    expect(parseBuzzCommunityRelay(`href="buzz://add-community?name=NoRelay"`)).toBeNull();
  });
});

describe("resolveBuzzDirectory (directory listing + per-community relay ground truth)", () => {
  const pages: Record<string, string | null> = {
    "buzzbuild-45ba6083f4cb433c9c732c240c1cb4d2":
      `href="buzz://join?relay=wss%3A%2F%2Fbuzzbuild.communities.buzz.xyz&amp;code=v2.6-abc"`,
    "malibu-1669bd44ef1340b287814069469ea4c2":
      `href="buzz://add-community?relay=wss%3A%2F%2Fmalibu.communities.buzz.xyz%2F"`,
    // tech's page is unreadable this cycle (fetch failed / no deep link).
    "tech-5ffd917e0c0f4dac94c5355dc9a8224f": null,
  };

  it("replaces every guessed relay url with the detail page's own claim, and carries the invite code", async () => {
    const got = await resolveBuzzDirectory(FIXTURE, async (slug) => pages[slug] ?? null);
    const bb = got.find((c) => c.slug.startsWith("buzzbuild"))!;
    expect(bb.relayUrl).toBe("wss://buzzbuild.communities.buzz.xyz");
    expect(bb.inviteCode).toBe("v2.6-abc");
    const malibu = got.find((c) => c.slug.startsWith("malibu"))!;
    expect(malibu.relayUrl).toBe("wss://malibu.communities.buzz.xyz");
    expect(malibu.inviteCode).toBeUndefined();
  });

  it("drops a community whose relay could not be verified — a dead card is worse than no card", async () => {
    const got = await resolveBuzzDirectory(FIXTURE, async (slug) => pages[slug] ?? null);
    expect(got.find((c) => c.slug.startsWith("tech"))).toBeUndefined();
    expect(got).toHaveLength(2);
  });
});
