/**
 * The server's sockets to relays, with a cap on message size.
 *
 * The ws library accepts messages up to 100 MiB by default, counted after a
 * compressed message is inflated. Several relays the server reads are chosen
 * by someone else, so every socket the server opens to a relay goes through
 * here (relay-socket.test.ts holds that line). A message over the cap closes
 * the socket with 1009 ("message too big") and is never delivered.
 */
import WebSocket from "ws";

/** Far above any real Nostr message (relays commonly cap events at 128-512 KB). */
export const MAX_RELAY_MESSAGE_BYTES = 4 * 1024 * 1024;

/** A ws socket to a relay, with the message cap. */
export function openRelaySocket(url: string, options: WebSocket.ClientOptions = {}): WebSocket {
  return new WebSocket(url, { ...options, maxPayload: Math.min(options.maxPayload ?? MAX_RELAY_MESSAGE_BYTES, MAX_RELAY_MESSAGE_BYTES) });
}

/**
 * The same cap for nostr-tools, which constructs its own sockets: pass this as
 * its `websocketImplementation` (or set it as the global WebSocket).
 */
export class CappedWebSocket extends WebSocket {
  constructor(address: string | URL, protocols?: string | string[] | WebSocket.ClientOptions, options?: WebSocket.ClientOptions) {
    if (protocols && typeof protocols === "object" && !Array.isArray(protocols)) {
      super(address, { ...protocols, maxPayload: MAX_RELAY_MESSAGE_BYTES });
    } else {
      super(address, protocols, { ...options, maxPayload: MAX_RELAY_MESSAGE_BYTES });
    }
  }
}
