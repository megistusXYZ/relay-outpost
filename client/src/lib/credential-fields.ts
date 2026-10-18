/**
 * Field settings for secrets that must NOT become the password manager's
 * entry. Each account has one entry: the npub as the username and the key
 * (nsec) as the password. The optional password for this browser only unlocks
 * the copy kept on this device, so its fields are plain text fields with the
 * characters masked and every password manager's ignore marker set.
 */
export function deviceSecretInputProps(show: boolean) {
  return {
    type: "text" as const,
    autoComplete: "off",
    autoCapitalize: "off",
    autoCorrect: "off",
    spellCheck: false,
    "data-1p-ignore": "true",
    "data-lpignore": "true",
    "data-bwignore": "true",
    "data-form-type": "other",
    style: { fontSize: 16, WebkitTextSecurity: show ? "none" : "disc" } as { fontSize: number; WebkitTextSecurity: "none" | "disc" },
  };
}
