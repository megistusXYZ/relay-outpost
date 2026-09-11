/**
 * Group-chat mentions and replies that still need you, as Activity rows. The
 * mention ledger (concord-mentions) says which; the key store says which groups
 * and rooms they're in; the message cache on this device says who wrote what.
 * Nothing decrypted is copied anywhere: rows are rebuilt from the cache.
 */
import { useEffect, useState } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getCommunities, getCachedMessages, type CachedMessage } from "@/lib/concord/concord-keys";
import { readMentionLedger, MENTIONS_CHANGED_EVENT } from "@/lib/concord/concord-mentions";
import { readChannelLastRead } from "@/lib/concord/concord-channel-unread";
import { isMuted, MUTE_CHANGED_EVENT } from "@/lib/concord/concord-mute";
import { CHANGED_EVENT as UNREAD_CHANGED_EVENT, READ_EVENT } from "@/lib/concord/concord-unread";
import { ledgerRows, groupMentionRows, type GroupMentionRow } from "@/lib/concord/concord-activity-mentions";

const EVENTS = [MENTIONS_CHANGED_EVENT, READ_EVENT, MUTE_CHANGED_EVENT, UNREAD_CHANGED_EVENT];

export function useGroupMentions(): GroupMentionRow[] {
  const { pubkey } = useNostrAuth();
  const [rows, setRows] = useState<GroupMentionRow[]>([]);

  useEffect(() => {
    if (!pubkey) { setRows([]); return; }
    let cancelled = false;
    const update = async () => {
      const refs = ledgerRows(readMentionLedger(), readChannelLastRead, isMuted);
      if (refs.length === 0) { if (!cancelled) setRows([]); return; }
      const held = await getCommunities(pubkey).catch(() => []);
      const groups = new Map(held.map((c) => [c.community_id, { name: c.name, channels: c.channels.map((ch) => ({ id: ch.id, name: ch.name })) }]));
      const byRoom = new Map<string, Map<string, CachedMessage>>();
      for (const r of refs) {
        const k = `${r.communityId}|${r.channelId}`;
        if (byRoom.has(k)) continue;
        const cached = await getCachedMessages(pubkey, r.communityId, r.channelId).catch(() => [] as CachedMessage[]);
        byRoom.set(k, new Map(cached.map((m) => [m.id, m])));
      }
      const out = groupMentionRows(refs, groups, (c, ch, id) => byRoom.get(`${c}|${ch}`)?.get(id), pubkey);
      if (!cancelled) setRows(out);
    };
    void update();
    const on = () => void update();
    for (const ev of EVENTS) window.addEventListener(ev, on);
    return () => {
      cancelled = true;
      for (const ev of EVENTS) window.removeEventListener(ev, on);
    };
  }, [pubkey]);

  return rows;
}
