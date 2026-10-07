import { useEffect, useRef } from "react";

/**
 * Switching Encrypted calls off ends the call you're in (calls-off.test.ts).
 * The switch used to hide the Call button while a call in progress went on.
 * Once per switch-off: the effect fires on the change, not on every render.
 */
export function useLeaveWhenCallsOff(enabled: boolean, inCall: boolean, leave: () => void): void {
  const left = useRef(false);
  useEffect(() => {
    if (enabled) { left.current = false; return; }
    if (inCall && !left.current) { left.current = true; leave(); }
  }, [enabled, inCall, leave]);
}
