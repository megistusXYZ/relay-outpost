import { useState, useCallback, useRef } from "react";
import { nip19 } from "nostr-tools";
import type { MentionResult } from "@/components/MentionSearch";

interface MentionState {
  active: boolean;
  query: string;
  startPos: number;
}

interface MentionEntry {
  id: number;
  pubkey: string;
  displayName: string;
  token: string;
}

const ZWS = "\u200B";
const ZWNJ = "\u200C";

function encodeId(id: number): string {
  const bits = id.toString(2);
  return bits.split("").map((b) => (b === "0" ? ZWS : ZWNJ)).join("");
}

let mentionIdCounter = 0;

export function useMention() {
  const [mentionState, setMentionState] = useState<MentionState>({
    active: false,
    query: "",
    startPos: -1,
  });
  const mentionTagsRef = useRef<string[][]>([]);
  const mentionEntriesRef = useRef<MentionEntry[]>([]);

  const detectMention = useCallback(
    (text: string, cursorPos: number) => {
      const before = text.slice(0, cursorPos);
      const atIdx = before.lastIndexOf("@");

      if (atIdx === -1) {
        if (mentionState.active) {
          setMentionState({ active: false, query: "", startPos: -1 });
        }
        return;
      }

      const charBefore = atIdx > 0 ? before[atIdx - 1] : " ";
      if (charBefore !== " " && charBefore !== "\n" && atIdx !== 0) {
        if (mentionState.active) {
          setMentionState({ active: false, query: "", startPos: -1 });
        }
        return;
      }

      const queryText = before.slice(atIdx + 1);
      const visibleQuery = queryText.replace(/[\u200B\u200C]/g, "");
      if (visibleQuery.includes(" ") || visibleQuery.includes("\n") || visibleQuery.length > 30) {
        if (mentionState.active) {
          setMentionState({ active: false, query: "", startPos: -1 });
        }
        return;
      }

      setMentionState({ active: true, query: visibleQuery, startPos: atIdx });
    },
    [mentionState.active]
  );

  const insertMention = useCallback(
    (
      result: MentionResult,
      content: string,
      textareaRef: React.RefObject<HTMLTextAreaElement | null>
    ): string => {
      const { startPos } = mentionState;
      if (startPos < 0) return content;

      const id = ++mentionIdCounter;
      const token = `${ZWS}${encodeId(id)}${ZWNJ}`;
      const displayTag = `@${result.displayName}${token}`;
      const cursorPos = textareaRef.current?.selectionStart ?? content.length;

      const before = content.slice(0, startPos);
      const after = content.slice(cursorPos);
      const newContent = `${before}${displayTag} ${after}`;

      mentionTagsRef.current = [
        ...mentionTagsRef.current.filter((t) => t[1] !== result.pubkey),
        ["p", result.pubkey],
      ];

      mentionEntriesRef.current.push({
        id,
        pubkey: result.pubkey,
        displayName: result.displayName,
        token,
      });

      setMentionState({ active: false, query: "", startPos: -1 });

      setTimeout(() => {
        if (textareaRef.current) {
          const newCursorPos = startPos + displayTag.length + 1;
          textareaRef.current.selectionStart = newCursorPos;
          textareaRef.current.selectionEnd = newCursorPos;
          textareaRef.current.focus();
        }
      }, 0);

      return newContent;
    },
    [mentionState]
  );

  const closeMention = useCallback(() => {
    setMentionState({ active: false, query: "", startPos: -1 });
  }, []);

  const resolveContent = useCallback((content: string): string => {
    let resolved = content;
    for (const entry of mentionEntriesRef.current) {
      const displayTag = `@${entry.displayName}${entry.token}`;
      if (resolved.includes(displayTag)) {
        const npub = nip19.npubEncode(entry.pubkey);
        resolved = resolved.split(displayTag).join(`nostr:${npub}`);
      }
    }
    resolved = resolved.replace(/[\u200B\u200C]/g, "");
    return resolved;
  }, []);

  const getMentionTags = useCallback((currentContent: string): string[][] => {
    return mentionTagsRef.current.filter((tag) => {
      const entry = mentionEntriesRef.current.find((e) => e.pubkey === tag[1]);
      if (entry) {
        const displayTag = `@${entry.displayName}${entry.token}`;
        return currentContent.includes(displayTag);
      }
      try {
        const npub = nip19.npubEncode(tag[1]);
        return currentContent.includes(`nostr:${npub}`);
      } catch {
        return false;
      }
    });
  }, []);

  const clearMentionTags = useCallback(() => {
    mentionTagsRef.current = [];
    mentionEntriesRef.current = [];
  }, []);

  return {
    mentionActive: mentionState.active,
    mentionQuery: mentionState.query,
    detectMention,
    insertMention,
    closeMention,
    resolveContent,
    getMentionTags,
    clearMentionTags,
  };
}
