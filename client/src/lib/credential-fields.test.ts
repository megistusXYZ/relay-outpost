/**
 * One account, one entry in the password manager: the npub as the username
 * and the key as the password. The optional password for this browser must
 * never become that entry, so its fields are not password fields at all.
 */
import { describe, it, expect } from "vitest";
import { deviceSecretInputProps } from "./credential-fields";

describe("deviceSecretInputProps", () => {
  it("is never a password field, so no password manager offers to save it", () => {
    for (const show of [false, true]) {
      const p = deviceSecretInputProps(show);
      expect(p.type).toBe("text");
      expect(p.autoComplete).toBe("off");
      expect(p["data-1p-ignore"]).toBe("true");
      expect(p["data-lpignore"]).toBe("true");
      expect(p["data-bwignore"]).toBe("true");
    }
  });

  it("still hides what is typed until shown", () => {
    expect(deviceSecretInputProps(false).style.WebkitTextSecurity).toBe("disc");
    expect(deviceSecretInputProps(true).style.WebkitTextSecurity).toBe("none");
  });
});
