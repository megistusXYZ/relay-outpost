/**
 * The username half of the password-manager entry: the account's npub, in the
 * same form as the key field, so a saved key is filed under its account (not
 * under an empty name) and is offered back for that account.
 */
export function CredentialUsername({ npub, testId = "input-credential-username" }: { npub: string; testId?: string }) {
  return (
    <input
      type="text"
      name="username"
      autoComplete="username"
      value={npub}
      readOnly
      tabIndex={-1}
      aria-hidden="true"
      className="sr-only"
      data-testid={testId}
    />
  );
}
