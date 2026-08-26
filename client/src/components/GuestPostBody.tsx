// Renders a single event's body the way the logged-in feed does — used by the
// guest previews so a shared post/profile-post shows with full fidelity instead
// of raw text. Text (mentions, hashtags, custom emoji; media links stripped by
// contentComponents) goes through the app's own useRenderedContent + the exact
// contentComponents map; media (images / video, e.g. a blossom .mp4) goes through
// MediaRenderer. BOTH are auth-free (they read the event + author profile from
// eventStore, never the logged-in user's pubkey/signer), so this is full logged-in
// fidelity with no signer. Read-only.

import { useMemo } from "react";
import { nip19, type Event } from "nostr-tools";
import { useRenderedContent } from "applesauce-react/hooks";
import { contentComponents, getEventEmojiMap, emojifyChildren, extractNoteRefs, EmbeddedNote, EmbeddedAddressCard } from "@/components/NostrPost";
import { MediaRenderer } from "@/components/MediaRenderer";
import { normalizeNostrClientLinks } from "@/lib/nostr-client-links";

const GUEST_CONTENT_CACHE_KEY = Symbol.for("guest-content-v1");

export function GuestPostBody({ event, compact = false }: { event: Event; compact?: boolean }) {
  const raw = useRenderedContent(event, contentComponents, { cacheKey: GUEST_CONTENT_CACHE_KEY });
  const emojiMap = useMemo(() => getEventEmojiMap(event), [event]);
  const rendered = useMemo(() => (raw && emojiMap ? emojifyChildren(raw, emojiMap) : raw), [raw, emojiMap]);

  // The pinned referenced cards — quoted notes and naddr articles — exactly as
  // the logged-in card renders them (owner call, 2026-08-18): an embedded
  // article/quote IS the shared payload, and a guest preview without it was
  // the post minus its point. Both card components are signer-free, and
  // tapping one lands on that content's own guest preview — reading deepens,
  // engagement still gates.
  const quotedEventId = useMemo(() => event.tags.find((t) => t[0] === "q")?.[1] ?? null, [event]);
  // normalizeNostrClientLinks first, exactly like the logged-in card: a pasted
  // primal.net/njump link becomes a nostr: token BEFORE extraction, or the
  // card it references never exists to pin.
  const noteRefs = useMemo(() => extractNoteRefs(normalizeNostrClientLinks(event.content), quotedEventId), [event.content, quotedEventId]);

  return (
    <div className="flex flex-col gap-2">
      {rendered && (
        <div className={`${compact ? "text-sm" : "text-[15px]"} leading-relaxed break-words whitespace-pre-wrap`}>
          {rendered}
        </div>
      )}
      <MediaRenderer event={event} compact={compact} />
      {!compact && noteRefs.length > 0 && (
        <div className="mt-1.5 space-y-2" data-testid={`guest-quoted-refs-${event.id}`}>
          {noteRefs.slice(0, 2).map((r) =>
            r.kind === "addr" && r.coord ? (
              <EmbeddedAddressCard key={r.key} kind={r.coord.kind} pubkey={r.coord.pubkey} identifier={r.coord.identifier} relays={r.relays} encoded={r.encoded} />
            ) : (
              <EmbeddedNote key={r.key} eventId={r.id!} encoded={r.encoded || nip19.noteEncode(r.id!)} relays={r.relays} />
            )
          )}
        </div>
      )}
    </div>
  );
}
