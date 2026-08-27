import { describe, it, expect } from "vitest";
import { classifyMentionSpam } from "./notification-spam";

describe("classifyMentionSpam (mention-fishing shield: airdrop bait from strangers gets filtered, people you trust never do)", () => {
  it("filters promo-bait mentions from untrusted accounts", () => {
    expect(classifyMentionSpam({
      content: "📊 Eligibility confirmed. Damus Airdrop is ready. https://damus.live/",
      flagged: false,
      trusted: false,
    })).toBe("suspect");
  });

  it("never filters someone you trust, even when their words trip the bait patterns", () => {
    expect(classifyMentionSpam({
      content: "lol did you see that fake airdrop spam going around?",
      flagged: false,
      trusted: true,
    })).toBe("ok");
  });

  it("filters flagged accounts regardless of content", () => {
    expect(classifyMentionSpam({ content: "hey, quick question", flagged: true, trusted: false })).toBe("suspect");
  });

  it("leaves ordinary strangers alone — unknown is not spam", () => {
    expect(classifyMentionSpam({ content: "loved your post about relays!", flagged: false, trusted: false })).toBe("ok");
  });
});
