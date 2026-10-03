/**
 * The context block a feedback ticket or crash report carries: where the
 * reader was, on what, signed in how, on which build. Kept apart from
 * nip34-feedback.ts so the crash reporter (loaded on every page) does not
 * pull in the ticket pipeline, the relay layer and the whole changelog
 * before anything has crashed.
 */
export interface FeedbackContext {
  route: string;
  viewport: string;
  signerType: string;
  appVersion: string;
}

export function formatContextBlock(ctx: FeedbackContext): string {
  return [
    "",
    "---",
    "Context (auto-attached):",
    `- route: ${ctx.route}`,
    `- viewport: ${ctx.viewport}`,
    `- signer: ${ctx.signerType}`,
    `- app: Relay Outpost ${ctx.appVersion}`,
  ].join("\n");
}
