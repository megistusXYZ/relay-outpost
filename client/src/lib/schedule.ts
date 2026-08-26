import type { ScheduledPost } from "@shared/schema";
import { nip98 } from "nostr-tools";
import { getGlobalSigner } from "@/lib/nip42-auth";

export type ScheduledPostWithDecrypted = ScheduledPost & {
  decryptedEvent?: any;
  decryptFailed?: boolean;
};

// Optional: send server-scheduled posts to a Relay Outpost backend the user runs
// themselves, instead of this app's origin. Empty (default) = same-origin "/api/*",
// i.e. identical to the built-in behaviour. Stored without a trailing slash.
const SCHEDULER_BASE_URL_KEY = "relay-outpost-scheduler-base-url";

export function getSchedulerBaseUrl(): string {
  try {
    return localStorage.getItem(SCHEDULER_BASE_URL_KEY) || "";
  } catch {
    return "";
  }
}

export function setSchedulerBaseUrl(url: string): void {
  try {
    const v = url.trim().replace(/\/+$/, "");
    if (v) localStorage.setItem(SCHEDULER_BASE_URL_KEY, v);
    else localStorage.removeItem(SCHEDULER_BASE_URL_KEY);
  } catch {}
}

// Absolute URL for a scheduler API path. Both the fetch AND the NIP-98 token are
// built from this exact value so the token's `u` tag always matches the request
// URL (origin + path + query) — required, especially for a custom remote server.
function schedulerUrl(path: string): string {
  const base = getSchedulerBaseUrl();
  return base ? `${base}${path}` : `${window.location.origin}${path}`;
}

// Build a NIP-98 (kind 27235) Authorization header proving control of the
// active pubkey for this exact method + URL. The server rejects any schedule
// request without it, so a token must accompany every read/list/edit/delete.
async function scheduleAuthHeader(method: string, path: string): Promise<Record<string, string>> {
  const signer = getGlobalSigner();
  if (!signer) {
    throw new Error("You must be signed in to manage scheduled posts.");
  }
  const url = schedulerUrl(path);
  const token = await nip98.getToken(url, method, (e) => signer.signEvent(e as any) as any, true);
  return { Authorization: token };
}

export async function createScheduledPost(
  signedEvent: any,
  relayUrls: string[],
  scheduledAt: Date,
  pubkey: string,
  contentPreview: string,
): Promise<ScheduledPost> {
  const res = await fetch(schedulerUrl("/api/schedule"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await scheduleAuthHeader("POST", "/api/schedule")) },
    body: JSON.stringify({
      pubkey,
      encryptedEvent: JSON.stringify(signedEvent),
      relayUrls,
      scheduledAt: scheduledAt.toISOString(),
      kind: signedEvent.kind,
      contentPreview: contentPreview.slice(0, 80),
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error || `Schedule failed (${res.status})`);
  }

  return res.json();
}

export async function getScheduledPosts(pubkey: string): Promise<ScheduledPostWithDecrypted[]> {
  const path = `/api/schedule?pubkey=${encodeURIComponent(pubkey)}`;
  const res = await fetch(schedulerUrl(path), {
    headers: await scheduleAuthHeader("GET", path),
  });
  if (!res.ok) {
    throw new Error("Failed to fetch scheduled posts");
  }

  const posts: ScheduledPost[] = await res.json();

  return posts.map((post) => {
    try {
      return { ...post, decryptedEvent: JSON.parse(post.encryptedEvent) };
    } catch {
      return { ...post, decryptFailed: true };
    }
  });
}

export async function cancelScheduledPost(id: number, pubkey: string): Promise<void> {
  const path = `/api/schedule/${id}?pubkey=${encodeURIComponent(pubkey)}`;
  const res = await fetch(schedulerUrl(path), {
    method: "DELETE",
    headers: await scheduleAuthHeader("DELETE", path),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error || "Failed to cancel");
  }
}

export async function retryScheduledPost(id: number, pubkey: string): Promise<ScheduledPost> {
  const res = await fetch(schedulerUrl(`/api/schedule/${id}/retry`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await scheduleAuthHeader("POST", `/api/schedule/${id}/retry`)) },
    body: JSON.stringify({ pubkey }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error || "Failed to retry");
  }
  return res.json();
}

export async function reschedulePost(id: number, pubkey: string, scheduledAt: Date): Promise<ScheduledPost> {
  const res = await fetch(schedulerUrl(`/api/schedule/${id}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await scheduleAuthHeader("PUT", `/api/schedule/${id}`)) },
    body: JSON.stringify({
      pubkey,
      scheduledAt: scheduledAt.toISOString(),
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error || "Failed to reschedule");
  }
  return res.json();
}

export async function updateScheduledPost(
  id: number,
  pubkey: string,
  updates: {
    scheduledAt: Date;
    signedEvent?: any;
    contentPreview?: string;
    relayUrls?: string[];
    kind?: number;
  },
): Promise<ScheduledPost> {
  const body: Record<string, any> = {
    pubkey,
    scheduledAt: updates.scheduledAt.toISOString(),
  };
  if (updates.signedEvent) body.encryptedEvent = JSON.stringify(updates.signedEvent);
  if (updates.contentPreview !== undefined) body.contentPreview = updates.contentPreview;
  if (updates.relayUrls) body.relayUrls = updates.relayUrls;
  if (updates.kind !== undefined) body.kind = updates.kind;

  const res = await fetch(schedulerUrl(`/api/schedule/${id}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await scheduleAuthHeader("PUT", `/api/schedule/${id}`)) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error || "Failed to update scheduled post");
  }
  return res.json();
}

export function getKindLabel(kind: number): string {
  switch (kind) {
    case 1: return "Note";
    case 1059: return "DM Reminder";
    case 1068: return "Poll";
    case 30023: return "Article";
    default: return `Kind ${kind}`;
  }
}

export function formatScheduledTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const timeStr = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours <= 0) return `Today at ${timeStr}`;
    return `Today at ${timeStr} (in ${diffHours}h)`;
  }
  if (diffDays === 1) return `Tomorrow at ${timeStr}`;
  if (diffDays < 7) {
    return `${d.toLocaleDateString([], { weekday: "long" })} at ${timeStr}`;
  }
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} at ${timeStr}`;
}
