import { type EdgeVoice, RECOMMENDED_VOICES } from "@/contexts/TextToSpeechContext";
import { Play, Square } from "lucide-react";
import { useState, useMemo, useCallback, useSyncExternalStore } from "react";
import { registerAudioSource, unregisterAudioSource } from "@/lib/audio-coordinator";

const RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export function SpeechReaderBar({ hidden = false }: { hidden?: boolean }) {
  return null;
}

function formatVoiceName(name: string): string {
  return name
    .replace("Microsoft Server Speech Text to Speech Voice ", "")
    .replace(/\(.*\)/, "")
    .replace(/Microsoft\s*/gi, "")
    .replace(/\bOnline\b/gi, "")
    .replace(/\bNeural\b/gi, "")
    .replace(/\bMultilingual\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const previewStore = {
  activeVoiceId: null as string | null,
  audio: null as HTMLAudioElement | null,
  sessionId: 0,
  listeners: new Set<() => void>(),
  subscribe(cb: () => void) { previewStore.listeners.add(cb); return () => { previewStore.listeners.delete(cb); }; },
  getSnapshot() { return previewStore.activeVoiceId; },
  notify() { previewStore.listeners.forEach((fn) => fn()); },
  stop() {
    previewStore.sessionId++;
    previewStore.activeVoiceId = null;
    if (previewStore.audio) {
      previewStore.audio.pause();
      previewStore.audio.src = "";
      previewStore.audio = null;
      unregisterAudioSource("voice-preview");
    }
    previewStore.notify();
  },
};

function VoicePreviewButton({ voiceId }: { voiceId: string }) {
  const activeVoice = useSyncExternalStore(previewStore.subscribe, previewStore.getSnapshot);
  const isActive = activeVoice === voiceId;

  const handlePreview = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const wasThisPlaying = previewStore.activeVoiceId === voiceId;
    previewStore.stop();
    if (wasThisPlaying) return;

    previewStore.activeVoiceId = voiceId;
    previewStore.notify();
    const session = ++previewStore.sessionId;
    try {
      const resp = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Welcome to Relay Outpost. This is how I'll sound as I read your feed, your articles, and everything in between.", voice: voiceId }),
      });
      if (session !== previewStore.sessionId) return;
      if (!resp.ok) throw new Error("Preview failed");
      const blob = await resp.blob();
      if (session !== previewStore.sessionId) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      const onDone = () => { URL.revokeObjectURL(url); previewStore.activeVoiceId = null; previewStore.audio = null; unregisterAudioSource("voice-preview"); previewStore.notify(); };
      previewStore.audio = audio;
      registerAudioSource("voice-preview", () => { audio.pause(); audio.src = ""; onDone(); });
      audio.onended = onDone;
      audio.onerror = onDone;
      await audio.play();
    } catch {
      if (session === previewStore.sessionId) { previewStore.activeVoiceId = null; previewStore.notify(); }
    }
  }, [voiceId]);

  return (
    <button
      onClick={handlePreview}
      className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
        isActive ? "bg-brand/20 text-brand" : "hover:bg-muted/30 text-muted-foreground/40"
      }`}
      title={isActive ? "Stop preview" : "Preview voice"}
    >
      {isActive ? <Square className="w-2.5 h-2.5 fill-current" /> : <Play className="w-2.5 h-2.5" />}
    </button>
  );
}

export function VoiceSettingsPanel({
  rate,
  voice,
  voices,
  onSetRate,
  onSetVoice,
  compact = false,
}: {
  rate: number;
  voice: string;
  voices: EdgeVoice[];
  onSetRate: (r: number) => void;
  onSetVoice: (v: string) => void;
  compact?: boolean;
}) {
  // Guard: voices can briefly be undefined/non-array (still loading, or a stale
  // cache shape) — never call array methods on a non-array.
  const safeVoices = Array.isArray(voices) ? voices : [];
  const recommended = useMemo(() => safeVoices.filter((v) => RECOMMENDED_VOICES.includes(v.shortName)), [safeVoices]);

  const currentVoiceName = useMemo(() => {
    if (!voice) return "Default";
    const found = safeVoices.find((v) => v.shortName === voice);
    if (!found) return voice.replace("Neural", "").replace(/^en-\w+-/, "");
    return formatVoiceName(found.name);
  }, [voice, voices]);

  return (
    <>
      <div>
        <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-2">Speed</p>
        <div className="flex items-center gap-1 flex-wrap">
          {RATE_OPTIONS.map((r) => (
            <button
              key={r}
              onClick={() => onSetRate(r)}
              className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                rate === r
                  ? "bg-brand/20 text-brand border border-brand/30"
                  : "bg-muted/20 text-muted-foreground border border-transparent hover-elevate"
              }`}
            >
              {r}x
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-2">
          Voice &middot; {currentVoiceName}
        </p>

        {recommended.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {recommended.map((v) => {
              const isSelected = voice === v.shortName;
              const shortLabel = formatVoiceName(v.name);
              return (
                <div key={v.shortName} className={`inline-flex items-center gap-1 rounded-full text-[11px] pl-2.5 pr-1 py-1 border transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-brand/15 border-brand/30 text-foreground"
                    : "bg-muted/10 border-transparent text-muted-foreground hover:bg-muted/20"
                }`}>
                  <span onClick={() => onSetVoice(v.shortName)}>
                    {shortLabel}
                  </span>
                  <VoicePreviewButton voiceId={v.shortName} />
                </div>
              );
            })}
          </div>
        )}

        {safeVoices.length === 0 && (
          <p className="text-xs text-muted-foreground/70 py-2 text-center">Loading voices...</p>
        )}
      </div>
    </>
  );
}
