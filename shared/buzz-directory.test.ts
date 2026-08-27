import { describe, it, expect } from "vitest";
import { parseBuzzDirectory } from "./buzz-directory";

// Realistic slice of buzz.directory's Next RSC payload: hrefs to community
// pages with the display name and an access badge streamed nearby.
const FIXTURE = String.raw`
self.__next_f.push([1,"36:[\"$\",\"li\",\"x\",{\"children\":[[\"$\",\"a\",null,{\"href\":\"/communities/buzzbuild-45ba6083f4cb433c9c732c240c1cb4d2\",\"children\":\"Buzzbuild\"}]]}]"])
self.__next_f.push([1,"37:[\"$\",\"a\",null,{\"href\":\"/communities/malibu-1669bd44ef1340b287814069469ea4c2\",\"children\":\"malibu\"}],[\"$\",\"span\",null,{\"children\":\"Invite\"}]"])
self.__next_f.push([1,"38:[\"$\",\"a\",null,{\"href\":\"/communities/tech-5ffd917e0c0f4dac94c5355dc9a8224f\",\"children\":\"tech\"}],[\"$\",\"span\",null,{\"children\":\"Public\"}]"])
self.__next_f.push([1,"39:[\"$\",\"a\",null,{\"href\":\"/communities/malibu-1669bd44ef1340b287814069469ea4c2\",\"children\":\"dup ignored\"}]"])
`;

describe("parseBuzzDirectory (Buzz communities from the directory's served page)", () => {
  it("extracts slug, display name, the derived relay url, and the access badge", () => {
    const got = parseBuzzDirectory(FIXTURE);
    expect(got).toHaveLength(3);
    expect(got[0]).toEqual({
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

  it("returns [] for a page with no communities — never invents entries", () => {
    expect(parseBuzzDirectory("<html><body>maintenance</body></html>")).toEqual([]);
  });
});
