export type StorageRiskLevel = "safe" | "cautious" | "at-risk";

export type StorageRiskReason =
  | "private-mode"
  | "ios-pwa"
  | "in-app-browser"
  | "ephemeral-storage"
  | "no-storage"
  | "ok";

export interface StorageEnvironment {
  level: StorageRiskLevel;
  reason: StorageRiskReason;
  supportsCredentialApi: boolean;
  isIOS: boolean;
  isStandalonePWA: boolean;
  isInAppBrowser: boolean;
  headline: string;
  detail: string;
}

const IN_APP_BROWSER_PATTERNS = [
  /FBAN|FBAV|FB_IAB|FBIOS/i,
  /Instagram/i,
  /TikTok|musical_ly|BytedanceWebview/i,
  /Line\//i,
  /KAKAOTALK/i,
  /Snapchat/i,
  /Twitter/i,
  /Pinterest/i,
  /MicroMessenger/i,
  /WhatsApp/i,
  /WeBView/i,
];

function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Mac/.test(ua) && (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 1;
}

function detectStandalonePWA(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(display-mode: standalone)")?.matches) return true;
  } catch {}
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function detectInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return IN_APP_BROWSER_PATTERNS.some((p) => p.test(ua));
}

function detectCredentialApi(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { PasswordCredential?: unknown };
  return !!w.PasswordCredential && !!navigator.credentials?.store;
}

function probeLocalStorage(): boolean {
  try {
    const k = "__ro_storage_probe__";
    localStorage.setItem(k, "1");
    const ok = localStorage.getItem(k) === "1";
    localStorage.removeItem(k);
    return ok;
  } catch {
    return false;
  }
}

// Private/incognito heuristic. Returns true if multiple signals point to a
// short-lived, ephemeral storage context. Defensive: requires more than one
// hint before flagging so we don't false-positive in normal browsers.
function detectPrivateMode(isIOS: boolean, isStandalonePWA: boolean): boolean {
  if (typeof navigator === "undefined") return false;
  let hints = 0;

  // Quota under ~120MB strongly suggests private mode (Chrome/Edge/Brave clamp).
  const nav = navigator as Navigator & { storage?: { estimate?: () => Promise<{ quota?: number }> } };
  // We can't await here; the estimate result is consumed by the async classifier.
  // This sync helper only collects synchronous hints.

  // Safari private mode used to throw on localStorage.setItem; the probe above
  // covers that. Modern Safari private allows it but limits persistence.

  // Firefox in private mode disables IndexedDB silently.
  try {
    if (typeof indexedDB === "undefined") hints++;
  } catch {
    hints++;
  }

  // No service worker support in many incognito contexts.
  if (typeof navigator.serviceWorker === "undefined" && !isIOS && !isStandalonePWA) {
    hints++;
  }

  // Brave shields strict / Tor Browser disable plugins entirely.
  const plugins = navigator.plugins;
  if (plugins && plugins.length === 0 && !isIOS) {
    hints++;
  }

  return hints >= 2;
}

async function probeQuotaIsTiny(): Promise<boolean> {
  const nav = navigator as Navigator & { storage?: { estimate?: () => Promise<{ quota?: number }> } };
  if (typeof nav.storage?.estimate !== "function") return false;
  try {
    const est = await nav.storage.estimate();
    if (typeof est.quota === "number" && est.quota > 0 && est.quota < 120 * 1024 * 1024) {
      return true;
    }
  } catch {}
  return false;
}

export async function classifyStorageEnvironmentAsync(): Promise<StorageEnvironment> {
  const sync = classifyStorageEnvironment();
  if (sync.level === "at-risk") return sync;
  // Refine with async quota check — Chrome/Edge/Brave incognito clamp quota.
  const tinyQuota = await probeQuotaIsTiny();
  if (tinyQuota) {
    return {
      ...sync,
      level: "at-risk",
      reason: "private-mode",
      headline: "This looks like a private / incognito window",
      detail:
        "Browsers clear everything when you close private tabs — including your encrypted key. Open this in a normal window, or download the backup file before you finish so you don't lose access.",
    };
  }
  return sync;
}

export function classifyStorageEnvironment(): StorageEnvironment {
  const isIOS = detectIOS();
  const isStandalonePWA = detectStandalonePWA();
  const isInAppBrowser = detectInAppBrowser();
  const supportsCredentialApi = detectCredentialApi();
  const storageWorks = probeLocalStorage();

  if (!storageWorks) {
    return {
      level: "at-risk",
      reason: "no-storage",
      supportsCredentialApi,
      isIOS,
      isStandalonePWA,
      isInAppBrowser,
      headline: "This browser is blocking storage",
      detail:
        "We can't save your encrypted key here. Disable private mode or change browser settings, or download the backup file and store it yourself before continuing.",
    };
  }

  if (isInAppBrowser) {
    return {
      level: "at-risk",
      reason: "in-app-browser",
      supportsCredentialApi,
      isIOS,
      isStandalonePWA,
      isInAppBrowser,
      headline: "You're in an in-app browser",
      detail:
        "Browsers inside apps like Instagram, TikTok or Facebook often forget your data when the app closes. Open this in your real browser (Safari, Chrome, Firefox) — or be sure to download the backup file before you finish.",
    };
  }

  if (isIOS && isStandalonePWA) {
    return {
      level: "cautious",
      reason: "ios-pwa",
      supportsCredentialApi,
      isIOS,
      isStandalonePWA,
      isInAppBrowser,
      headline: "Heads up — iOS Home Screen apps have their own storage",
      detail:
        "Your key will live only inside this Home Screen install. It won't be visible in regular Safari, and iOS may clear it if the app sits unused for weeks. Save the backup file too — it's the only thing that survives.",
    };
  }

  // Synchronous private/incognito hints (Firefox no-IDB, missing serviceWorker, no plugins).
  if (detectPrivateMode(isIOS, isStandalonePWA)) {
    return {
      level: "at-risk",
      reason: "private-mode",
      supportsCredentialApi,
      isIOS,
      isStandalonePWA,
      isInAppBrowser,
      headline: "This looks like a private / incognito window",
      detail:
        "Browsers clear everything when you close private tabs — including your encrypted key. Open this in a normal window, or download the backup file before you finish so you don't lose access.",
    };
  }

  // Defensive: if we can't ask the browser about its storage quota, treat as cautious.
  const nav = navigator as Navigator & { storage?: { estimate?: () => Promise<{ quota?: number }> } };
  if (typeof nav.storage?.estimate !== "function") {
    // Older browsers — show cautious but don't alarm.
    return {
      level: "cautious",
      reason: "ephemeral-storage",
      supportsCredentialApi,
      isIOS,
      isStandalonePWA,
      isInAppBrowser,
      headline: "This browser may not remember your account",
      detail:
        "We can't confirm your browser will keep your encrypted key between visits. To be safe, download the backup file before you finish.",
    };
  }

  return {
    level: "safe",
    reason: "ok",
    supportsCredentialApi,
    isIOS,
    isStandalonePWA,
    isInAppBrowser,
    headline: "",
    detail: "",
  };
}

export interface StorageOutcomeMessage {
  title: string;
  detail: string;
}

export function describeStorageOutcome(
  env: StorageEnvironment,
  savedToManager: boolean,
): StorageOutcomeMessage {
  if (savedToManager) {
    return {
      title: "Saved to your browser's password manager",
      detail:
        "If your browser syncs passwords (Chrome / Edge / Brave with sign-in), it will appear on your other devices using the same browser. We never receive a copy.",
    };
  }
  if (env.reason === "in-app-browser") {
    return {
      title: "Saved to this in-app browser only",
      detail:
        "This storage may be wiped when the host app closes. Download the backup file now — it is the only copy you can carry to another device. We do not have one.",
    };
  }
  if (env.reason === "ios-pwa") {
    return {
      title: "Saved to this Home Screen install only",
      detail:
        "It won't appear in Safari or on any other device. The backup file is your only way to get back in elsewhere. We don't keep a copy.",
    };
  }
  if (env.reason === "no-storage") {
    return {
      title: "Browser refused to save your key",
      detail:
        "Nothing was stored on this device. Download the backup file now or you will lose access. We have no copy.",
    };
  }
  return {
    title: "Saved to this browser only",
    detail:
      "Your encrypted key lives in this browser, on this device. To use this account elsewhere, sign in with your backup file. We do not store it for you.",
  };
}
