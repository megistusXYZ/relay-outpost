import { useCallback, useEffect, useRef, useState } from "react";
import { RelayLogo, type RelayReach, type RelayState } from "@/components/relay/RelayLogo";

/**
 * Meet Relay, on the landing: one more row under the three above it. Its heading
 * is the logo itself, reading "Relay"; beside it one sentence about 2027 and
 * three small buttons that make the logo do what it does in the app today (turn
 * while something loads, rest when a relay answered with nothing, say when a
 * relay could not be reached).
 *
 * Relay moves for a reason, never on a timer: here the reason is the visitor
 * arriving (it writes its name once) or pressing a button. Each showing ends by
 * itself and the name comes back, so nothing is left turning.
 */
type Show = "work" | "rest" | "lost";

const SHOWS: { id: Show; label: string; says: string; ms: number }[] = [
  { id: "work", label: "Loading", says: "Loading. The ring turns only while something is really loading.", ms: 2700 },
  { id: "rest", label: "Nothing yet", says: "Nothing yet. A relay answered, and there is nothing here to show.", ms: 3600 },
  { id: "lost", label: "Out of reach", says: "Out of reach. A relay could not be reached, so Relay says that and never shows an empty page.", ms: 3000 },
];

const STATE: Record<Show, RelayState> = { work: "work", rest: "rest", lost: "icon" };
const REACH: Partial<Record<Show, RelayReach>> = { lost: "unreachable" };

/** `still`: reduced motion, or Lite when chosen. The name is simply there; a press still shows its state. */
export function RelayMeet({ still }: { still: boolean }) {
  const [show, setShow] = useState<Show | null>(null);
  // Until the row has been seen the face waits alone, so the name can be written as the visitor arrives.
  const [named, setNamed] = useState(still);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const play = useCallback((id: Show | null) => {
    window.clearTimeout(timer.current);
    setNamed(true);
    setShow(id);
    const ms = SHOWS.find((s) => s.id === id)?.ms;
    if (ms) timer.current = window.setTimeout(() => setShow(null), ms);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || named) return;
    if (typeof IntersectionObserver !== "function") { setNamed(true); return; }
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { io.disconnect(); setNamed(true); } }, { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, [named]);

  const showing = SHOWS.find((s) => s.id === show);

  return (
    <div ref={boxRef} className="rv meet" data-testid="landing-relay">
      <h3 className="meet-head" data-testid="landing-relay-logo">
        <RelayLogo state={show ? STATE[show] : named ? "relay" : "icon"} reach={show ? REACH[show] : undefined} label="Relay" />
      </h3>
      <div className="meet-body">
        <p className="meet-lead">An assistant that works only for you, arriving in 2027.</p>
        <div className="meet-row" role="group" aria-label="What Relay already shows in the app">
          <span className="meet-note">Already in the app</span>
          {SHOWS.map((s) => (
            <button key={s.id} type="button" className="meet-btn" aria-pressed={show === s.id} onClick={() => play(show === s.id ? null : s.id)} data-testid={`landing-relay-show-${s.id}`}>
              {s.label}
            </button>
          ))}
        </div>
        {/* What the logo is showing, in words, for a screen reader: the picture says it for everyone else. */}
        <p className="sr-only" aria-live="polite" data-testid="landing-relay-says">{showing ? showing.says : ""}</p>
      </div>
    </div>
  );
}
