import { db } from "./db";
import { scheduledPosts } from "@shared/schema";
import { eq, lte, and } from "drizzle-orm";
import { Relay } from "nostr-tools";
import WebSocket from "ws";

(globalThis as any).WebSocket = WebSocket;

const BATCH_SIZE = 20;
const PUBLISH_DELAY_MS = 500;
const CRON_INTERVAL_MS = 60_000;
const RELAY_CONNECT_TIMEOUT_MS = 8_000;
const MAX_PUBLISH_RETRIES = 2;
const RETRY_DELAY_MS = 3_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectRelay(url: string, timeoutMs = RELAY_CONNECT_TIMEOUT_MS): Promise<Relay | null> {
  try {
    const relay = await Relay.connect(url);
    return relay;
  } catch (err: any) {
    console.warn(`[Scheduler] Failed to connect to ${url}: ${err.message || err}`);
    return null;
  }
}

async function publishToRelays(
  eventJson: string,
  relayUrls: string[],
): Promise<{ success: boolean; successCount: number; totalRelays: number; failedRelays: string[]; error?: string }> {
  try {
    const event = JSON.parse(eventJson);
    const failedRelays: string[] = [];
    let successCount = 0;

    for (const url of relayUrls) {
      try {
        const relay = await connectRelay(url);
        if (!relay) {
          failedRelays.push(url);
          continue;
        }
        try {
          await relay.publish(event);
          successCount++;
          console.log(`[Scheduler]   ✓ ${url}`);
        } catch (pubErr: any) {
          console.warn(`[Scheduler]   ✗ ${url}: ${pubErr.message || pubErr}`);
          failedRelays.push(url);
        } finally {
          try { relay.close(); } catch {}
        }
      } catch (err: any) {
        failedRelays.push(url);
      }
    }

    if (successCount === 0) {
      return {
        success: false,
        successCount: 0,
        totalRelays: relayUrls.length,
        failedRelays,
        error: `All ${relayUrls.length} relays rejected or failed to connect`,
      };
    }

    console.log(`[Scheduler] Published to ${successCount}/${relayUrls.length} relays`);
    return { success: true, successCount, totalRelays: relayUrls.length, failedRelays };
  } catch (err: any) {
    return {
      success: false,
      successCount: 0,
      totalRelays: relayUrls.length,
      failedRelays: relayUrls,
      error: err.message || "Failed to parse or publish event",
    };
  }
}

async function publishWithRetries(
  eventJson: string,
  relayUrls: string[],
): Promise<{ success: boolean; successCount: number; totalRelays: number; error?: string }> {
  let lastResult = await publishToRelays(eventJson, relayUrls);

  if (lastResult.success && lastResult.failedRelays.length > 0 && lastResult.failedRelays.length < relayUrls.length) {
    for (let retry = 0; retry < MAX_PUBLISH_RETRIES && lastResult.failedRelays.length > 0; retry++) {
      console.log(`[Scheduler] Retrying ${lastResult.failedRelays.length} failed relay(s) (attempt ${retry + 1}/${MAX_PUBLISH_RETRIES})`);
      await sleep(RETRY_DELAY_MS);
      const retryResult = await publishToRelays(eventJson, lastResult.failedRelays);
      lastResult = {
        success: true,
        successCount: lastResult.successCount + retryResult.successCount,
        totalRelays: relayUrls.length,
        failedRelays: retryResult.failedRelays,
      };
    }
  }

  if (!lastResult.success) {
    for (let retry = 0; retry < MAX_PUBLISH_RETRIES; retry++) {
      console.log(`[Scheduler] Full retry (attempt ${retry + 1}/${MAX_PUBLISH_RETRIES})`);
      await sleep(RETRY_DELAY_MS);
      lastResult = await publishToRelays(eventJson, relayUrls);
      if (lastResult.success) break;
    }
  }

  return {
    success: lastResult.success,
    successCount: lastResult.successCount,
    totalRelays: lastResult.totalRelays,
    error: lastResult.error,
  };
}

let isProcessing = false;

async function processPendingPosts() {
  if (isProcessing) {
    console.log("[Scheduler] Skipping — previous run still in progress");
    return;
  }
  isProcessing = true;
  try {
    const now = new Date();
    const pending = await db
      .select()
      .from(scheduledPosts)
      .where(and(eq(scheduledPosts.status, "pending"), lte(scheduledPosts.scheduledAt, now)))
      .limit(BATCH_SIZE);

    if (pending.length === 0) return;

    console.log(`[Scheduler] Processing ${pending.length} pending post(s)`);

    for (const post of pending) {
      const preview = (post.contentPreview || "").slice(0, 40);
      console.log(`[Scheduler] Publishing post #${post.id} (kind ${post.kind}): "${preview}..." → ${post.relayUrls.length} relays`);

      await db
        .update(scheduledPosts)
        .set({ status: "publishing" })
        .where(eq(scheduledPosts.id, post.id));

      const result = await publishWithRetries(post.encryptedEvent, post.relayUrls);

      if (result.success) {
        console.log(`[Scheduler] ✓ Post #${post.id} published to ${result.successCount}/${result.totalRelays} relays`);
        await db
          .update(scheduledPosts)
          .set({ status: "published", publishedAt: new Date() })
          .where(eq(scheduledPosts.id, post.id));
      } else {
        console.error(`[Scheduler] ✗ Post #${post.id} failed: ${result.error}`);
        await db
          .update(scheduledPosts)
          .set({
            status: "failed",
            failureReason: result.error || "Unknown error",
          })
          .where(eq(scheduledPosts.id, post.id));
      }

      await sleep(PUBLISH_DELAY_MS);
    }
  } catch (err) {
    console.error("[Scheduler] Error processing pending posts:", err);
  } finally {
    isProcessing = false;
  }
}

let cronInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduler() {
  if (cronInterval) return;
  console.log("[Scheduler] Started — checking every 60s");
  processPendingPosts();
  cronInterval = setInterval(processPendingPosts, CRON_INTERVAL_MS);
}

export function stopScheduler() {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
    console.log("[Scheduler] Stopped");
  }
}
