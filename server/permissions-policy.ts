/**
 * The Permissions-Policy header every page is sent.
 *
 * Group-chat calls (Concord CORD-07) need the microphone, camera and screen
 * capture, and the Hangout room's Corny Chat embed needs them delegated to
 * cornychat.com (an iframe's `allow=` can't grant what the page's own policy
 * forbids). Until 2026-09-12 this said `microphone=(), camera=()`, which quietly
 * turned both off everywhere. Everything else stays switched off.
 */
const CALL_FEATURE = '(self "https://cornychat.com")';

export const PERMISSIONS_POLICY = [
  `microphone=${CALL_FEATURE}`,
  `camera=${CALL_FEATURE}`,
  `display-capture=${CALL_FEATURE}`,
  "geolocation=()",
  "payment=()",
  "usb=()",
  "magnetometer=()",
  "accelerometer=()",
  "gyroscope=()",
  "interest-cohort=()",
].join(", ");
