/**
 * Run the suite as if it were on the Node version we actually ship.
 *
 * Production is `node:20-slim` (Dockerfile) and CI pins Node 20 — but a laptop
 * on Node 22+ gets globals Node 20 does not have, and any test that leans on
 * one passes locally and fails only on CI. That is not hypothetical: CI was red
 * for 20 consecutive runs on exactly this, while everyone read a green local
 * run. Two files were affected, and neither failure was visible on a dev
 * machine:
 *
 *   - `WebSocket` (Node 22+): nostr-tools reads the bare global in its relay
 *     constructor, so `new Relay(...)` was a ReferenceError on CI only.
 *   - `sessionStorage` (Node 22+): a test's `try { ... } catch {}` pre-arm
 *     silently no-opped, so two tests hung to a 5s timeout instead of asserting.
 *
 * Deleting the globals reproduces both exactly — verified by reverting the
 * fixes and getting CI's precise 9 failures back.
 *
 * WHAT THIS IS NOT: a Node 20 emulator. It only removes globals. V8 semantics,
 * API behaviour, and stdlib differences are all still whatever this machine
 * runs. It catches the missing-global class — the one that has actually bitten
 * us — and nothing else. CI on real Node 20 remains the authority.
 */

// `delete` on globalThis is the point of this file.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NEWER_THAN_NODE_20 = ["WebSocket", "sessionStorage", "localStorage", "navigator"] as const;

for (const name of NEWER_THAN_NODE_20) {
  delete (globalThis as any)[name];
}
