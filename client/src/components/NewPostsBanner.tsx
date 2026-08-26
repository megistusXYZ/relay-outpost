import { ArrowUp } from "lucide-react";
import { useCallback, useRef } from "react";

interface NewPostsBannerProps {
  count: number;
  onClick: () => void;
}

export function NewPostsBanner({ count, onClick }: NewPostsBannerProps) {
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback(() => {
    onClick();
    const scrollable = btnRef.current?.closest<HTMLElement>("[class*='overflow-y-auto'], [class*='overflow-auto'], main");
    if (scrollable) {
      scrollable.scrollTo({ top: 0, behavior: "smooth" });
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [onClick]);

  if (count <= 0) return null;

  return (
    <div className="sticky top-12 md:top-14 z-40 flex justify-center py-2" data-testid="container-new-posts-banner">
      <button
        ref={btnRef}
        className="glass-bubble-other flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs text-brand/80 cursor-pointer transition-opacity hover:opacity-90"
        onClick={handleClick}
        data-testid="button-show-new-posts"
      >
        <ArrowUp className="w-3 h-3" />
        {count} new {count === 1 ? "post" : "posts"}
      </button>
    </div>
  );
}
