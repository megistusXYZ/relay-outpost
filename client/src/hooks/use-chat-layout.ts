/**
 * The group chat's desktop layout (lib/chat-layout), kept on this device.
 * One layout for every group. Saved a beat after the last change, so a drag
 * writes once when it settles rather than on every pointer move.
 */
import { useCallback, useEffect, useState } from "react";
import { CHAT_LAYOUT_KEY, loadChatLayout, saveChatLayout, type ChatLayout } from "@/lib/chat-layout";

const SAVE_AFTER_MS = 200;

/** Before this layout, the only choice kept was "Members panel hidden". */
const LEGACY_MEMBERS_KEY = "ro_chat_members_collapsed";

function readStored(): ChatLayout {
  try {
    return loadChatLayout(localStorage.getItem(CHAT_LAYOUT_KEY), { membersHidden: localStorage.getItem(LEGACY_MEMBERS_KEY) === "1" });
  } catch { return loadChatLayout(null); }
}

export function useChatLayout(): { layout: ChatLayout; update: (change: (l: ChatLayout) => ChatLayout) => void } {
  const [layout, setLayout] = useState<ChatLayout>(readStored);
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(CHAT_LAYOUT_KEY, saveChatLayout(layout)); } catch { /* storage blocked: the layout lasts this visit */ }
    }, SAVE_AFTER_MS);
    return () => clearTimeout(t);
  }, [layout]);
  const update = useCallback((change: (l: ChatLayout) => ChatLayout) => setLayout(change), []);
  return { layout, update };
}
