import { cn } from "@/lib/utils";

interface IllustrationProps {
  className?: string;
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

const NOISE_PIXELS = Array.from({ length: 30 }, (_, i) => {
  const x = 30 + (i % 10) * 6;
  const y = 36 + Math.floor(i / 10) * 14;
  const r1 = seededRandom(i);
  const r2 = seededRandom(i + 100);
  const r3 = seededRandom(i + 200);
  const r4 = seededRandom(i + 300);
  const r5 = seededRandom(i + 400);
  const r6 = seededRandom(i + 500);
  return {
    x,
    y,
    size: 1 + r1 * 2,
    opacity: 0.2 + r2 * 0.4,
    animValues: `${(0.1 + r3 * 0.2).toFixed(2)};${(0.3 + r4 * 0.3).toFixed(2)};${(0.1 + r5 * 0.2).toFixed(2)}`,
    dur: `${(1.5 + r6 * 2).toFixed(1)}s`,
    begin: `${(seededRandom(i + 600) * 2).toFixed(1)}s`,
  };
});

export function TuneAntennaIllustration({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={cn("w-20 h-20", className)}>
      <circle cx="60" cy="90" r="6" fill="currentColor" opacity="0.15" />
      <circle cx="60" cy="90" r="3" fill="currentColor" opacity="0.3" />
      <line x1="60" y1="84" x2="60" y2="30" stroke="currentColor" strokeWidth="2.5" opacity="0.4" strokeLinecap="round" />
      <line x1="60" y1="40" x2="42" y2="25" stroke="currentColor" strokeWidth="2" opacity="0.3" strokeLinecap="round" />
      <line x1="60" y1="40" x2="78" y2="25" stroke="currentColor" strokeWidth="2" opacity="0.3" strokeLinecap="round" />
      <path d="M38 55 Q38 45 45 38" stroke="currentColor" strokeWidth="1.5" opacity="0.2" strokeLinecap="round" fill="none">
        <animate attributeName="opacity" values="0.1;0.3;0.1" dur="2.5s" repeatCount="indefinite" />
      </path>
      <path d="M30 62 Q28 48 40 32" stroke="currentColor" strokeWidth="1.5" opacity="0.15" strokeLinecap="round" fill="none">
        <animate attributeName="opacity" values="0.05;0.2;0.05" dur="2.5s" repeatCount="indefinite" begin="0.3s" />
      </path>
      <path d="M82 55 Q82 45 75 38" stroke="currentColor" strokeWidth="1.5" opacity="0.2" strokeLinecap="round" fill="none">
        <animate attributeName="opacity" values="0.1;0.3;0.1" dur="2.5s" repeatCount="indefinite" begin="0.15s" />
      </path>
      <path d="M90 62 Q92 48 80 32" stroke="currentColor" strokeWidth="1.5" opacity="0.15" strokeLinecap="round" fill="none">
        <animate attributeName="opacity" values="0.05;0.2;0.05" dur="2.5s" repeatCount="indefinite" begin="0.45s" />
      </path>
      <circle cx="42" cy="25" r="2" fill="currentColor" opacity="0.25">
        <animate attributeName="opacity" values="0.15;0.35;0.15" dur="3s" repeatCount="indefinite" />
      </circle>
      <circle cx="78" cy="25" r="2" fill="currentColor" opacity="0.25">
        <animate attributeName="opacity" values="0.15;0.35;0.15" dur="3s" repeatCount="indefinite" begin="0.5s" />
      </circle>
      <line x1="55" y1="90" x2="40" y2="105" stroke="currentColor" strokeWidth="2" opacity="0.25" strokeLinecap="round" />
      <line x1="65" y1="90" x2="80" y2="105" stroke="currentColor" strokeWidth="2" opacity="0.25" strokeLinecap="round" />
    </svg>
  );
}

export function NoSignalIllustration({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={cn("w-20 h-20", className)}>
      <circle cx="60" cy="60" r="28" stroke="currentColor" strokeWidth="1.5" opacity="0.12" strokeDasharray="4 6" />
      <circle cx="60" cy="60" r="18" stroke="currentColor" strokeWidth="1.5" opacity="0.18" strokeDasharray="3 5">
        <animate attributeName="opacity" values="0.1;0.25;0.1" dur="3s" repeatCount="indefinite" />
      </circle>
      <circle cx="60" cy="60" r="8" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
      <circle cx="60" cy="60" r="3" fill="currentColor" opacity="0.3">
        <animate attributeName="opacity" values="0.2;0.4;0.2" dur="2s" repeatCount="indefinite" />
      </circle>
      <g opacity="0.2">
        <circle cx="35" cy="40" r="1.5" fill="currentColor">
          <animate attributeName="opacity" values="0.1;0.4;0.1" dur="4s" repeatCount="indefinite" />
        </circle>
        <circle cx="85" cy="45" r="1" fill="currentColor">
          <animate attributeName="opacity" values="0.1;0.3;0.1" dur="3.5s" repeatCount="indefinite" begin="0.5s" />
        </circle>
        <circle cx="45" cy="85" r="1.2" fill="currentColor">
          <animate attributeName="opacity" values="0.1;0.35;0.1" dur="4.2s" repeatCount="indefinite" begin="1s" />
        </circle>
        <circle cx="80" cy="78" r="1" fill="currentColor">
          <animate attributeName="opacity" values="0.1;0.3;0.1" dur="3.8s" repeatCount="indefinite" begin="0.7s" />
        </circle>
        <circle cx="30" cy="65" r="0.8" fill="currentColor">
          <animate attributeName="opacity" values="0.05;0.25;0.05" dur="5s" repeatCount="indefinite" begin="1.5s" />
        </circle>
        <circle cx="90" cy="60" r="0.8" fill="currentColor">
          <animate attributeName="opacity" values="0.05;0.25;0.05" dur="4.5s" repeatCount="indefinite" begin="2s" />
        </circle>
      </g>
      <line x1="45" y1="95" x2="75" y2="95" stroke="currentColor" strokeWidth="1.5" opacity="0.15" strokeLinecap="round" />
      <line x1="50" y1="100" x2="70" y2="100" stroke="currentColor" strokeWidth="1" opacity="0.1" strokeLinecap="round" />
    </svg>
  );
}

export function RadarSweepIllustration({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={cn("w-20 h-20", className)}>
      <circle cx="60" cy="60" r="40" stroke="currentColor" strokeWidth="1" opacity="0.1" />
      <circle cx="60" cy="60" r="28" stroke="currentColor" strokeWidth="1" opacity="0.15" />
      <circle cx="60" cy="60" r="16" stroke="currentColor" strokeWidth="1" opacity="0.2" />
      <line x1="60" y1="20" x2="60" y2="100" stroke="currentColor" strokeWidth="0.5" opacity="0.08" />
      <line x1="20" y1="60" x2="100" y2="60" stroke="currentColor" strokeWidth="0.5" opacity="0.08" />
      <line x1="60" y1="60" x2="85" y2="35" stroke="currentColor" strokeWidth="1.5" opacity="0.35" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 60 60" to="360 60 60" dur="4s" repeatCount="indefinite" />
      </line>
      <path d="M60 60 L85 35 A40 40 0 0 1 95 55 Z" fill="currentColor" opacity="0.06">
        <animateTransform attributeName="transform" type="rotate" from="0 60 60" to="360 60 60" dur="4s" repeatCount="indefinite" />
      </path>
      <circle cx="60" cy="60" r="2.5" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

export function StaticNoiseIllustration({ className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={cn("w-20 h-20", className)}>
      <rect x="25" y="30" rx="8" ry="8" width="70" height="50" stroke="currentColor" strokeWidth="1.5" opacity="0.2" fill="none" />
      <rect x="45" y="80" rx="2" ry="2" width="30" height="4" fill="currentColor" opacity="0.15" />
      <rect x="55" y="84" rx="1" ry="1" width="10" height="6" fill="currentColor" opacity="0.1" />
      <line x1="60" y1="25" x2="60" y2="18" stroke="currentColor" strokeWidth="1.5" opacity="0.25" strokeLinecap="round" />
      <line x1="60" y1="18" x2="52" y2="12" stroke="currentColor" strokeWidth="1.5" opacity="0.2" strokeLinecap="round" />
      <line x1="60" y1="18" x2="68" y2="12" stroke="currentColor" strokeWidth="1.5" opacity="0.2" strokeLinecap="round" />
      <g opacity="0.2">
        {NOISE_PIXELS.map((px, i) => (
          <rect
            key={i}
            x={px.x}
            y={px.y}
            width={px.size}
            height={px.size}
            fill="currentColor"
            opacity={px.opacity}
          >
            <animate
              attributeName="opacity"
              values={px.animValues}
              dur={px.dur}
              repeatCount="indefinite"
              begin={px.begin}
            />
          </rect>
        ))}
      </g>
    </svg>
  );
}
