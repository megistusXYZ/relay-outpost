import { useEffect, useSyncExternalStore } from "react";
import { getVerificationStatus, subscribeVerification, requestVerification } from "@/lib/nip05-verify";

type VerifyStatus = "unknown" | "loading" | "verified" | "unverified";

export function useNip05Verified(nip05: string | null | undefined, pubkey: string): VerifyStatus {
  const status = useSyncExternalStore(
    subscribeVerification,
    () => getVerificationStatus(nip05, pubkey),
  );

  useEffect(() => {
    if (nip05 && pubkey && status === "unknown") {
      requestVerification(nip05, pubkey);
    }
  }, [nip05, pubkey, status]);

  return status;
}
