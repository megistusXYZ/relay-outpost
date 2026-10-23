/**
 * How this visitor can install the app, and what one tap on "Install" does.
 *
 * - iOS has no install API (WebKit opposes one): Share → Add to Home Screen.
 * - Chromium's Web Install API, `navigator.install()`, installs the current
 *   document (our manifest has an `id`). It comes first.
 * - the install-prompt event (BIP, Chromium) is the fallback, captured at module load
 *   in hooks/use-pwa-install.ts because it fires once, early.
 * - One tap never uses both: each needs the tap's user activation, and the
 *   first call spends it. A failed Web Install hands over on the NEXT tap.
 */

export type InstallMethod =
  | "installed"
  | "web-install"
  | "bip"
  | "ios-instructions"
  | "in-app-browser"
  | "macos-safari"
  | "unsupported";

export interface InstallEnv {
  standalone: boolean;
  installed: boolean;
  inAppBrowser: boolean;
  ios: boolean;
  webInstallAvailable: boolean;
  /** Web Install threw (not a cancel) earlier this session. */
  webInstallFailed: boolean;
  bipAvailable: boolean;
  macSafari: boolean;
}

export function chooseInstallMethod(env: InstallEnv): InstallMethod {
  if (env.standalone || env.installed) return "installed";
  if (env.inAppBrowser) return "in-app-browser";
  if (env.ios) return "ios-instructions";
  if (env.webInstallAvailable && !env.webInstallFailed) return "web-install";
  if (env.bipAvailable) return "bip";
  if (env.macSafari) return "macos-safari";
  return "unsupported";
}

/** The non-standard install-prompt event (BIP, Chromium). */
export interface BeforeInstallPromptLike {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

export interface InstallRunResult {
  outcome: InstallOutcome;
  /** Web Install threw something other than a cancel: fall back next tap. */
  webInstallFailed?: true;
  /** The captured install-prompt event can't be shown again. */
  bipUsed?: true;
}

/** One tap on "Install", for the method chosen above. */
export async function runInstallPrompt(
  method: InstallMethod,
  rt: { install?: () => Promise<unknown>; bip: BeforeInstallPromptLike | null },
): Promise<InstallRunResult> {
  if (method === "bip" && rt.bip) {
    try {
      await rt.bip.prompt();
      const choice = await rt.bip.userChoice;
      return { outcome: choice.outcome, bipUsed: true };
    } catch {
      return { outcome: "unavailable", bipUsed: true };
    }
  }
  return { outcome: "unavailable" };
}
