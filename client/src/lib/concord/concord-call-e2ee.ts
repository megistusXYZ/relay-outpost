/**
 * Call encryption for group-chat calls (Concord CORD-07 §3), set up exactly as
 * Armada sets it up (its SenderKeyProvider): LiveKit's frame encryption with a
 * key per caller. Each key is derived outside LiveKit (concord-voice.ts
 * callerFrameKey) from the room's media root and the caller's seat, so every
 * member computes every caller's key with nothing exchanged, and the media
 * server forwards frames it can't read.
 *
 * Imports LiveKit (12 MB): only a call should load this module, lazily.
 */
import { BaseKeyProvider } from "livekit-client";
import { buildAvTokenRequest, callerFrameKey, type VoiceKeys } from "./concord-voice";

export class CallKeyProvider extends BaseKeyProvider {
  constructor() {
    // A key per caller; AES-256 frame keys (LiveKit defaults to 128); and no
    // ratcheting: our keys are derived deterministically, so LiveKit's
    // ratchet-on-failure would quietly move a receiver off the shared
    // derivation and it would stop hearing that caller for good.
    super({ sharedKey: false, ratchetWindowSize: 0, failureTolerance: -1, keySize: 256 });
  }

  /** Install a caller's frame key: HKDF material LiveKit derives from, never readable back. */
  async setCallerKey(material: Uint8Array, identity: string): Promise<void> {
    const key = await crypto.subtle.importKey("raw", material.slice().buffer, "HKDF", false, ["deriveBits", "deriveKey"]);
    this.onSetEncryptionKey(key, identity);
  }
}

/** The little of a LiveKit Room that joining needs, so a test can stand in for it. */
export interface CallRoomLike {
  setE2EEEnabled(enabled: boolean): Promise<void>;
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
}

export interface JoinCallInput {
  /** The room's call keys (concord-voice roomVoiceKeys). */
  keys: VoiceKeys;
  /** The call-token service, e.g. https://relayop.xyz. */
  brokerOrigin: string;
  /** Unix seconds. */
  now: () => number;
  fetch: typeof fetch;
  /** Start LiveKit's encryption worker (new Worker(new URL("livekit-client/e2ee-worker", …))). */
  startWorker: () => Worker;
  /** Build the Room with our encryption (new Room({ e2ee: { keyProvider, worker }, … })). */
  createRoom: (e2ee: { keyProvider: CallKeyProvider; worker: Worker }) => CallRoomLike;
}

export interface JoinedCall {
  room: CallRoomLike;
  /** Our seat: the identity the call-token service gave us. */
  identity: string;
  /** Where every other caller's key goes as their presence arrives. */
  keyProvider: CallKeyProvider;
  worker: Worker;
}

/**
 * Join a room's call, end to end encrypted or not at all. Encryption starts
 * first: a browser that can't run LiveKit's encryption worker (blocked module
 * workers, no insertable streams) gets a clear refusal before a token is even
 * requested; never a quiet unencrypted call.
 */
export async function joinCall(input: JoinCallInput): Promise<JoinedCall> {
  let worker: Worker;
  try {
    worker = input.startWorker();
  } catch (err) {
    throw new Error(`Can't encrypt this call on this browser, so it won't join unencrypted (${String((err as Error)?.message ?? err)})`);
  }
  try {
    // Ask for a seat: signed with the room's call key, so the service learns
    // we hold the room and nothing about who we are.
    const url = `${input.brokerOrigin}/.well-known/concord/av/${input.keys.room}`;
    const res = await input.fetch(url, { headers: { Authorization: buildAvTokenRequest(input.keys, url, input.now()) } });
    const body = (await res.json().catch(() => ({}))) as { token?: string; url?: string; identity?: string; error?: string };
    if (!res.ok || !body.token || !body.url || !body.identity) {
      throw new Error(body.error ?? `The call service answered ${res.status}`);
    }
    const keyProvider = new CallKeyProvider();
    const room = input.createRoom({ keyProvider, worker });
    // Our own key first, then encryption on, then connect: nothing we send
    // leaves this browser before it can be encrypted.
    await keyProvider.setCallerKey(callerFrameKey(input.keys.mediaKey, body.identity, true), body.identity);
    await room.setE2EEEnabled(true);
    await room.connect(body.url, body.token);
    return { room, identity: body.identity, keyProvider, worker };
  } catch (err) {
    worker.terminate();
    throw err;
  }
}
