/**
 * An app error as one block of text for a model (owner, 2026-10-10). The
 * inbox showed the stack, the device and the version as separate pieces, and
 * an admin wanting help from a model had to copy each by hand. This is the
 * whole report, with its ask, ready to paste: what happened, how often and
 * where, the stack, the device, the build, and where the code lives.
 *
 * Nothing about the person who hit it beyond what the anonymous report
 * carried; the stack is the app's own frames. Pure, so the shape is pinned
 * by test.
 */
import type { FeedbackIssue } from "./nip34-feedback";
import { stripContextBlock } from "./nip34-feedback";
import type { CrashGroup } from "./crash-report";

export const REPO_URL = "https://github.com/megistusXYZ/relay-outpost";

function when(ts: number): string {
  try { return new Date(ts * 1000).toISOString(); } catch { return String(ts); }
}

function body(issue: FeedbackIssue, group?: CrashGroup): string {
  const count = group?.count ?? 1;
  const route = group?.route ?? issue.contextBlock?.route ?? null;
  const c = issue.contextBlock;
  const lines = [
    `Happened ${count} ${count === 1 ? "time" : "times"}${route ? ` · last on ${route}` : ""} · last seen ${when(issue.latestActivityAt)}`,
    "",
    "Device details",
    `- Page: ${c?.route ?? "unknown"}`,
    `- Screen: ${c?.viewport ?? "unknown"}`,
    `- Signed in with: ${c?.signerType ?? "unknown"}`,
    `- App version: ${c?.appVersion ?? "unknown"}`,
    "",
    "Report (message, stack, device)",
    "```",
    stripContextBlock(issue.event.content).trim(),
    "```",
  ];
  return lines.join("\n");
}

const ASK = [
  "",
  "What I need",
  `The code is at ${REPO_URL} (React + Vite client in client/src, Express server in server/). Please find the cause, not just a patch: name the file and line the stack points at, say what input or state gets there, and propose the smallest fix with a test that fails before it and passes after.`,
].join("\n");

/** One error, as text. */
export function crashReportText(issue: FeedbackIssue, group?: CrashGroup): string {
  return [`# Relay Outpost app error: ${issue.title}`, "", body(issue, group), ASK, ""].join("\n");
}

/** Every open error at once, numbered, under one heading and one ask. */
export function crashReportsText(items: { issue: FeedbackIssue; group?: CrashGroup }[]): string {
  const parts = items.map(({ issue, group }, i) => [`## ${i + 1}. ${issue.title}`, "", body(issue, group)].join("\n"));
  return [`# Relay Outpost app errors (${items.length})`, "", parts.join("\n\n---\n\n"), ASK, ""].join("\n");
}
