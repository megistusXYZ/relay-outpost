import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { RelayLogo } from "./RelayLogo";

export interface RelayEmptyProps {
  title: string;
  hint?: string;
  /** Usually one button. */
  action?: ReactNode;
  size?: number;
  className?: string;
}

/**
 * Empty state: Relay rests, and wakes when the pointer or focus arrives.
 *
 * Only render this for a relay that ANSWERED with nothing. If the relay was
 * never reached or refused us, render <RelayReachStatus /> instead: an empty
 * state there would be a claim we have no basis for.
 */
export function RelayEmpty({ title, hint, action, size = 44, className }: RelayEmptyProps) {
  const [awake, setAwake] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const wake = () => {
    clearTimeout(timer.current);
    setAwake(true);
  };
  const sleep = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAwake(false), 1500);
  };

  return (
    <div
      className={cn("flex flex-col items-center gap-3 px-6 py-10 text-center", className)}
      onPointerEnter={wake}
      onPointerLeave={sleep}
      onFocus={wake}
      onBlur={sleep}
    >
      <RelayLogo state={awake ? "icon" : "rest"} size={size} label="" />
      <div className="text-base font-semibold text-foreground">{title}</div>
      {hint ? <p className="max-w-xs text-sm text-muted-foreground">{hint}</p> : null}
      {action}
    </div>
  );
}
