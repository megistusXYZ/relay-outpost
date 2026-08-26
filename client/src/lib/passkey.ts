// Passkey-based key wrapping for Relay Outpost.
//
// Uses WebAuthn with the PRF extension to derive a deterministic 32-byte secret
// from the user's platform authenticator (Face ID / Touch ID / Fingerprint /
// Windows Hello). That secret is used as an AES-GCM key to wrap the user's
// Nostr secret key locally.
//
// Critically: the passkey itself is created and stored by the operating system
// (iCloud Keychain on Apple, Google Password Manager on Android/Chrome, Windows
// Hello on Windows). Relay Outpost servers never see the passkey, the PRF
// output, or the unwrapped secret key. All cryptography happens in this tab.

const RP_NAME = "Relay Outpost";

export interface PasskeyEnrollment {
  credentialId: string;     // base64url
  prfSalt: string;          // base64
  ciphertext: string;       // base64 (AES-GCM encrypted nsec bytes)
  iv: string;               // base64 (12-byte nonce)
  enrolledAt: number;
}

export type PasskeySupportLevel =
  | "supported"            // platform authenticator + WebAuthn detected (PRF only confirmed at enroll-time)
  | "no-platform-auth"     // WebAuthn exists but no platform authenticator (no Face ID / Touch ID etc.)
  | "no-webauthn"          // WebAuthn API not available
  | "insecure-context";    // not on https / localhost

export async function detectPasskeySupport(): Promise<PasskeySupportLevel> {
  if (typeof window === "undefined") return "no-webauthn";
  if (!window.isSecureContext) return "insecure-context";
  if (!window.PublicKeyCredential || !navigator.credentials?.create || !navigator.credentials?.get) {
    return "no-webauthn";
  }
  try {
    const fn = (window.PublicKeyCredential as unknown as {
      isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
    }).isUserVerifyingPlatformAuthenticatorAvailable;
    if (typeof fn === "function") {
      const has = await fn.call(window.PublicKeyCredential);
      if (!has) return "no-platform-auth";
    }
  } catch {
    // fall through — we'll attempt enrollment and let it fail gracefully
  }
  return "supported";
}

// Whether we currently *suspect* PRF will work. There is no reliable pre-flight
// check without prompting the user, so this is a UA-based heuristic restricted
// to engines we have confirmed support PRF + platform authenticator together.
//
// Notably we exclude Firefox here: at time of writing Firefox supports
// WebAuthn but its PRF + platform-authenticator pipeline isn't reliable
// enough to surface enrollment UI without a real attempt failing later. Better
// to silently skip the offer than to invite the user into a flow that errors.
export function suspectPrfSupport(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Firefox|FxiOS/i.test(ua)) return false;
  // Chromium 132+ (Chrome/Edge), Safari 18 (iOS 18 / macOS 15) — confirmed PRF.
  return /Chrome|CriOS|Edg|Safari/i.test(ua);
}

// Convenience: true only when the device passes both the platform-authenticator
// availability check AND our PRF-capable heuristic. Use this to gate UI that
// invites the user to enroll a passkey for key wrapping. Anywhere else (e.g.
// rendering the unlock-with-passkey button for an already-enrolled credential)
// you should just check whether a stored passkey blob exists.
export async function canOfferPasskeyEnrollment(): Promise<boolean> {
  const support = await detectPasskeySupport();
  return support === "supported" && suspectPrfSupport();
}

// ---- helpers ----

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64u: string): Uint8Array {
  const pad = b64u.length % 4 === 0 ? "" : "=".repeat(4 - (b64u.length % 4));
  return fromBase64(b64u.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

function getPrfResult(cred: PublicKeyCredential): ArrayBuffer | null {
  const ext = cred.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
  return ext?.prf?.results?.first ?? null;
}

async function deriveAesKey(prfBytes: ArrayBuffer): Promise<CryptoKey> {
  // PRF output is already 32 high-entropy bytes — use directly as AES-GCM-256 key.
  return crypto.subtle.importKey("raw", prfBytes, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptBytes(key: CryptoKey, plaintext: Uint8Array): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext as BufferSource);
  return { iv, ciphertext: new Uint8Array(ct) };
}

async function decryptBytes(key: CryptoKey, iv: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext as BufferSource);
  return new Uint8Array(pt);
}

// ---- public API ----

export interface EnrollPasskeyArgs {
  secretKey: Uint8Array;        // raw 32-byte Nostr secret to wrap
  pubkey: string;               // hex pubkey, used as WebAuthn user.id
  npub: string;                 // for credential displayName
  accountLabel: string;         // human label e.g. display name
}

export class PasskeyError extends Error {
  constructor(message: string, public code: "cancelled" | "no-prf" | "unsupported" | "unknown") {
    super(message);
  }
}

export async function enrollPasskey(args: EnrollPasskeyArgs): Promise<PasskeyEnrollment> {
  const support = await detectPasskeySupport();
  if (support !== "supported") {
    throw new PasskeyError(`Passkeys not available (${support}).`, "unsupported");
  }

  const prfSalt = randomBytes(32);
  // user.id must be ≤ 64 bytes; pubkey hex is 64 chars / 64 bytes when ASCII.
  const userId = new TextEncoder().encode(args.pubkey);

  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: RP_NAME },
        user: {
          id: userId,
          name: `${args.accountLabel} (${args.npub.slice(0, 12)}…)`,
          displayName: args.accountLabel || RP_NAME,
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },   // ES256
          { type: "public-key", alg: -257 }, // RS256 (broad fallback)
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "required",
          requireResidentKey: true,
          userVerification: "required",
        },
        attestation: "none",
        timeout: 60_000,
        extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential;
  } catch (err) {
    const e = err as DOMException;
    if (e?.name === "NotAllowedError" || e?.name === "AbortError") {
      throw new PasskeyError("Cancelled.", "cancelled");
    }
    throw new PasskeyError(e?.message || "Could not create passkey.", "unknown");
  }

  // Some browsers return PRF output during create; if not, run a get() to fetch it.
  let prfOutput = getPrfResult(cred);
  const credentialId = new Uint8Array(cred.rawId);

  if (!prfOutput) {
    let assertion: PublicKeyCredential;
    try {
      assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: randomBytes(32),
          allowCredentials: [{ id: credentialId, type: "public-key", transports: ["internal"] }],
          userVerification: "required",
          timeout: 60_000,
          extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential;
    } catch (err) {
      const e = err as DOMException;
      if (e?.name === "NotAllowedError" || e?.name === "AbortError") {
        throw new PasskeyError("Cancelled.", "cancelled");
      }
      throw new PasskeyError(e?.message || "Could not derive key from passkey.", "unknown");
    }
    prfOutput = getPrfResult(assertion);
  }

  if (!prfOutput) {
    throw new PasskeyError(
      "This device's passkey doesn't support biometric key wrapping (PRF).",
      "no-prf",
    );
  }

  const aesKey = await deriveAesKey(prfOutput);
  const { iv, ciphertext } = await encryptBytes(aesKey, args.secretKey);

  return {
    credentialId: toBase64Url(credentialId),
    prfSalt: toBase64(prfSalt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    enrolledAt: Date.now(),
  };
}

export async function unlockWithPasskey(blob: PasskeyEnrollment): Promise<Uint8Array> {
  if (typeof window === "undefined" || !window.PublicKeyCredential || !navigator.credentials?.get) {
    throw new PasskeyError("Passkeys not available in this browser.", "unsupported");
  }
  const credentialId = fromBase64Url(blob.credentialId);
  const prfSalt = fromBase64(blob.prfSalt);

  let assertion: PublicKeyCredential;
  try {
    assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ id: credentialId, type: "public-key", transports: ["internal", "hybrid"] }],
        userVerification: "required",
        timeout: 60_000,
        extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential;
  } catch (err) {
    const e = err as DOMException;
    if (e?.name === "NotAllowedError" || e?.name === "AbortError") {
      throw new PasskeyError("Cancelled.", "cancelled");
    }
    throw new PasskeyError(e?.message || "Sign-in failed.", "unknown");
  }

  const prfOutput = getPrfResult(assertion);
  if (!prfOutput) {
    throw new PasskeyError("Passkey did not return PRF output.", "no-prf");
  }
  const aesKey = await deriveAesKey(prfOutput);
  return decryptBytes(aesKey, fromBase64(blob.iv), fromBase64(blob.ciphertext));
}

export function describePasskeyPlatform(): { name: string; verb: string } {
  if (typeof navigator === "undefined") return { name: "passkey", verb: "Use passkey" };
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/.test(ua)) return { name: "Face ID / Touch ID", verb: "Save with Face ID / Touch ID" };
  if (/Mac/.test(ua)) return { name: "Touch ID", verb: "Save with Touch ID" };
  if (/Android/.test(ua)) return { name: "fingerprint or screen lock", verb: "Save with fingerprint" };
  if (/Windows/.test(ua)) return { name: "Windows Hello", verb: "Save with Windows Hello" };
  return { name: "passkey", verb: "Save with passkey" };
}
