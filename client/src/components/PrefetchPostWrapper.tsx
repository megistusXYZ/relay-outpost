import type { ReactNode, CSSProperties } from "react";
import { usePrefetchProfile } from "@/hooks/use-prefetch-visible";

interface PrefetchPostWrapperProps {
  pubkey: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function PrefetchPostWrapper({ pubkey, children, className, style }: PrefetchPostWrapperProps) {
  const ref = usePrefetchProfile(pubkey);
  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
