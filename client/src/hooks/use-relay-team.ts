/**
 * The team behind one relay: who's on it, their shared moderation log and
 * their notes about members (lib/team-records.ts, lib/relay-team.ts).
 *
 * While the console is open this also registers the team log sink, so every
 * action any screen records (addModLogEntry) is shared with the team.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import type { Nip11Document } from "@/lib/nip11";
import { loadTeamRumors, publishTeamRecord, type PublishOutcome } from "@/lib/relay-team";
import { foldTeam, recordTags, TEAM_RUMOR_KIND, type RecordType, type TeamRumor, type TeamState } from "@/lib/team-records";
import { setTeamLogSink, type ModerationLogEntry } from "@/pages/relay-ops/shared";

export interface RelayTeam extends TeamState {
  owner: string;
  isOwner: boolean;
  canEncrypt: boolean;
  loading: boolean;
  /** False when the relay couldn't be reached to read the team's records. */
  reached: boolean;
  reload: () => void;
  addNote: (about: string, text: string) => Promise<PublishOutcome>;
  setMembers: (members: string[]) => Promise<PublishOutcome>;
}

export function useRelayTeam(relayUrl: string, nip11: Nip11Document | null, enabled: boolean): RelayTeam {
  const { pubkey, signer } = useNostrAuth();
  const me = (pubkey ?? "").toLowerCase();
  const owner = (nip11?.pubkey && /^[0-9a-f]{64}$/i.test(nip11.pubkey) ? nip11.pubkey : me).toLowerCase();
  const canEncrypt = !!(signer as { nip44?: unknown } | null)?.nip44;
  const [rumors, setRumors] = useState<TeamRumor[]>([]);
  const [loading, setLoading] = useState(false);
  const [reached, setReached] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled || !me || !canEncrypt) return;
    let off = false;
    setLoading(true);
    loadTeamRumors(relayUrl, signer, me).then((r) => {
      if (off) return;
      setRumors(r.rumors);
      setReached(r.reached);
      setLoading(false);
    });
    return () => { off = true; };
  }, [relayUrl, me, canEncrypt, enabled, nonce, signer]);

  const team = useMemo(() => foldTeam(rumors, { owner, me, relayUrl }), [rumors, owner, me, relayUrl]);

  /** Write a record, and show it straight away (the relay has it, or we say it didn't). */
  const write = useCallback(async (type: RecordType, body: Record<string, unknown>, to: readonly string[]) => {
    const out = await publishTeamRecord(relayUrl, signer as { nip44?: unknown }, me, to, type, body);
    if (out.stored) {
      const local: TeamRumor = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        pubkey: me, kind: TEAM_RUMOR_KIND, created_at: Math.floor(Date.now() / 1000),
        tags: recordTags(type, relayUrl), content: JSON.stringify(body),
      };
      setRumors((prev) => [...prev, local]);
    }
    return out;
  }, [relayUrl, signer, me]);

  const addNote = useCallback((about: string, text: string) => write("note", { about: about.toLowerCase(), text: text.trim() }, team.members), [write, team.members]);
  const setMembers = useCallback(async (members: string[]) => {
    if (me !== owner) return { stored: false as const, reason: "Only the relay's owner can change the team." };
    const next = [...new Set([owner, ...members.map((m) => m.toLowerCase())])];
    // The new roster goes to the NEW team: someone removed doesn't get it, or anything after it.
    return write("roster", { members: next }, next);
  }, [write, me, owner]);

  // Every logged action, from any screen, is shared with the team while the console is open.
  useEffect(() => {
    if (!enabled || !canEncrypt || !me) return;
    const sink = (entry: Omit<ModerationLogEntry, "id" | "ts">) => { void write("log", { ...entry }, team.members); };
    setTeamLogSink(relayUrl, sink);
    return () => setTeamLogSink(relayUrl, null);
  }, [relayUrl, enabled, canEncrypt, me, write, team.members]);

  return {
    ...team, owner, isOwner: me === owner, canEncrypt, loading, reached,
    reload: () => setNonce((n) => n + 1), addNote, setMembers,
  };
}
