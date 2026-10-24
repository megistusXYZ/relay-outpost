/**
 * The words on Settings › Relays & services (pages/SettingsServices.tsx):
 * each address the app uses, matched by host to the server's health check
 * (/api/service-health), with one plain word. Pure, for the page and its test.
 */
import type { ServiceHealthItem } from "./service-health-view";

export type ServiceWord = { text: string; tone: "ok" | "warn" | "bad" | "quiet" };
export type HealthItemWithTarget = ServiceHealthItem & { target?: string };

export const hostOf = (url: string): string => url.replace(/^wss?:\/\//, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");

export function serviceWord(item: ServiceHealthItem | undefined): ServiceWord {
  if (!item) return { text: "Not checked", tone: "quiet" };
  if (item.state === "up") return { text: "Answering", tone: "ok" };
  if (item.state === "empty") return { text: "Answering with nothing", tone: "warn" };
  return { text: "Not answering", tone: "bad" };
}

/** One row per address: its host, and the check's word for that host. */
export function rowsFor(urls: readonly string[], items: readonly HealthItemWithTarget[]): Array<{ name: string; word: ServiceWord }> {
  const byHost = new Map(items.map((i) => [hostOf(i.target ?? i.label), i]));
  return urls.map((u) => ({ name: hostOf(u), word: serviceWord(byHost.get(hostOf(u))) }));
}
