/**
 * Per-post translation UI — the X-style pattern agreed in design review:
 * auto-OFFER (a quiet "Translate" link appears only on posts whose detected
 * language isn't one the user reads), manual FIRE (nothing is requested until
 * tapped), in-place swap with a provenance caption ("Translated from Japanese
 * · Show original"), and an earned "Always translate X?" upgrade after three
 * manual translations of the same language.
 *
 * The hook owns the state; NostrPost/thread swap their prose to
 * `translatedProse` while `showing` is true and render <TranslateLine> under
 * the post body. All clicks stopPropagation — post rows navigate on tap.
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import type { Event as NostrEvent } from "nostr-tools";
import {
  shouldOfferTranslation,
  translateEvent,
  languageName,
  recordManualTranslation,
  shouldOfferAlwaysTranslate,
  addAutoTranslateLang,
  dismissAlwaysTranslate,
  getAutoTranslateLangs,
  TRANSLATE_SETTINGS_EVENT,
  type TranslationResult,
} from "@/lib/translate";
import { extractMediaFromContent } from "@/lib/media-utils";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

export type TranslateStatus = "idle" | "loading" | "shown" | "hidden" | "warming" | "error";

export interface Translation {
  /** ISO code of the post's detected language, or null when no offer applies. */
  offered: string | null;
  status: TranslateStatus;
  /** Prose (media URLs re-stripped) to swap in while `showing`. */
  translatedProse: string | null;
  showing: boolean;
  engine: TranslationResult["engine"] | null;
  fromName: string | null;
  offerAlways: boolean;
  fire: () => void;
  toggle: () => void;
  acceptAlways: () => void;
  declineAlways: () => void;
}

export function useTranslation(event: NostrEvent): Translation {
  const [status, setStatus] = useState<TranslateStatus>("idle");
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [offerAlways, setOfferAlways] = useState(false);
  const [settingsTick, setSettingsTick] = useState(0);

  useEffect(() => {
    const on = () => setSettingsTick((n) => n + 1);
    window.addEventListener(TRANSLATE_SETTINGS_EVENT, on);
    return () => window.removeEventListener(TRANSLATE_SETTINGS_EVENT, on);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const offered = useMemo(() => shouldOfferTranslation(event), [event.id, settingsTick]);

  const fire = useCallback(
    (manual = true) => {
      if (!offered || status === "loading") return;
      setStatus("loading");
      translateEvent(event)
        .then((r) => {
          if (r === "warming") {
            setStatus("warming"); // model still downloading — Retry shortly
            return;
          }
          if (!r) {
            setStatus("error");
            return;
          }
          setResult(r);
          setStatus("shown");
          if (manual) {
            recordManualTranslation(offered);
            setOfferAlways(shouldOfferAlwaysTranslate(offered));
          }
        })
        .catch(() => setStatus("error"));
    },
    [event, offered, status],
  );

  // Earned auto mode: languages the user opted into translate on mount. The
  // feed is virtualized, so mount ≈ entering the viewport — lazy by design.
  useEffect(() => {
    if (offered && status === "idle" && getAutoTranslateLangs().includes(offered)) fire(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offered]);

  const translatedProse = useMemo(() => {
    if (!result) return null;
    return extractMediaFromContent(result.text).text;
  }, [result]);

  return {
    offered,
    status,
    translatedProse,
    showing: status === "shown" && translatedProse !== null,
    engine: result?.engine ?? null,
    fromName: offered ? languageName(result?.from && result.from !== "und" ? result.from : offered) : null,
    offerAlways,
    fire: () => fire(true),
    toggle: () => setStatus((s) => (s === "shown" ? "hidden" : s === "hidden" ? "shown" : s)),
    acceptAlways: () => {
      if (offered) addAutoTranslateLang(offered);
      setOfferAlways(false);
    },
    declineAlways: () => {
      if (offered) dismissAlwaysTranslate(offered);
      setOfferAlways(false);
    },
  };
}

const LINK = "cursor-pointer text-primary/70 dark:text-brand/80 hover:text-primary dark:hover:text-brand-strong";

/** The quiet one-line control under a post body. Renders nothing when the post
 *  doesn't qualify — zero cost for same-language posts. */
export function TranslateLine({ tr, eventId }: { tr: Translation; eventId: string }) {
  if (!tr.offered) return null;

  const stop = (e: React.MouseEvent, fn: () => void) => {
    e.stopPropagation();
    e.preventDefault();
    fn();
  };

  return (
    <div
      className="mt-1.5 text-[11px] leading-none text-muted-foreground/60 flex items-center gap-1 flex-wrap"
      onClick={(e) => e.stopPropagation()}
      data-testid={`translate-line-${eventId}`}
    >
      {tr.status === "idle" && (
        <button className={LINK} onClick={(e) => stop(e, tr.fire)} data-testid={`button-translate-${eventId}`}>
          Translate
        </button>
      )}
      {tr.status === "loading" && (
        <span className="inline-flex items-center gap-1.5">
          <RelayOutpostInlineLoader className="w-2.5 h-2.5" /> Translating…
        </span>
      )}
      {tr.status === "shown" && (
        <span
          className="inline-flex items-center gap-1 flex-wrap"
          title={tr.engine === "device" ? "Translated on this device" : tr.engine === "server" ? "Translated by Relay Outpost" : "Translated via a Nostr translation service"}
        >
          Translated from {tr.fromName}
          <span aria-hidden>·</span>
          <button className={LINK} onClick={(e) => stop(e, tr.toggle)} data-testid={`button-show-original-${eventId}`}>
            Show original
          </button>
        </span>
      )}
      {tr.status === "hidden" && (
        <button className={LINK} onClick={(e) => stop(e, tr.toggle)} data-testid={`button-show-translation-${eventId}`}>
          Show translation
        </button>
      )}
      {tr.status === "warming" && (
        <span className="inline-flex items-center gap-1">
          Preparing translator…
          <span aria-hidden>·</span>
          <button className={LINK} onClick={(e) => stop(e, tr.fire)} data-testid={`button-translate-warm-retry-${eventId}`}>
            Retry
          </button>
        </span>
      )}
      {tr.status === "error" && (
        <span className="inline-flex items-center gap-1">
          Translation unavailable
          <span aria-hidden>·</span>
          <button className={LINK} onClick={(e) => stop(e, tr.fire)} data-testid={`button-translate-retry-${eventId}`}>
            Retry
          </button>
        </span>
      )}
      {tr.offerAlways && tr.status === "shown" && (
        <span className="inline-flex items-center gap-1 ml-1">
          <span aria-hidden>·</span>
          Always translate {tr.fromName}?
          <button className={LINK} onClick={(e) => stop(e, tr.acceptAlways)} data-testid={`button-always-translate-yes-${eventId}`}>
            Yes
          </button>
          <span aria-hidden>/</span>
          <button className={LINK} onClick={(e) => stop(e, tr.declineAlways)} data-testid={`button-always-translate-no-${eventId}`}>
            Not now
          </button>
        </span>
      )}
    </div>
  );
}
