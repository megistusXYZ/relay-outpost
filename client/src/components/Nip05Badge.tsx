import { BadgeCheck } from "lucide-react";
import { useNip05Verified } from "@/hooks/use-nip05-verified";

interface Nip05BadgeProps {
  nip05: string | null | undefined;
  pubkey: string;
  showText?: boolean;
  className?: string;
  textClassName?: string;
  iconClassName?: string;
}

export function Nip05Badge({ nip05, pubkey, showText = true, className = "", textClassName = "", iconClassName = "w-3 h-3" }: Nip05BadgeProps) {
  const status = useNip05Verified(nip05, pubkey);

  if (!nip05) return null;

  const displayNip05 = nip05.startsWith("_@") ? nip05.slice(2) : nip05;

  if (status === "verified") {
    return (
      <span className={`inline-flex items-center gap-0.5 ${className}`}>
        <BadgeCheck className={`shrink-0 text-brand ${iconClassName}`} />
        {showText && <span className={`truncate ${textClassName}`}>{displayNip05}</span>}
      </span>
    );
  }

  if (status === "loading") {
    return (
      <span className={`inline-flex items-center gap-0.5 ${className}`}>
        <BadgeCheck className={`shrink-0 text-muted-foreground/30 animate-pulse ${iconClassName}`} />
        {showText && <span className={`truncate ${textClassName}`}>{displayNip05}</span>}
      </span>
    );
  }

  if (showText) {
    return (
      <span className={`inline-flex items-center gap-0.5 ${className}`}>
        <span className={`truncate ${textClassName}`}>{displayNip05}</span>
      </span>
    );
  }

  return null;
}

export function Nip05VerifiedCheck({ nip05, pubkey, className = "w-3.5 h-3.5" }: { nip05: string | null | undefined; pubkey: string; className?: string }) {
  const status = useNip05Verified(nip05, pubkey);

  if (status !== "verified") return null;

  return <BadgeCheck className={`shrink-0 text-brand ${className}`} />;
}
