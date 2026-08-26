import { useEffect, useRef } from "react";
import { fetchProfilesCached } from "@/lib/nostr";

const observedPubkeys = new Set<string>();

let observer: IntersectionObserver | null = null;
const elementPubkeyMap = new WeakMap<Element, string>();

function getObserver(): IntersectionObserver {
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        const toFetch: string[] = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const pk = elementPubkeyMap.get(entry.target);
          if (pk && !observedPubkeys.has(pk)) {
            observedPubkeys.add(pk);
            toFetch.push(pk);
          }
          observer?.unobserve(entry.target);
        }
        if (toFetch.length > 0) {
          fetchProfilesCached(toFetch);
        }
      },
      { rootMargin: "200px 0px" }
    );
  }
  return observer;
}

export function usePrefetchProfile(pubkey: string | undefined) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !pubkey || observedPubkeys.has(pubkey)) return;

    elementPubkeyMap.set(el, pubkey);
    const obs = getObserver();
    obs.observe(el);

    return () => {
      obs.unobserve(el);
      elementPubkeyMap.delete(el);
    };
  }, [pubkey]);

  return ref;
}

export function prefetchProfileOnHover(pubkey: string) {
  if (!pubkey || observedPubkeys.has(pubkey)) return;
  observedPubkeys.add(pubkey);
  fetchProfilesCached([pubkey]);
}
