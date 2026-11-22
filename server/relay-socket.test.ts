/**
 * The server's sockets to relays refuse a message over a few MB.
 *
 * The ws library's default limit is 100 MiB per message, after inflating a
 * compressed one. Several of the relays the server reads are chosen by
 * someone else (a link preview names one, a push sign-up lists them), so one
 * relay could hand the server a 100 MB message per socket.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import type { AddressInfo } from "net";
import { WebSocketServer } from "ws";
import { openRelaySocket, MAX_RELAY_MESSAGE_BYTES } from "./relay-socket";
import { queryRelay } from "./score-cards";

const BIG = MAX_RELAY_MESSAGE_BYTES + 1024 * 1024;
let relay: WebSocketServer;
let url = "";

beforeAll(async () => {
  // Answers every REQ with one event, oversized when the filter asks for it, then EOSE.
  relay = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  relay.on("connection", (ws) => ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg[0] !== "REQ") return;
    const big = msg[2]?.kinds?.includes(1);
    const content = big ? "x".repeat(BIG) : "small";
    ws.send(JSON.stringify(["EVENT", msg[1], { id: "e1", kind: big ? 1 : 0, content }]));
    ws.send(JSON.stringify(["EOSE", msg[1]]));
  }));
  await new Promise<void>((ok) => relay.on("listening", ok));
  url = `ws://127.0.0.1:${(relay.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => relay.close(() => ok())));

describe("openRelaySocket", () => {
  it("refuses a message over the cap and closes", async () => {
    const ws = openRelaySocket(url);
    const got: number[] = [];
    const errors: string[] = [];
    const closed = new Promise<void>((ok) => ws.on("close", () => ok()));
    ws.on("error", (e) => errors.push(e.message));
    ws.on("message", (d) => got.push((d as Buffer).length));
    ws.on("open", () => ws.send(JSON.stringify(["REQ", "s", { kinds: [1] }])));
    await closed;
    expect(errors.join(" ")).toMatch(/max payload size exceeded/i);
    expect(got).toEqual([]);
  });

  it("still delivers ordinary messages", async () => {
    const ws = openRelaySocket(url);
    const first = new Promise<string>((ok) => ws.on("message", (d) => ok(String(d))));
    ws.on("open", () => ws.send(JSON.stringify(["REQ", "s", { kinds: [0] }])));
    expect(JSON.parse(await first)[2].content).toBe("small");
    ws.close();
  });
});

describe("queryRelay, the server's shared relay reader", () => {
  it("an oversized event never reaches the caller", async () => {
    const r = await queryRelay(url, { kinds: [1] }, 3000);
    expect(r.events).toEqual([]);
    expect(r.answered).toBe(false);
  });

  it("an ordinary answer still comes back", async () => {
    const r = await queryRelay(url, { kinds: [0] }, 3000);
    expect(r.answered).toBe(true);
    expect(r.events.map((e) => (e as { content: string }).content)).toEqual(["small"]);
  });
});

describe("every server socket to a relay goes through openRelaySocket", () => {
  it("no other file constructs a ws WebSocket directly", () => {
    const dir = path.resolve(__dirname);
    const direct = fs
      .readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !/ \d+\.ts$/.test(f) && f !== "relay-socket.ts")
      .flatMap((f) => fs.readFileSync(path.join(dir, f), "utf8").split("\n").map((l, i) => ({ f, i, l })))
      .filter(({ l }) => /new\s+WebSocket\s*\(/.test(l) && !l.trim().startsWith("//"))
      .map(({ f, i, l }) => `${f}:${i + 1}  ${l.trim()}`);
    expect(direct).toEqual([]);
  });
});
