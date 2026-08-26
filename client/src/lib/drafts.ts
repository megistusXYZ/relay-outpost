const DRAFTS_KEY = "relay_outpost_drafts";
const MAX_DRAFTS = 20;

export interface DraftMediaAttachment {
  id: string;
  url: string;
  type: "image" | "video";
  metadataStripped: boolean;
  /** NIP-92 imeta data carried through from upload (absent on old drafts). */
  mime?: string;
  sha256?: string;
  dim?: string;
  fallbackUrl?: string;
}

export interface DraftAudioAttachment {
  url: string;
  fileName: string;
  title: string;
  coverUrl: string;
  metadataStripped: boolean;
}

export interface Draft {
  id: string;
  content: string;
  mediaAttachments: DraftMediaAttachment[];
  audioAttachment: DraftAudioAttachment | null;
  gifUrl: string | null;
  relayPreset: string;
  relayLabel: string;
  isPollMode?: boolean;
  pollOptions?: string[];
  pollExpiration?: string;
  /** NIP-68 opt-in: restore the picture-post toggle and its optional title. */
  postAsPicture?: boolean;
  pictureTitle?: string;
  createdAt: number;
  updatedAt: number;
}

export function getDrafts(): Draft[] {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return [];
    const drafts: Draft[] = JSON.parse(raw);
    return drafts.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveDraft(draft: Omit<Draft, "id" | "createdAt" | "updatedAt">): Draft {
  const drafts = getDrafts();
  const now = Date.now();
  const newDraft: Draft = {
    ...draft,
    id: `draft-${now}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
  };
  drafts.unshift(newDraft);
  if (drafts.length > MAX_DRAFTS) {
    drafts.length = MAX_DRAFTS;
  }
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  return newDraft;
}

export function updateDraft(id: string, updates: Partial<Omit<Draft, "id" | "createdAt">>): Draft | null {
  const drafts = getDrafts();
  const idx = drafts.findIndex((d) => d.id === id);
  if (idx === -1) return null;
  drafts[idx] = { ...drafts[idx], ...updates, updatedAt: Date.now() };
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  return drafts[idx];
}

export function deleteDraft(id: string): void {
  const drafts = getDrafts().filter((d) => d.id !== id);
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

export function getDraftCount(): number {
  return getDrafts().length;
}

export function formatDraftAge(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}

export function getDraftPreview(draft: Draft): string {
  const prefix = draft.isPollMode ? "📊 " : "";
  if (draft.content.trim()) {
    const text = draft.content.trim().slice(0, 80) + (draft.content.trim().length > 80 ? "…" : "");
    return prefix + text;
  }
  const parts: string[] = [];
  if (draft.isPollMode) parts.push("Poll");
  if (draft.mediaAttachments.length > 0) {
    const imgs = draft.mediaAttachments.filter((m) => m.type === "image").length;
    const vids = draft.mediaAttachments.filter((m) => m.type === "video").length;
    if (imgs > 0) parts.push(`${imgs} image${imgs > 1 ? "s" : ""}`);
    if (vids > 0) parts.push(`${vids} video${vids > 1 ? "s" : ""}`);
  }
  if (draft.audioAttachment) parts.push("audio");
  if (draft.gifUrl) parts.push("GIF");
  return parts.length > 0 ? parts.join(", ") : "Empty draft";
}
