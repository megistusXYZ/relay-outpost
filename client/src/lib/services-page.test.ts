/**
 * The words on Settings › Relays & services (pages/SettingsServices.tsx),
 * from the server's health check: every address the app uses gets the
 * check's word for it, and an address the check doesn't cover says so.
 */
import { describe, it, expect } from "vitest";
import { serviceWord, rowsFor, hostOf } from "./services-page";

const item = (target: string, state: "up" | "empty" | "down") => ({ id: target, label: target, group: "g", state, since: 0, lastChecked: 0, target });

describe("serviceWord", () => {
  it("one plain word per state, and 'Not checked' when the check doesn't cover it", () => {
    expect(serviceWord(item("wss://a", "up"))).toEqual({ text: "Answering", tone: "ok" });
    expect(serviceWord(item("wss://a", "empty"))).toEqual({ text: "Answering with nothing", tone: "warn" });
    expect(serviceWord(item("wss://a", "down"))).toEqual({ text: "Not answering", tone: "bad" });
    expect(serviceWord(undefined)).toEqual({ text: "Not checked", tone: "quiet" });
  });
});

describe("rowsFor", () => {
  it("matches each address to the check by host, whatever the path or scheme", () => {
    const items = [item("wss://cache2.primal.net/v1", "down"), item("https://blossom.primal.net", "up")];
    const rows = rowsFor(["wss://cache2.primal.net/v1/", "https://blossom.primal.net/upload", "wss://unknown.example"], items);
    expect(rows.map((r) => [r.name, r.word.text])).toEqual([
      ["cache2.primal.net", "Not answering"],
      ["blossom.primal.net", "Answering"],
      ["unknown.example", "Not checked"],
    ]);
  });
  it("hostOf strips scheme and path", () => {
    expect(hostOf("wss://relay.damus.io/")).toBe("relay.damus.io");
    expect(hostOf("https://brainstormserver.nosfabrica.com/user/abc")).toBe("brainstormserver.nosfabrica.com");
  });
});
