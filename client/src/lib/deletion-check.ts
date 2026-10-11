/**
 * After a deletion: ask each relay we sent it to whether it still serves the
 * event. A relay that answers with nothing has removed it; one that still
 * returns it keeps copies; one that doesn't answer isn't counted either way.
 */
import { throttledPoolSubscribe } from "./nostr";

export async function verifyDeletion(id: string, relays: string[], timeoutMs = 5000): Promise<{ asked: number; removed: number }> {
  const results = await Promise.all(relays.map((relay) => new Promise<"removed" | "kept" | "silent">((resolve) => {
    let found = false;
    let done = false;
    const finish = (v: "removed" | "kept" | "silent") => { if (done) return; done = true; try { sub.close(); } catch {} resolve(v); };
    const sub = throttledPoolSubscribe([relay], { ids: [id] }, {
      onevent() { found = true; finish("kept"); },
      onrelayeose() { finish(found ? "kept" : "removed"); },
      onrelaydeclined() { finish("silent"); },
      oneose() { /* nostr-tools invents one for failed connects: wait for the relay's own */ },
    });
    setTimeout(() => finish("silent"), timeoutMs);
  })));
  const asked = results.filter((r) => r !== "silent").length;
  const removed = results.filter((r) => r === "removed").length;
  return { asked, removed };
}
