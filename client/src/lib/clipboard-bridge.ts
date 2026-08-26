const NOSTR_ID_EVENT = "nostr-id-copied";

let lastCopiedId: string | null = null;

export function setLastCopiedNostrId(value: string) {
  lastCopiedId = value;
  window.dispatchEvent(new CustomEvent(NOSTR_ID_EVENT, { detail: value }));
}

export function getLastCopiedNostrId(): string | null {
  return lastCopiedId;
}

export function onNostrIdCopied(callback: (value: string) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<string>).detail;
    if (detail) callback(detail);
  };
  window.addEventListener(NOSTR_ID_EVENT, handler);
  return () => window.removeEventListener(NOSTR_ID_EVENT, handler);
}

export async function copyNostrId(value: string, fallbackCopy = true): Promise<void> {
  if (fallbackCopy) {
    await navigator.clipboard.writeText(value);
  }
  setLastCopiedNostrId(value);
}
