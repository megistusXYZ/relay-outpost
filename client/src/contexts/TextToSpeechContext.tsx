import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { registerAudioSource, unregisterAudioSource } from "@/lib/audio-coordinator";
import { toast } from "@/hooks/use-toast";

const TTS_PREFS_KEY = "relay-outpost-tts-prefs";
const TTS_ENABLED_KEY = "relay-outpost-tts-enabled";

export const RECOMMENDED_VOICES = [
  "en-US-AvaNeural",
  "en-US-AndrewNeural",
  "en-GB-RyanNeural",
  "en-GB-SoniaNeural",
  "en-KE-AsiliaNeural",
  "en-KE-ElimuNeural",
  "en-IN-NeerjaNeural",
  "en-HK-YanNeural",
];

interface TTSPrefs {
  voice: string;
  rate: number;
}

function loadPrefs(): TTSPrefs {
  try {
    const stored = localStorage.getItem(TTS_PREFS_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return { voice: "en-GB-RyanNeural", rate: 1 };
}

function savePrefs(prefs: TTSPrefs) {
  localStorage.setItem(TTS_PREFS_KEY, JSON.stringify(prefs));
}

export interface EdgeVoice {
  shortName: string;
  name: string;
  gender: string;
  locale: string;
}

export interface TTSStartOptions {
  inline?: boolean;
}

interface TTSState {
  isReading: boolean;
  isPaused: boolean;
  isLoading: boolean;
  inline: boolean;
  multiVoice: boolean;
  title: string;
  sourceUrl: string;
  progress: number;
  currentSentence: number;
  totalSentences: number;
  rate: number;
  voice: string;
  voices: EdgeVoice[];
}

export interface ThreadTTSSegment {
  pubkey: string;
  displayName: string;
  text: string;
}

interface TTSContextType extends TTSState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  startReading: (text: string, title: string, sourceUrl?: string, options?: TTSStartOptions) => void;
  startReadingThread: (segments: ThreadTTSSegment[], title: string, sourceUrl?: string, opPubkey?: string) => void;
  stop: () => void;
  togglePause: () => void;
  skipForward: () => void;
  skipBack: () => void;
  seekToChunk: (index: number) => void;
  setRate: (r: number) => void;
  setVoice: (v: string) => void;
}

const TTSContext = createContext<TTSContextType | null>(null);

export function useTTS() {
  const ctx = useContext(TTSContext);
  if (!ctx) throw new Error("useTTS must be used within TTSProvider");
  return ctx;
}

const TTS_SLANG: Record<string, string> = {
  "GM": "good morning",
  "GN": "good night",
  "GG": "good game",
  "LFG": "let's go",
  "HODL": "hold",
  "NGMI": "not gonna make it",
  "WAGMI": "we're all gonna make it",
  "HFSP": "have fun staying poor",
  "DYOR": "do your own research",
  "NFA": "not financial advice",
  "IMO": "in my opinion",
  "IMHO": "in my humble opinion",
  "IIRC": "if I recall correctly",
  "TBH": "to be honest",
  "FWIW": "for what it's worth",
  "AFAIK": "as far as I know",
  "LMAO": "laughing my ass off",
  "LMFAO": "laughing my ass off",
  "ROFL": "rolling on the floor laughing",
  "SMH": "shaking my head",
  "TL;DR": "too long didn't read",
  "TLDR": "too long didn't read",
  "IDK": "I don't know",
  "IRL": "in real life",
  "FOMO": "fear of missing out",
  "FUD": "fear uncertainty and doubt",
  "ATH": "all time high",
  "DCA": "dollar cost average",
  "KYC": "know your customer",
  "CEX": "centralized exchange",
  "DEX": "decentralized exchange",
  "BTC": "bitcoin",
  "ETH": "ethereum",
  "LNURL": "lightning URL",
  "NWC": "nostr wallet connect",
  "NIP": "nip",
  "OP": "O P",
  "OG": "O G",
  "DM": "D M",
  "DMs": "D Ms",
  "SHTF": "shit hits the fan",
  "YOLO": "you only live once",
  "WDYT": "what do you think",
  "WTF": "what the fuck",
  "STFU": "shut the fuck up",
  "GTFO": "get the fuck out",
  "GOAT": "greatest of all time",
  "ICYMI": "in case you missed it",
  "IYKYK": "if you know you know",
  "FYI": "for your information",
  "TIL": "today I learned",
  "OTOH": "on the other hand",
  "AMA": "ask me anything",
  "ETA": "estimated time of arrival",
  "PSA": "public service announcement",
  "RN": "right now",
  "NBD": "no big deal",
  "JK": "just kidding",
  "IIUC": "if I understand correctly",
};

const TTS_SLANG_LOWER: Record<string, string> = {
  "ser": "sir",
  "gm": "good morning",
  "gn": "good night",
  "lfg": "let's go",
  "hodl": "hold",
  "hodling": "holding",
  "ngmi": "not gonna make it",
  "wagmi": "we're all gonna make it",
  "fud": "fear uncertainty and doubt",
  "rekt": "wrecked",
  "degen": "degen",
  "smol": "small",
  "fren": "friend",
  "frens": "friends",
  "pleb": "pleb",
  "plebs": "plebs",
  "nostr": "nostr",
  "zaps": "zaps",
  "zapped": "zapped",
  "sats": "sats",
  "pubkey": "pub key",
  "npub": "n pub",
  "nsec": "n sec",
  "naddr": "n address",
  "nevent": "n event",
  "relays": "relays",
  "normie": "normie",
  "normies": "normies",
  "ngl": "not gonna lie",
  "tbf": "to be fair",
  "imo": "in my opinion",
  "btw": "by the way",
  "afk": "away from keyboard",
  "brb": "be right back",
  "irl": "in real life",
  "pov": "point of view",
  "based": "based",
  "cope": "cope",
  "copium": "copium",
  "hopium": "hopium",
  "anon": "anon",
  "anons": "anons",
};

const TTS_EMOJI: Record<string, string> = {
  "🔥": "fire",
  "🚀": "rocket",
  "💜": "purple heart",
  "❤️": "heart",
  "❤": "heart",
  "💙": "blue heart",
  "💚": "green heart",
  "🧡": "orange heart",
  "💛": "yellow heart",
  "🤍": "white heart",
  "🖤": "black heart",
  "😂": "laughing",
  "🤣": "laughing",
  "😭": "crying laughing",
  "😍": "heart eyes",
  "🥰": "love",
  "😊": "smiling",
  "😎": "cool",
  "🤔": "thinking",
  "😤": "frustrated",
  "😡": "angry",
  "😱": "shocked",
  "😳": "flushed",
  "🥺": "pleading",
  "😏": "smirking",
  "⚡": "lightning",
  "🤙": "shaka",
  "🙏": "prayer hands",
  "👀": "eyes",
  "🫡": "salute",
  "🎉": "party",
  "👍": "thumbs up",
  "👎": "thumbs down",
  "👏": "clapping",
  "💯": "hundred percent",
  "🤝": "handshake",
  "✅": "check",
  "❌": "cross",
  "⭐": "star",
  "🌟": "star",
  "💪": "strong",
  "🧠": "brain",
  "💀": "skull",
  "☠️": "skull",
  "🗣️": "speaking",
  "🗣": "speaking",
  "📢": "announcement",
  "🔑": "key",
  "🏆": "trophy",
  "🎯": "bullseye",
  "📈": "chart up",
  "📉": "chart down",
  "💰": "money",
  "💸": "money flying",
  "🐂": "bull",
  "🐻": "bear",
  "🤡": "clown",
  "🫠": "melting",
  "😮‍💨": "exhaling",
  "🫶": "heart hands",
  "🤯": "mind blown",
  "🙌": "raised hands",
  "✊": "fist",
  "🤷": "shrug",
  "👋": "wave",
  "🎶": "music",
  "🎵": "music",
  "💡": "lightbulb",
  "🔒": "locked",
  "🔓": "unlocked",
  "🌎": "earth",
  "🌍": "earth",
  "🌏": "earth",
  "⚠️": "warning",
  "⚠": "warning",
  "🆘": "S O S",
  "🪙": "coin",
};

const ttsSlangRegex = new RegExp(
  "\\b(" + Object.keys(TTS_SLANG).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b",
  "g"
);

const ttsSlangLowerRegex = new RegExp(
  "\\b(" + Object.keys(TTS_SLANG_LOWER).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b",
  "g"
);

const ttsEmojiRegex = new RegExp(
  "(" + Object.keys(TTS_EMOJI)
    .sort((a, b) => b.length - a.length)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|") + ")+",
  "gu"
);

const ttsSingleEmojiPattern = "(" + Object.keys(TTS_EMOJI)
  .sort((a, b) => b.length - a.length)
  .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|") + ")";

const ttsSingleEmojiAnchored = new RegExp("^" + ttsSingleEmojiPattern, "u");

function expandEmojis(text: string): string {
  return text.replace(ttsEmojiRegex, (run) => {
    const individual: string[] = [];
    let remaining = run;
    while (remaining.length > 0) {
      const m = remaining.match(ttsSingleEmojiAnchored);
      if (m) {
        const emoji = m[1];
        const spoken = TTS_EMOJI[emoji];
        if (spoken && !individual.includes(spoken)) {
          individual.push(spoken);
        }
        remaining = remaining.slice(m[0].length);
      } else {
        remaining = remaining.slice(1);
      }
      if (individual.length >= 3) break;
    }
    return individual.length > 0 ? " " + individual.join(", ") + " " : " ";
  });
}

function expandNumbers(text: string): string {
  return text
    .replace(/\b(\d+(?:\.\d+)?)B\b/g, (_, n) => {
      const num = parseFloat(n);
      return num === 1 ? "one billion" : `${n} billion`;
    })
    .replace(/\b(\d+(?:\.\d+)?)M\b/g, (_, n) => {
      const num = parseFloat(n);
      return num === 1 ? "one million" : `${n} million`;
    })
    .replace(/\b(\d+(?:\.\d+)?)[Kk]\b/g, (_, n) => {
      const num = parseFloat(n);
      if (num === 1) return "one thousand";
      return `${n} thousand`;
    });
}

function cleanTextForTTS(text: string): string {
  let cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]+)\]\(.*?\)/g, "$1")
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/^>\s+/gm, "")
    .replace(/^-{3,}$/gm, "")
    .replace(/^\*{3,}$/gm, "")
    .replace(/\|.*\|/g, "")
    .replace(/nostr:(npub1|note1|nevent1|naddr1|nprofile1|nrelay1)\w+/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_~`]/g, "");

  cleaned = cleaned.replace(/#(\w+)/g, "$1");

  cleaned = expandEmojis(cleaned);

  cleaned = expandNumbers(cleaned);

  cleaned = cleaned.replace(ttsSlangRegex, (match) => TTS_SLANG[match] || match);
  cleaned = cleaned.replace(ttsSlangLowerRegex, (match) => TTS_SLANG_LOWER[match] || match);

  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned;
}

function splitIntoChunks(text: string): string[] {
  const raw = cleanTextForTTS(text)
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const sentences: string[] = [];
  const regex = /[^.!?]+[.!?]+[\s"]*/g;
  let match;
  let lastIndex = 0;
  while ((match = regex.exec(raw)) !== null) {
    sentences.push(match[0].trim());
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < raw.length) {
    const remainder = raw.slice(lastIndex).trim();
    if (remainder) sentences.push(remainder);
  }
  if (sentences.length === 0 && raw) sentences.push(raw);

  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if (current.length + s.length > 2000 && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += (current ? " " : "") + s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  if (chunks.length === 0 && raw) chunks.push(raw);

  return chunks;
}

async function fetchTTSAudio(text: string, voice: string): Promise<string> {
  let lastErr: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
      });
      if (!resp.ok) throw new Error("TTS request failed");
      const blob = await resp.blob();
      return URL.createObjectURL(blob);
    } catch (e) {
      lastErr = e;
      if (attempt < 1) await new Promise(r => setTimeout(r, 800));
    }
  }
  throw lastErr || new Error("TTS request failed");
}

export function TTSProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState(() => {
    try { return localStorage.getItem(TTS_ENABLED_KEY) === "true"; } catch { return false; }
  });

  const prefs = useRef(loadPrefs());
  const [state, setState] = useState<TTSState>({
    isReading: false,
    isPaused: false,
    isLoading: false,
    inline: false,
    multiVoice: false,
    title: "",
    sourceUrl: "",
    progress: 0,
    currentSentence: 0,
    totalSentences: 0,
    rate: prefs.current.rate,
    voice: prefs.current.voice,
    voices: [],
  });

  const chunksRef = useRef<string[]>([]);
  const chunkVoicesRef = useRef<string[]>([]);
  const currentIndexRef = useRef(0);
  const sessionIdRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const prefetchCacheRef = useRef<Map<number, string>>(new Map());
  const prefetchInFlightRef = useRef<Set<number>>(new Set());
  const voiceRef = useRef(prefs.current.voice);
  const rateRef = useRef(prefs.current.rate);
  const consecutiveErrorsRef = useRef(0);
  const prefetchGenRef = useRef(0);

  useEffect(() => {
    fetch("/api/tts/voices")
      .then((r) => r.json())
      .then((voices: EdgeVoice[]) => {
        // The endpoint can return an error object on failure — only accept arrays
        // so downstream `.filter`/`.find` never crash.
        setState((s) => ({ ...s, voices: Array.isArray(voices) ? voices : [] }));
      })
      .catch(() => {});
  }, []);

  const prefetchChunk = useCallback((index: number, session: number) => {
    if (session !== sessionIdRef.current) return;
    if (index >= chunksRef.current.length) return;
    if (prefetchCacheRef.current.has(index)) return;
    if (prefetchInFlightRef.current.has(index)) return;

    prefetchInFlightRef.current.add(index);
    const gen = prefetchGenRef.current;
    const chunkVoice = chunkVoicesRef.current[index] || voiceRef.current;
    fetchTTSAudio(chunksRef.current[index], chunkVoice)
      .then((url) => {
        prefetchInFlightRef.current.delete(index);
        if (session === sessionIdRef.current && gen === prefetchGenRef.current) {
          prefetchCacheRef.current.set(index, url);
          objectUrlsRef.current.push(url);
        } else {
          URL.revokeObjectURL(url);
        }
      })
      .catch(() => {
        prefetchInFlightRef.current.delete(index);
      });
  }, []);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.ontimeupdate = null;
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    for (const url of objectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    objectUrlsRef.current = [];
    prefetchCacheRef.current.clear();
    prefetchInFlightRef.current.clear();
  }, []);

  const playChunk = useCallback(async (index: number, session: number) => {
    if (session !== sessionIdRef.current) return;

    if (index >= chunksRef.current.length) {
      cleanup();
      chunkVoicesRef.current = [];
      setState((s) => ({
        ...s,
        isReading: false,
        isPaused: false,
        isLoading: false,
        multiVoice: false,
        progress: 100,
        currentSentence: s.totalSentences,
      }));
      return;
    }

    const total = chunksRef.current.length;
    const prog = total > 0 ? Math.round(((index) / total) * 100) : 0;

    const cachedUrl = prefetchCacheRef.current.get(index);

    setState((s) => ({
      ...s,
      currentSentence: index + 1,
      progress: Math.min(prog, 99),
      isLoading: !cachedUrl,
    }));

    try {
      let audioUrl: string;
      if (cachedUrl) {
        audioUrl = cachedUrl;
        prefetchCacheRef.current.delete(index);
      } else {
        const chunkVoice = chunkVoicesRef.current[index] || voiceRef.current;
        audioUrl = await fetchTTSAudio(chunksRef.current[index], chunkVoice);
        if (session !== sessionIdRef.current) {
          URL.revokeObjectURL(audioUrl);
          return;
        }
        objectUrlsRef.current.push(audioUrl);
      }

      if (audioRef.current) {
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
        audioRef.current.ontimeupdate = null;
        audioRef.current.pause();
        audioRef.current.src = "";
      }

      const audio = new Audio(audioUrl);
      audio.playbackRate = rateRef.current;
      audioRef.current = audio;
      currentIndexRef.current = index;

      setState((s) => ({ ...s, isLoading: false }));

      for (let ahead = 1; ahead <= 2; ahead++) {
        prefetchChunk(index + ahead, session);
      }

      audio.onended = () => {
        if (session === sessionIdRef.current) {
          playChunk(index + 1, session);
        }
      };

      audio.onerror = () => {
        if (session === sessionIdRef.current) {
          consecutiveErrorsRef.current++;
          const remaining = chunksRef.current.length - (index + 1);
          if (remaining > 0 && consecutiveErrorsRef.current < 3) {
            playChunk(index + 1, session);
          } else {
            toast({
              title: "Voice reader error",
              description: "Audio playback failed. Please try again.",
              variant: "destructive",
            });
            consecutiveErrorsRef.current = 0;
            cleanup();
            setState((s) => ({
              ...s,
              isReading: false,
              isPaused: false,
              isLoading: false,
              progress: 0,
              currentSentence: 0,
              totalSentences: 0,
            }));
          }
        }
      };

      audio.ontimeupdate = () => {
        if (session !== sessionIdRef.current) return;
        const chunkProgress = audio.duration > 0 ? audio.currentTime / audio.duration : 0;
        const overallProgress = ((index + chunkProgress) / total) * 100;
        setState((s) => ({ ...s, progress: Math.min(Math.round(overallProgress), 99) }));
      };

      await audio.play();
      consecutiveErrorsRef.current = 0;
    } catch (err) {
      console.error("TTS playback error:", err);
      if (session === sessionIdRef.current) {
        consecutiveErrorsRef.current++;
        setState((s) => ({ ...s, isLoading: false }));
        const remaining = chunksRef.current.length - (index + 1);
        if (remaining > 0 && consecutiveErrorsRef.current < 3) {
          playChunk(index + 1, session);
        } else {
          toast({
            title: "Voice reader error",
            description: "Could not play audio. Please try again.",
            variant: "destructive",
          });
          consecutiveErrorsRef.current = 0;
          cleanup();
          setState((s) => ({
            ...s,
            isReading: false,
            isPaused: false,
            isLoading: false,
            progress: 0,
            currentSentence: 0,
            totalSentences: 0,
          }));
        }
      }
    }
  }, [cleanup, prefetchChunk]);

  const stop = useCallback(() => {
    unregisterAudioSource("tts");
    sessionIdRef.current++;
    cleanup();
    chunkVoicesRef.current = [];
    setState((s) => ({
      ...s,
      isReading: false,
      isPaused: false,
      isLoading: false,
      inline: false,
      multiVoice: false,
      progress: 0,
      currentSentence: 0,
      totalSentences: 0,
      title: "",
      sourceUrl: "",
    }));
  }, [cleanup]);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    try { localStorage.setItem(TTS_ENABLED_KEY, value ? "true" : "false"); } catch {}
    if (!value) stop();
  }, [stop]);

  const startReading = useCallback((text: string, title: string, sourceUrl?: string, options?: TTSStartOptions) => {
    stop();
    consecutiveErrorsRef.current = 0;
    sessionIdRef.current++;
    const session = sessionIdRef.current;

    registerAudioSource("tts", () => {
      sessionIdRef.current++;
      cleanup();
      chunkVoicesRef.current = [];
      setState((s) => ({
        ...s,
        isReading: false,
        isPaused: false,
        isLoading: false,
        inline: false,
        multiVoice: false,
        progress: 0,
        currentSentence: 0,
        totalSentences: 0,
        title: "",
        sourceUrl: "",
      }));
    });

    const chunks = splitIntoChunks(text);
    if (chunks.length === 0) return;

    chunksRef.current = chunks;
    chunkVoicesRef.current = [];
    currentIndexRef.current = 0;

    setState((s) => ({
      ...s,
      isReading: true,
      isPaused: false,
      isLoading: true,
      inline: options?.inline ?? false,
      multiVoice: false,
      title,
      sourceUrl: sourceUrl || "",
      progress: 0,
      currentSentence: 0,
      totalSentences: chunks.length,
    }));

    playChunk(0, session);
  }, [stop, playChunk]);

  const startReadingThread = useCallback((segments: ThreadTTSSegment[], title: string, sourceUrl?: string, opPubkey?: string) => {
    stop();
    consecutiveErrorsRef.current = 0;
    sessionIdRef.current++;
    const session = sessionIdRef.current;

    registerAudioSource("tts", () => {
      sessionIdRef.current++;
      cleanup();
      chunkVoicesRef.current = [];
      setState((s) => ({
        ...s,
        isReading: false,
        isPaused: false,
        isLoading: false,
        inline: false,
        multiVoice: false,
        progress: 0,
        currentSentence: 0,
        totalSentences: 0,
        title: "",
        sourceUrl: "",
      }));
    });

    const availableVoices = state.voices
      .filter((v) => v.locale.startsWith("en-"))
      .map((v) => v.shortName);

    const voicePool = availableVoices.length > 0
      ? availableVoices
      : RECOMMENDED_VOICES;

    const userVoice = voiceRef.current;
    const otherVoices = voicePool.filter((v) => v !== userVoice);

    const authorVoiceMap = new Map<string, string>();
    const introducedAuthors = new Set<string>();
    let voiceIndex = 0;

    if (opPubkey) {
      authorVoiceMap.set(opPubkey, userVoice);
    }

    const chunks: string[] = [];
    const chunkVoices: string[] = [];

    for (const seg of segments) {
      if (!authorVoiceMap.has(seg.pubkey)) {
        if (authorVoiceMap.size === 0) {
          authorVoiceMap.set(seg.pubkey, userVoice);
        } else {
          const assignedVoice = otherVoices[voiceIndex % otherVoices.length];
          authorVoiceMap.set(seg.pubkey, assignedVoice);
          voiceIndex++;
        }
      }

      const cleaned = cleanTextForTTS(seg.text)
        .replace(/\n{2,}/g, ". ")
        .replace(/\n/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!cleaned || cleaned.length < 3) continue;

      const isFirstAppearance = !introducedAuthors.has(seg.pubkey);
      if (isFirstAppearance) introducedAuthors.add(seg.pubkey);

      const prefix = isFirstAppearance ? `${seg.displayName} said: ` : "";
      const fullText = prefix + cleaned;

      const segChunks = splitIntoChunks(fullText);
      const voice = authorVoiceMap.get(seg.pubkey) || userVoice;
      for (const chunk of segChunks) {
        chunks.push(chunk);
        chunkVoices.push(voice);
      }
    }

    if (chunks.length === 0) return;

    chunksRef.current = chunks;
    chunkVoicesRef.current = chunkVoices;
    currentIndexRef.current = 0;

    setState((s) => ({
      ...s,
      isReading: true,
      isPaused: false,
      isLoading: true,
      inline: false,
      multiVoice: true,
      title,
      sourceUrl: sourceUrl || "",
      progress: 0,
      currentSentence: 0,
      totalSentences: chunks.length,
    }));

    playChunk(0, session);
  }, [stop, playChunk, state.voices, cleanup]);

  const togglePause = useCallback(() => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      audioRef.current.play();
      setState((s) => ({ ...s, isPaused: false }));
    } else {
      audioRef.current.pause();
      setState((s) => ({ ...s, isPaused: true }));
    }
  }, []);

  const skipForward = useCallback(() => {
    if (!state.isReading) return;
    const next = Math.min(currentIndexRef.current + 1, chunksRef.current.length - 1);
    cleanup();
    playChunk(next, sessionIdRef.current);
  }, [state.isReading, cleanup, playChunk]);

  const skipBack = useCallback(() => {
    if (!state.isReading) return;
    if (audioRef.current && audioRef.current.currentTime > 3) {
      audioRef.current.currentTime = 0;
      return;
    }
    const prev = Math.max(0, currentIndexRef.current - 1);
    cleanup();
    playChunk(prev, sessionIdRef.current);
  }, [state.isReading, cleanup, playChunk]);

  const seekToChunk = useCallback((index: number) => {
    if (!state.isReading) return;
    const wasPaused = state.isPaused;
    const clamped = Math.max(0, Math.min(index, chunksRef.current.length - 1));
    cleanup();
    if (wasPaused) {
      const total = chunksRef.current.length;
      const prog = total > 0 ? Math.round((clamped / total) * 100) : 0;
      currentIndexRef.current = clamped;
      setState((s) => ({
        ...s,
        currentSentence: clamped + 1,
        progress: Math.min(prog, 99),
        isPaused: true,
      }));
    } else {
      playChunk(clamped, sessionIdRef.current);
    }
  }, [state.isReading, state.isPaused, cleanup, playChunk]);

  const setRate = useCallback((r: number) => {
    rateRef.current = r;
    prefs.current = { ...prefs.current, rate: r };
    savePrefs(prefs.current);
    if (audioRef.current) {
      audioRef.current.playbackRate = r;
    }
    setState((s) => ({ ...s, rate: r }));
  }, []);

  const setVoice = useCallback((v: string) => {
    voiceRef.current = v;
    prefs.current = { ...prefs.current, voice: v };
    savePrefs(prefs.current);

    prefetchGenRef.current++;
    for (const [, url] of prefetchCacheRef.current) {
      URL.revokeObjectURL(url);
    }
    prefetchCacheRef.current.clear();
    prefetchInFlightRef.current.clear();

    if (state.isReading && audioRef.current && currentIndexRef.current < chunksRef.current.length - 1) {
      const session = sessionIdRef.current;
      for (let ahead = 1; ahead <= 2; ahead++) {
        prefetchChunk(currentIndexRef.current + ahead, session);
      }
    }

    setState((s) => ({ ...s, voice: v }));
  }, [state.isReading, prefetchChunk]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return (
    <TTSContext.Provider
      value={{
        ...state,
        enabled,
        setEnabled,
        startReading,
        startReadingThread,
        stop,
        togglePause,
        skipForward,
        skipBack,
        seekToChunk,
        setRate,
        setVoice,
      }}
    >
      {children}
    </TTSContext.Provider>
  );
}
