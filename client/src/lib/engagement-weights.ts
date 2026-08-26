export interface EngagementWeights {
  replies: number;
  reposts: number;
  likes: number;
  zaps: number;
  satsBonus: number;
}

export const DEFAULT_ENGAGEMENT_WEIGHTS: EngagementWeights = {
  replies: 2,
  reposts: 3,
  likes: 1,
  zaps: 5,
  satsBonus: 3,
};

const LS_KEY = "relay-outpost-engagement-weights";

let cachedWeights: EngagementWeights | null = null;

function parseWeights(raw: unknown): EngagementWeights | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const replies = typeof obj.replies === "number" && obj.replies >= 0 && obj.replies <= 10 ? Math.round(obj.replies) : null;
  const reposts = typeof obj.reposts === "number" && obj.reposts >= 0 && obj.reposts <= 10 ? Math.round(obj.reposts) : null;
  const likes = typeof obj.likes === "number" && obj.likes >= 0 && obj.likes <= 10 ? Math.round(obj.likes) : null;
  const zaps = typeof obj.zaps === "number" && obj.zaps >= 0 && obj.zaps <= 10 ? Math.round(obj.zaps) : null;
  const satsBonus = typeof obj.satsBonus === "number" && obj.satsBonus >= 0 && obj.satsBonus <= 10 ? Math.round(obj.satsBonus) : null;
  if (replies === null || reposts === null || likes === null || zaps === null || satsBonus === null) return null;
  return { replies, reposts, likes, zaps, satsBonus };
}

export function getEngagementWeights(): EngagementWeights {
  if (cachedWeights) return cachedWeights;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = parseWeights(JSON.parse(raw));
      if (parsed) {
        cachedWeights = parsed;
        return parsed;
      }
    }
  } catch {}
  cachedWeights = { ...DEFAULT_ENGAGEMENT_WEIGHTS };
  return cachedWeights;
}

export function saveEngagementWeights(weights: EngagementWeights): void {
  cachedWeights = { ...weights };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(weights));
  } catch {}
}

export function invalidateWeightsCache(): void {
  cachedWeights = null;
}

if (typeof window !== "undefined") {
  window.addEventListener("nip78-settings-applied", () => {
    invalidateWeightsCache();
  });

  window.addEventListener("storage", (e) => {
    if (e.key === LS_KEY) {
      invalidateWeightsCache();
    }
  });
}
