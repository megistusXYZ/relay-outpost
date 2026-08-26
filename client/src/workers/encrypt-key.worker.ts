/// <reference lib="webworker" />
import * as nip49 from "nostr-tools/nip49";

interface EncryptRequest {
  id: number;
  secretKey: Uint8Array;
  password: string;
  logn?: number;
}

interface EncryptSuccess {
  id: number;
  ok: true;
  ncryptsec: string;
}

interface EncryptFailure {
  id: number;
  ok: false;
  error: string;
}

type EncryptResponse = EncryptSuccess | EncryptFailure;

self.onmessage = (event: MessageEvent<EncryptRequest>) => {
  const { id, secretKey, password, logn = 16 } = event.data || ({} as EncryptRequest);
  try {
    if (!(secretKey instanceof Uint8Array)) {
      throw new Error("secretKey must be a Uint8Array");
    }
    const ncryptsec = nip49.encrypt(secretKey, password, logn, 0x02);
    const response: EncryptSuccess = { id, ok: true, ncryptsec };
    (self as DedicatedWorkerGlobalScope).postMessage(response);
  } catch (err) {
    const response: EncryptFailure = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as DedicatedWorkerGlobalScope).postMessage(response);
  }
};

export type { EncryptRequest, EncryptResponse };
