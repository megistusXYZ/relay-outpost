import { useEffect, useRef, useState } from "react";
import { MEDIA_MOUNT_LEAD } from "@/lib/media-ratio";
import { scrollRootFor } from "@/lib/scroll-root";

/**
 * Watch `el` until it comes within `rootMargin` of the box it scrolls in, call
 * `onNear` once, then stop. Returns the cleanup.
 *
 * The root is the element's own scroller (lib/scroll-root.ts). With the default
 * root the margin is applied after <main> has already clipped the element, so a
 * 1500px lead silently becomes 0px and media first loads on screen.
 */
export function observeNear(el: Element, onNear: () => void, rootMargin: string = MEDIA_MOUNT_LEAD): () => void {
  const obs = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting) { obs.disconnect(); onNear(); }
  }, { root: scrollRootFor(el), rootMargin });
  obs.observe(el);
  return () => obs.disconnect();
}

/** A one-way latch: true once the referenced element has come near the viewport. */
export function useNearViewport(rootMargin: string = MEDIA_MOUNT_LEAD) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    return observeNear(el, () => setNear(true), rootMargin);
  }, [near, rootMargin]);
  return [ref, near] as const;
}
