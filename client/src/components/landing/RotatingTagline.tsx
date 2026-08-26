import { useEffect, useRef, useState } from "react";

// "The Next Phase of the Internet" — one idea, many languages. English leads,
// then the line rotates to signal universality. This is *temporal typography*:
// the change over time carries meaning beyond the words (the same future, for
// everyone). Only this tagline animates — the action labels stay static so the
// CTA is always instantly readable (Krug's trunk test / Cooper's excise).
//
// Non-Latin scripts fall back to the system sans already in --font-brand, so
// nothing extra is downloaded (stays lightweight).

type Script = "latin" | "cjk" | "indic" | "rtl";

interface Phrase {
  text: string;
  lang: string;
  script: Script;
}

const PHRASES: Phrase[] = [
  { text: "The Next Phase of the Internet", lang: "en", script: "latin" },
  { text: "La próxima fase de internet", lang: "es", script: "latin" },
  { text: "La prochaine phase d'internet", lang: "fr", script: "latin" },
  { text: "Die nächste Phase des Internets", lang: "de", script: "latin" },
  { text: "A próxima fase da internet", lang: "pt", script: "latin" },
  { text: "La prossima fase di internet", lang: "it", script: "latin" },
  { text: "Следующая фаза интернета", lang: "ru", script: "latin" },
  { text: "インターネットの次の段階", lang: "ja", script: "cjk" },
  { text: "互联网的下一个阶段", lang: "zh", script: "cjk" },
  { text: "인터넷의 다음 단계", lang: "ko", script: "cjk" },
  { text: "इंटरनेट का अगला चरण", lang: "hi", script: "indic" },
  { text: "المرحلة التالية من الإنترنت", lang: "ar", script: "rtl" },
];

// Reserve the widest Latin phrase's width so the flanking divider lines hold
// still as the language swaps (no jump = the "synced" feel).
const WIDEST = PHRASES
  .filter((p) => p.script === "latin")
  .reduce((a, b) => (b.text.length > a.text.length ? b : a)).text;

const FIRST_HOLD = 2800; // English lingers a beat longer (it's the primary)
const HOLD = 2300;
const FADE = 560;

function scriptStyle(script: Script): React.CSSProperties {
  switch (script) {
    case "cjk":
      // Uppercase is a no-op; the wide Latin tracking looks sparse on CJK. Bump
      // the size so dense CJK glyphs read at the same visual weight as the
      // (uppercased, tracked) English line instead of looking tiny.
      return { textTransform: "none", letterSpacing: "0.1em", fontSize: "1.45em" };
    case "indic":
      return { textTransform: "none", letterSpacing: "0.03em", fontSize: "1.4em" };
    case "rtl":
      // Letter-spacing breaks Arabic cursive joining; render RTL, no tracking.
      return { textTransform: "none", letterSpacing: "normal", direction: "rtl", fontSize: "1.4em" };
    default:
      return {}; // latin/cyrillic: inherit uppercase + wide tracking from wrapper
  }
}

export function RotatingTagline() {
  const reduced = useRef(
    typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(true);

  useEffect(() => {
    if (reduced.current) return; // static English, no cycling
    let swap: ReturnType<typeof setTimeout>;
    const out = setTimeout(() => {
      setShown(false); // lift out + fade
      swap = setTimeout(() => {
        setIndex((i) => (i + 1) % PHRASES.length); // swap while invisible
        setShown(true); // drop in + fade
      }, FADE);
    }, index === 0 ? FIRST_HOLD : HOLD);
    return () => { clearTimeout(out); clearTimeout(swap); };
  }, [index]);

  const p = PHRASES[index];
  const animStyle: React.CSSProperties = {
    ...scriptStyle(p.script),
    opacity: reduced.current ? 1 : shown ? 1 : 0,
    transform: reduced.current ? undefined : shown ? "translateY(0)" : "translateY(-0.45em)",
    transition: reduced.current ? undefined : `opacity ${FADE}ms ease, transform ${FADE}ms ease`,
    willChange: reduced.current ? undefined : "opacity, transform",
  };

  return (
    <span
      aria-label="The Next Phase of the Internet"
      className="relative inline-flex items-center justify-center"
    >
      {/* invisible sizer reserves a stable width across languages */}
      <span aria-hidden="true" className="invisible whitespace-nowrap">{WIDEST}</span>
      <span
        aria-hidden="true"
        lang={p.lang}
        className="absolute inset-0 inline-flex items-center justify-center whitespace-nowrap"
        style={animStyle}
      >
        {p.text}
      </span>
    </span>
  );
}
