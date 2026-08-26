import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { nip19 } from "nostr-tools";
import { eventStore, DEFAULT_RELAYS, throttledPoolSubscribe } from "@/lib/nostr";
import type { ClientDisplay } from "@/lib/client-display";

const KIND_HANDLER = 31990;

interface HandlerResolution {
  /** Best icon URL extracted from the handler event, if any. */
  iconUrl: string | null;
  /** True once a signed kind-31990 event for this coordinate has been seen. */
  found: boolean;
}

// Cache NIP-89 handler resolution by coordinate so we never re-fetch a handler
// within a session. found:false = queried relays, nothing came back.
const handlerCache = new Map<string, HandlerResolution>();

function parseCoord(coord: string): { pubkey: string; identifier: string } | null {
  const parts = coord.split(":");
  if (parts.length < 3) return null;
  const pubkey = parts[1];
  const identifier = parts.slice(2).join(":");
  if (!/^[0-9a-f]{64}$/i.test(pubkey)) return null;
  return { pubkey, identifier };
}

function extractHandlerIcon(event: { content?: string; tags?: string[][] }): string | undefined {
  // NIP-89 handler (kind 31990) content is a stringified metadata blob.
  try {
    if (event.content) {
      const meta = JSON.parse(event.content) as { picture?: string; image?: string };
      const url = meta.picture || meta.image;
      if (typeof url === "string" && /^https?:\/\//i.test(url)) return url;
    }
  } catch {}
  // Fallback: an explicit icon/image tag.
  const iconTag = event.tags?.find((t) => (t[0] === "icon" || t[0] === "image") && typeof t[1] === "string");
  if (iconTag && /^https?:\/\//i.test(iconTag[1])) return iconTag[1];
  return undefined;
}

/**
 * Best-effort resolve of the NIP-89 handler event. Never blocks render — the
 * caller shows the name immediately and this swaps an image / arms the in-app
 * link only if (and when) the handler resolves. No fetch when there is no
 * coordinate.
 */
function useHandlerResolution(handlerCoord?: string): HandlerResolution | undefined {
  const [resolution, setResolution] = useState<HandlerResolution | undefined>(() =>
    handlerCoord ? handlerCache.get(handlerCoord) : undefined,
  );

  useEffect(() => {
    if (!handlerCoord) {
      setResolution(undefined);
      return;
    }
    const cachedResolution = handlerCache.get(handlerCoord);
    if (cachedResolution) {
      setResolution(cachedResolution);
      return;
    }
    const parsed = parseCoord(handlerCoord);
    if (!parsed) return;

    const { pubkey, identifier } = parsed;

    const existing = eventStore.getByFilters({ kinds: [KIND_HANDLER], authors: [pubkey], "#d": [identifier] });
    const cached = existing ? [...existing].sort((a, b) => b.created_at - a.created_at)[0] : null;
    if (cached) {
      const resolved: HandlerResolution = { iconUrl: extractHandlerIcon(cached) ?? null, found: true };
      handlerCache.set(handlerCoord, resolved);
      setResolution(resolved);
      return;
    }

    let done = false;
    const relaySet = Array.from(new Set(DEFAULT_RELAYS.slice(0, 4)));
    const sub = throttledPoolSubscribe(
      relaySet,
      { kinds: [KIND_HANDLER], authors: [pubkey], "#d": [identifier], limit: 1 },
      {
        onevent(ev) {
          eventStore.add(ev);
          if (done) return;
          const url = extractHandlerIcon(ev);
          const resolved: HandlerResolution = { iconUrl: url ?? null, found: true };
          handlerCache.set(handlerCoord, resolved);
          setResolution(resolved);
          if (url) done = true;
        },
        oneose() {
          if (!handlerCache.has(handlerCoord)) handlerCache.set(handlerCoord, { iconUrl: null, found: false });
          sub.close();
        },
      },
    );
    return () => sub.close();
  }, [handlerCoord]);

  return resolution;
}

/**
 * Quiet "Posted with [name]" NIP-89 client attribution — plain text, no
 * logos (user call: badges/monograms next to client names read as clutter,
 * and "via" read as jargon). Rendered ONLY on the focused / thread post, and
 * ONLY when the display setting is on. Never authoritative — client tags are
 * self-reported and spoofable (hence the tooltip).
 *
 * Link policy: when the handler coordinate resolves to a real kind-31990
 * event, the badge navigates IN-APP to the handler author's profile — a
 * verifiable identity on the network. We deliberately NEVER render an external
 * URL from the client tag: the tag is self-reported and trivially spoofable,
 * so an outbound link would be a phishing vector wearing a trusted app's name.
 */
export function ClientTagBadge({ display }: { display: ClientDisplay }) {
  const [, navigate] = useLocation();
  const resolution = useHandlerResolution(display.handlerCoord);

  const handlerPubkey = resolution?.found && display.handlerCoord ? parseCoord(display.handlerCoord)?.pubkey : undefined;
  const handlerNpub = useMemo(() => {
    if (!handlerPubkey) return undefined;
    try {
      return nip19.npubEncode(handlerPubkey);
    } catch {
      return undefined;
    }
  }, [handlerPubkey]);

  const inner = (
    <>
      <span className="text-muted-foreground/40 select-none">Posted with</span>
      <span className="truncate">{display.name}</span>
    </>
  );

  if (handlerNpub) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          navigate(`/profile/${handlerNpub}`);
        }}
        className="inline-flex items-center gap-1 max-w-full text-[11px] text-muted-foreground/60 hover:text-muted-foreground align-middle transition-colors cursor-pointer"
        title="Self-reported client — not verified"
        data-testid="client-tag-badge"
      >
        {inner}
      </button>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 max-w-full text-[11px] text-muted-foreground/60 align-middle"
      title="Self-reported client — not verified"
      data-testid="client-tag-badge"
    >
      {inner}
    </span>
  );
}
