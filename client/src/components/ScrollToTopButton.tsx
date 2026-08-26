import { useState, useEffect, useCallback, useRef } from "react";
import { Rocket } from "lucide-react";

function createWarpTeleportEffect() {
  const isDark = document.documentElement.classList.contains("dark");

  const overlay = document.createElement("div");
  overlay.className = "warp-teleport-overlay";
  if (isDark) overlay.classList.add("warp-teleport-dark");
  else overlay.classList.add("warp-teleport-light");
  document.body.appendChild(overlay);

  for (let i = 0; i < 28; i++) {
    const streak = document.createElement("div");
    streak.className = "warp-teleport-streak";
    const angle = Math.random() * 360;
    const dist = 30 + Math.random() * 70;
    const len = 60 + Math.random() * 140;
    const delay = Math.random() * 80;
    const width = 1 + Math.random() * 2;
    streak.style.cssText = `
      --angle: ${angle}deg;
      --dist: ${dist}%;
      --len: ${len}px;
      --delay: ${delay}ms;
      --w: ${width}px;
    `;
    overlay.appendChild(streak);
  }

  requestAnimationFrame(() => {
    overlay.classList.add("warp-teleport-active");
  });

  setTimeout(() => {
    overlay.classList.add("warp-teleport-fade");
  }, 250);

  setTimeout(() => {
    overlay.remove();
  }, 600);
}

export function ScrollToTopButton({ containerRef }: { containerRef: React.RefObject<HTMLElement | null> }) {
  const [visible, setVisible] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [newPostsPending, setNewPostsPending] = useState(false);
  const cooldownRef = useRef(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const sourceCountsRef = useRef(new Map<string, number>());
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Surface only when it's actually useful — scrolled well down — and fade out
    // after a short idle so it isn't permanently parked over feed media / the
    // video volume+expand controls.
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const far = el.scrollTop > 600;
        setVisible(far);
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        if (far) {
          idleTimerRef.current = setTimeout(() => setVisible(false), 2500);
        }
        ticking = false;
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [containerRef]);

  // Pages that hold live arrivals in a buffer broadcast their pending count
  // (keyed by `source`, so a page dispatching 0 on unmount/idle can't clobber
  // another page's live count). While ANY count is pending, the page's own
  // top-center "↑ N new posts" pill is the sole affordance — it both announces
  // and scrolls to top — so the rocket yields entirely. No dot: the pill IS
  // the notification.
  useEffect(() => {
    const handleNewPosts = (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      const source = typeof detail.source === "string" ? detail.source : "default";
      const count = detail.count ?? 0;
      if (count > 0) sourceCountsRef.current.set(source, count);
      else sourceCountsRef.current.delete(source);
      setNewPostsPending(sourceCountsRef.current.size > 0);
    };

    window.addEventListener("new-posts-update", handleNewPosts);
    return () => window.removeEventListener("new-posts-update", handleNewPosts);
  }, []);

  const teleportToTop = useCallback(() => {
    const el = containerRef.current;
    if (!el || cooldownRef.current) return;

    cooldownRef.current = true;
    setLaunched(true);
    createWarpTeleportEffect();

    setTimeout(() => {
      el.scrollTo({ top: 0, behavior: "instant" });
    }, 120);

    setTimeout(() => {
      setLaunched(false);
      cooldownRef.current = false;
    }, 700);
  }, [containerRef]);

  // ONE adaptive control, never both: pill (page-rendered) while new posts are
  // pending, rocket only when scrolled down with nothing new.
  const control: "pill" | "rocket" | "none" = newPostsPending ? "pill" : visible ? "rocket" : "none";
  const showRocket = control === "rocket";

  return (
    <button
      ref={btnRef}
      onClick={teleportToTop}
      className={`scroll-to-top-btn fixed z-[41] flex items-center justify-center rounded-full cursor-pointer ${launched ? "warp-launched" : "transition-all duration-300"} ${showRocket && !launched ? "opacity-100 translate-y-0 pointer-events-auto" : !launched ? "opacity-0 translate-y-3 pointer-events-none" : ""}`}
      style={{ right: "1.5rem", bottom: "calc(5.25rem + env(safe-area-inset-bottom, 0px))" }}
      aria-label="Teleport to top"
      data-testid="button-scroll-to-top"
    >
      <Rocket className="w-4 h-4 -rotate-45" />
    </button>
  );
}
