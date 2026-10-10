import { describe, it, expect } from "vitest";
import { parseGtxResponse } from "./translate";

describe("parseGtxResponse — the unofficial gtx wire shape, defensively", () => {
  it("joins multi-segment translations and reads the detected language", () => {
    const wire = [
      [
        ["Hello, world. ", "Hallo, Welt. ", null, null],
        ["How are you?", "Wie geht's?", null, null],
      ],
      null,
      "de",
    ];
    expect(parseGtxResponse(wire)).toEqual({ text: "Hello, world. How are you?", from: "de" });
  });

  it("falls back to 'und' when no detected language is present", () => {
    expect(parseGtxResponse([[["Hi", "Salut"]]])).toEqual({ text: "Hi", from: "und" });
  });

  it("returns null on unexpected shapes (unofficial endpoint may change)", () => {
    expect(parseGtxResponse(null)).toBeNull();
    expect(parseGtxResponse({})).toBeNull();
    expect(parseGtxResponse([])).toBeNull();
    expect(parseGtxResponse(["nope"])).toBeNull();
    expect(parseGtxResponse([[["", ""]], null, "de"])).toBeNull(); // empty translation
  });

  it("skips malformed segments instead of crashing", () => {
    expect(parseGtxResponse([[["Good ", "Gut "], null, ["morning", "Morgen"]], null, "de"]))
      .toEqual({ text: "Good morning", from: "de" });
  });
});

// ── The second keyless lane (owner, 2026-10-10: a brand-new account on an
// iPhone saw Chinese posts with no Translate link). Production's egress IP is
// 429-blocked by Google's gtx hosts, so the proxy answered 502 for everyone
// and the client's fail-closed gate hid every Translate link. Google's
// dictionary-extension endpoint (client=dict-chrome-ex) still answers from
// the same IP; the proxy now falls through to it and sticks with whichever
// lane last worked.
import express from "express";
import { parseDictChromeExResponse, registerTranslateRoute } from "./translate";

describe("parseDictChromeExResponse — the dict-chrome-ex wire shape", () => {
  it("reads text and detected language from the sl=auto shape", () => {
    expect(parseDictChromeExResponse([["Still can't find it?", "zh-CN"]])).toEqual({ text: "Still can't find it?", from: "zh-CN" });
  });
  it("reads the bare-string shape (explicit source) as 'und'", () => {
    expect(parseDictChromeExResponse(["Hello"])).toEqual({ text: "Hello", from: "und" });
  });
  it("returns null on unexpected or empty shapes", () => {
    expect(parseDictChromeExResponse(null)).toBeNull();
    expect(parseDictChromeExResponse([])).toBeNull();
    expect(parseDictChromeExResponse([["", "zh-CN"]])).toBeNull();
    expect(parseDictChromeExResponse({ text: "x" })).toBeNull();
  });
});

describe("POST /api/translate — falls through to the lane that answers", () => {
  const gtxBlocked = () => new Response("<html>Sorry...</html>", { status: 429 });
  const dictOk = (text: string, from = "zh-CN") => new Response(JSON.stringify([[text, from]]), { status: 200, headers: { "content-type": "application/json" } });
  const serve = async (fetcher: (url: string, init?: RequestInit) => Promise<Response>) => {
    const app = express();
    app.use(express.json());
    registerTranslateRoute(app, { fetcher });
    const srv = await new Promise<import("http").Server>((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
    const port = (srv.address() as { port: number }).port;
    const post = (q: string) => fetch(`http://127.0.0.1:${port}/api/translate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q, target: "en" }) });
    return { post, close: () => new Promise<void>((ok) => srv.close(() => ok())) };
  };

  it("gtx blocked (429) → the dictionary lane answers, and the reply carries its text and language", async () => {
    const calls: string[] = [];
    const { post, close } = await serve(async (url) => { calls.push(new URL(url).host); return url.includes("dict-chrome-ex") ? dictOk("Still can't find it?") : gtxBlocked(); });
    const r = await post("还搜不到嘛");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ text: "Still can't find it?", from: "zh-CN" });
    expect(calls).toEqual(["translate.googleapis.com", "clients5.google.com"]);
    await close();
  });

  it("after the dictionary lane answered, the next request asks it first (no 429 round-trip per post)", async () => {
    const calls: string[] = [];
    const { post, close } = await serve(async (url) => { calls.push(new URL(url).host); return url.includes("dict-chrome-ex") ? dictOk("Hello") : gtxBlocked(); });
    await post("你好 1");
    await post("你好 2");
    expect(calls).toEqual(["translate.googleapis.com", "clients5.google.com", "clients5.google.com"]);
    await close();
  });

  it("every lane failing is still 502 (the client's gate hides the link rather than show a broken one)", async () => {
    const { post, close } = await serve(async () => gtxBlocked());
    const r = await post("还搜不到嘛（每条新文本：翻译缓存是一天）"); // a text the earlier tests didn't cache
    expect(r.status).toBe(502);
    await close();
  });
});
