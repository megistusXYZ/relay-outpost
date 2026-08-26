const KEY_PREFIX = "relay_outpost_schedule_key:";

async function getOrCreateKey(pubkey: string): Promise<CryptoKey> {
  const storageKey = KEY_PREFIX + pubkey;
  const stored = localStorage.getItem(storageKey);

  if (stored) {
    try {
      const raw = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
      return await crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
    } catch {
      localStorage.removeItem(storageKey);
    }
  }

  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const exported = await crypto.subtle.exportKey("raw", key);
  localStorage.setItem(storageKey, btoa(String.fromCharCode(...new Uint8Array(exported))));
  return key;
}

export async function encryptForSchedule(data: string, pubkey: string): Promise<string> {
  const key = await getOrCreateKey(pubkey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(data);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptForSchedule(encrypted: string, pubkey: string): Promise<string | null> {
  try {
    const key = await getOrCreateKey(pubkey);
    const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

export function hasScheduleKey(pubkey: string): boolean {
  return !!localStorage.getItem(KEY_PREFIX + pubkey);
}
