import type { CSSProperties, ReactNode } from "react";
import "./relay-logo.css";

/**
 * The Relay Outpost logo as one element with states.
 *
 *   icon  the bot on its own (ring, dot, eyes)
 *   relay "Relay" written beside the bot
 *   full  "Relay Outpost", the ring standing in as the O
 *   work  loading: the ring turns, eyes hidden
 *   rest  empty: eyes closed, slow breathing
 *
 * `reach` shows what a relay told us and is independent of `state`.
 * All motion is CSS (relay-logo.css); this component only sets attributes.
 */
export type RelayState = "icon" | "relay" | "full" | "work" | "rest";
export type RelayReach = "ok" | "empty" | "unreachable" | "refused";

export interface RelayLogoProps {
  state?: RelayState;
  reach?: RelayReach;
  /** Font size in px. The mark is 1.5em in icon states, 1em as the O. */
  size?: number;
  /** Accessible name. Pass "" when the logo is decorative. */
  label?: string;
  /**
   * A face of the caller's own in the mark's place, for a screen whose face
   * already has its own moods. It must be an <svg> that can fill its box; the
   * ring, dot and eyes inside it are the caller's to style for each state.
   */
  mark?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

const RELAY = ["R", "e", "l", "a", "y"];
const UTPOST = ["u", "t", "p", "o", "s", "t"];

export function RelayLogo({
  state = "icon",
  reach,
  size,
  label = "Relay Outpost",
  mark,
  className,
  style,
}: RelayLogoProps) {
  const decorative = label === "";
  return (
    <span
      className={className ? `rl ${className}` : "rl"}
      data-s={state}
      data-reach={reach}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      style={size ? { fontSize: size, ...style } : style}
    >
      <span className="rl-w a" aria-hidden="true">
        <span>
          {RELAY.map((c, i) => (
            <i className="rl-l" key={i}>{c}</i>
          ))}
        </span>
      </span>
      <span className="rl-m">
        {mark ?? (
          <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
            <path className="rl-ring" d="M78.98 42.24 A30 30 0 1 1 57.76 21.02" />
            <circle className="rl-dot" cx="71.2" cy="28.8" r="6.5" />
            <g className="rl-eyes">
              <ellipse cx="42" cy="51" rx="3.6" ry="5.2" />
              <ellipse cx="58" cy="51" rx="3.6" ry="5.2" />
            </g>
          </svg>
        )}
      </span>
      <span className="rl-w b" aria-hidden="true">
        <span>
          {UTPOST.map((c, i) => (
            <i className="rl-l" key={i}>{c}</i>
          ))}
        </span>
      </span>
    </span>
  );
}
