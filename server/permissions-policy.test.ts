/**
 * The Permissions-Policy header every page is sent. Calls need the microphone,
 * camera and screen capture; the Hangout room (a Corny Chat embed) needs them
 * delegated to cornychat.com. Everything else stays switched off.
 */
import { describe, it, expect } from "vitest";
import { PERMISSIONS_POLICY } from "./permissions-policy";

const directives = () => new Map(PERMISSIONS_POLICY.split(",").map((d) => {
  const [name, value] = d.trim().split("=");
  return [name, value];
}));

describe("Permissions-Policy", () => {
  it("lets our own pages, and the Corny Chat hangout embed, use the microphone, camera and screen capture", () => {
    const d = directives();
    for (const feature of ["microphone", "camera", "display-capture"]) {
      expect(d.get(feature), feature).toBe('(self "https://cornychat.com")');
    }
  });

  it("keeps everything else switched off", () => {
    const d = directives();
    for (const feature of ["geolocation", "payment", "usb", "magnetometer", "accelerometer", "gyroscope", "interest-cohort"]) {
      expect(d.get(feature), feature).toBe("()");
    }
  });
});
