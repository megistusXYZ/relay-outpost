import { Button } from "@/components/ui/button";

/**
 * The relay answered "sign in first" instead of posts. Said plainly, with
 * its own reason — never "nothing here". When our sign-in was tried and
 * turned down (nostr-tools: "auth was required and attempted, but failed
 * with: …"), it says that instead, and offers to try again.
 */
export function RefusedNotice({ relayName, reason, onSignIn, what = "posts", testId = "ops-content-refused", never = false }: {
  relayName: string; reason: string; onSignIn: () => void; what?: string; testId?: string;
  /** You've set this relay to never sign in: say so, and offer no button. */
  never?: boolean;
}) {
  // "auth not enabled for …" is our own decline (your sign-in setting), which
  // nostr-tools words as a failed attempt. It isn't the relay talking.
  const declinedByUs = /auth not enabled/i.test(reason);
  const tried = !declinedByUs && /auth was required and attempted/i.test(reason);
  const why = declinedByUs ? "" : reason
    .replace(/^auth was required and attempted, but failed with:\s*(Error:\s*)?/i, "")
    .replace(/^[a-z-]+:\s*/i, "")
    .trim();
  return (
    <div className="py-10 text-center space-y-3" data-testid={testId}>
      <p className="text-[15px] font-medium">{tried ? `Signing in to ${relayName} didn't work` : `${relayName} only shows ${what} to signed-in readers`}</p>
      {why && <p className="text-[13px] text-muted-foreground">It said: “{why}”</p>}
      {never ? (
        <p className="text-[13px] text-muted-foreground" data-testid="ops-content-signin-never">
          You've chosen never to sign in here. Change it in Settings › Connection &amp; sign-in.
        </p>
      ) : (
        <Button className="min-h-[44px] rounded-full px-5" data-testid="ops-content-signin" onClick={onSignIn}>
          {tried ? "Try signing in again" : "Sign in to this relay"}
        </Button>
      )}
    </div>
  );
}

