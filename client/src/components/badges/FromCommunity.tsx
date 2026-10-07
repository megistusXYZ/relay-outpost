/**
 * "from Bitcoin Bali" under a community's badge (badges-plan step 4): the
 * community's own name from its relay card, or its address until that loads.
 */
import { useEffect, useState } from "react";
import { fetchNip11 } from "@/lib/nip11";
import { fromCommunityLine } from "@/lib/badge-events";

export function FromCommunity({ url, className = "" }: { url?: string; className?: string }) {
  const [name, setName] = useState<string | undefined>();
  useEffect(() => {
    if (!url) return;
    let off = false;
    void fetchNip11(url).then((d) => { if (!off && d?.name) setName(d.name); }).catch(() => {});
    return () => { off = true; };
  }, [url]);
  if (!url) return null;
  return <span className={className} data-testid="badge-from-community">{fromCommunityLine(url, name)}</span>;
}
