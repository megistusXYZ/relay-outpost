/**
 * Words for the "signer offline" notice, per way of signing in. Short on
 * purpose: one line in the notice, a brief "why" on request.
 */
export interface SignerNoticeCopy {
  title: string;
  body: string;
  why: string;
  /** Shown when Reconnect didn't work. */
  reconnectFailed: string;
}

export function signerNoticeCopy(method: string | null | undefined): SignerNoticeCopy {
  if (method === "qr") {
    return {
      title: "Signer session expired",
      body: "Browsing only; posting is paused.",
      why: "Your key stays in your signer app. Scan the sign-in QR code again to start a fresh session.",
      reconnectFailed: "The session has expired. Log out and scan the QR code again.",
    };
  }
  if (method === "bunker") {
    return {
      title: "Signer app offline",
      body: "Browsing only; posting is paused.",
      why: "Your key stays in your signer app (like nsec.app). Open it and reconnect to post, zap and read messages again.",
      reconnectFailed: "Couldn't reach your signer app. Open it, check it's connected, then try again.",
    };
  }
  return {
    title: "Signing extension offline",
    body: "Browsing only; posting is paused.",
    why: "Your key stays in your browser extension (like Alby or nos2x). Turn it back on and reconnect to post, zap and read messages.",
    reconnectFailed: "Couldn't reach your signing extension. Check it's installed and turned on, then try again.",
  };
}
