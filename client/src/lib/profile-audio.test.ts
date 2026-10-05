import { describe, it, expect } from "vitest";
import { profileShows, audioFromNotes, isAudioUrl, matchWavlakeArtist } from "./profile-audio";

const show = (status: "planned" | "live" | "ended", over: Record<string, unknown> = {}) => ({
  id: `${status}-${Math.random()}`, pubkey: "aa".repeat(32), dTag: String(Math.random()), title: `A ${status} show`, summary: "",
  status, hashtags: [], participants: [], relays: [], chatEnabled: false, isZapStream: false, event: {} as never, ...over,
});

describe("a profile's shows", () => {
  it("every show it counts is one it lists — a past show without a recording too", () => {
    // Abel James, 2026-10-04: one ended show (V4V Chicago, no recording) made
    // the Audio chip say 1 over "No audio published yet".
    const s = profileShows([show("ended", { starts: 100 })]);
    expect(s.past.map((x) => x.title)).toEqual(["A ended show"]);
    expect(s.count).toBe(1);
  });
  it("splits live, coming up and past; past newest first", () => {
    const s = profileShows([show("ended", { title: "old", starts: 100 }), show("live"), show("planned"), show("ended", { title: "new", starts: 200, recordingUrl: "https://x.qa/r.mp4" })]);
    expect(s.liveNow).toHaveLength(1);
    expect(s.comingUp).toHaveLength(1);
    expect(s.past.map((x) => x.title)).toEqual(["new", "old"]);
    expect(s.count).toBe(4);
  });
  it("no shows, nothing counted", () => {
    expect(profileShows(undefined).count).toBe(0);
  });
});

describe("audio in someone's own notes", () => {
  const note = (content: string, tags: string[][] = [], over: Record<string, unknown> = {}) => ({ id: "n".repeat(64), pubkey: "ab".repeat(32), created_at: 1_700_000_000, kind: 1, content, tags, sig: "s", ...over });
  it("finds an audio file linked in a note", () => {
    const t = audioFromNotes([note("New song, rough mix\nhttps://cdn.qa/songs/swamp-thing.mp3")], "Abel James");
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ audioUrl: "https://cdn.qa/songs/swamp-thing.mp3", title: "New song, rough mix", artist: "Abel James", createdAt: 1_700_000_000 });
  });
  it("finds audio the note declares, even with no extension", () => {
    const t = audioFromNotes([note("demo", [["imeta", "url https://blossom.qa/9f2c", "m audio/mpeg"]])], "Abel");
    expect(t.map((x) => x.audioUrl)).toEqual(["https://blossom.qa/9f2c"]);
  });
  it("leaves pictures and videos alone, and lists a file once", () => {
    const t = audioFromNotes([
      note("jam https://blossom.qa/a.mov", [["imeta", "url https://blossom.qa/a.mov", "m video/quicktime"]]),
      note("pic https://blossom.qa/b.jpg"),
      note("again https://cdn.qa/x.m4a", [], { id: "1".repeat(64) }),
      note("and again https://cdn.qa/x.m4a", [], { id: "2".repeat(64) }),
    ], "Abel");
    expect(t.map((x) => x.audioUrl)).toEqual(["https://cdn.qa/x.m4a"]);
  });
  it("only notes: a repost of someone else's song isn't theirs", () => {
    expect(audioFromNotes([note("https://cdn.qa/x.mp3", [], { kind: 6 })], "Abel")).toEqual([]);
  });
  it("knows audio files by name", () => {
    for (const u of ["https://a.qa/x.mp3", "https://a.qa/x.M4A?dl=1", "https://a.qa/x.flac", "https://a.qa/x.opus", "https://a.qa/x.wav", "https://a.qa/x.ogg", "https://a.qa/x.aac"]) expect(isAudioUrl(u)).toBe(true);
    for (const u of ["https://a.qa/x.mp4", "https://a.qa/x.mov", "https://a.qa/x.jpg", "https://a.qa/mp3"]) expect(isAudioUrl(u)).toBe(false);
  });
});

describe("finding someone's Wavlake page when it doesn't name their Nostr account", () => {
  const abel = { id: "03a6609b", name: "Abel James", website: "https://abeljames.substack.com/", npub: "" };
  const other = { id: "zz", name: "Abel James", website: "https://someone-else.example", npub: "" };
  it("the same name AND the same website is a match", () => {
    expect(matchWavlakeArtist({ name: "Abel James", website: "abeljames.substack.com" }, [abel])).toBe("03a6609b");
    expect(matchWavlakeArtist({ display_name: "abel james ", name: "abel", website: "https://www.abeljames.substack.com" }, [abel])).toBe("03a6609b");
  });
  it("a name alone is not enough — anyone can call themselves Abel James", () => {
    expect(matchWavlakeArtist({ name: "Abel James" }, [abel])).toBeNull();
    expect(matchWavlakeArtist({ name: "Abel James", website: "https://abel.example" }, [abel])).toBeNull();
  });
  it("two artists matching both is no match at all", () => {
    expect(matchWavlakeArtist({ name: "Abel James", website: "abeljames.substack.com" }, [abel, { ...abel, id: "dup" }])).toBeNull();
    expect(matchWavlakeArtist({ name: "Abel James", website: "abeljames.substack.com" }, [abel, other])).toBe("03a6609b");
  });
  it("an artist that names a different Nostr account is never matched by name", () => {
    expect(matchWavlakeArtist({ name: "Abel James", website: "abeljames.substack.com" }, [{ ...abel, npub: "npub1someoneelse" }])).toBeNull();
  });
});
