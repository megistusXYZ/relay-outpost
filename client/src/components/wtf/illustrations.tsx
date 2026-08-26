/**
 * Cohesive, theme-aware SVG illustrations for the /wtf guides.
 * 16:9 viewBox; primary line-work uses currentColor (violet via the root class)
 * so it reads in both light and dark; a few fixed accents (amber=Bitcoin,
 * emerald=trust, rose=danger, indigo=secondary) carry meaning.
 *
 * Heroes = one per guide. Concept diagrams = reusable across steps.
 */
import type { ReactNode } from "react";

const ROOT = "block w-full h-auto text-brand";
const INDIGO = "#6366f1";
const AMBER = "#f59e0b";
const EMERALD = "#10b981";
const ROSE = "#fb7185";

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 320 180" className={ROOT} fill="none" xmlns="http://www.w3.org/2000/svg"
      strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

/* ─────────────────────────── Heroes ─────────────────────────── */

export function FirstTenMinutesHero() {
  return (
    <Svg>
      {[40, 80, 120, 260, 290].map((x, i) => (
        <circle key={i} cx={x} cy={20 + (i % 3) * 18} r="1.6" fill="currentColor" opacity="0.4" />
      ))}
      <path d="M150 40c26 8 44 30 44 58 0 10-3 18-3 18l-26 10-26-10s-3-8-3-18c0-28 18-50 14-58z" fill="currentColor" opacity="0.12" stroke="currentColor" strokeWidth="3" />
      <circle cx="160" cy="86" r="11" fill="none" stroke={INDIGO} strokeWidth="3" />
      <path d="M139 120l-14 22 22-8M181 120l14 22-22-8" stroke="currentColor" strokeWidth="3" />
      <path d="M150 150c4 10 6 16 10 16s6-6 10-16c-6 4-14 4-20 0z" fill={AMBER} opacity="0.9" />
    </Svg>
  );
}

export function OutpostSetupHero() {
  return (
    <Svg>
      <path d="M120 150h80M132 150l8-46h40l8 46" stroke="currentColor" strokeWidth="3" />
      <path d="M140 104l20-58 20 58" stroke="currentColor" strokeWidth="3" fill="currentColor" fillOpacity="0.08" />
      <circle cx="160" cy="50" r="6" fill={AMBER} />
      <path d="M196 40a40 40 0 0 1 0 44M208 30a56 56 0 0 1 0 64" stroke={INDIGO} strokeWidth="3" opacity="0.7" />
      <path d="M124 40a40 40 0 0 0 0 44M112 30a56 56 0 0 0 0 64" stroke={INDIGO} strokeWidth="3" opacity="0.7" />
    </Svg>
  );
}

export function WalletHero() {
  return (
    <Svg>
      <rect x="96" y="58" width="128" height="76" rx="12" fill="currentColor" fillOpacity="0.10" stroke="currentColor" strokeWidth="3" />
      <rect x="176" y="86" width="48" height="22" rx="6" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="200" cy="97" r="4" fill={AMBER} />
      <path d="M150 60l-16 30h14l-6 24 24-34h-14l8-20z" fill={AMBER} stroke={AMBER} strokeWidth="2" />
    </Svg>
  );
}

export function CalendarHero() {
  return (
    <Svg>
      <rect x="104" y="48" width="112" height="92" rx="10" fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeWidth="3" />
      <path d="M104 74h112" stroke="currentColor" strokeWidth="3" />
      <path d="M128 40v16M192 40v16" stroke="currentColor" strokeWidth="3" />
      {[0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => (
        <circle key={`${r}-${c}`} cx={124 + c * 24} cy={92 + r * 16} r="2.4" fill="currentColor" opacity="0.35" />
      )))}
      <circle cx="172" cy="108" r="9" fill={EMERALD} opacity="0.9" />
      <path d="M168 108l3 3 5-6" stroke="#fff" strokeWidth="2.4" />
    </Svg>
  );
}

export function MessagesHero() {
  return (
    <Svg>
      <rect x="100" y="56" width="120" height="80" rx="10" fill="currentColor" fillOpacity="0.10" stroke="currentColor" strokeWidth="3" />
      <path d="M100 64l60 40 60-40" stroke="currentColor" strokeWidth="3" />
      <rect x="146" y="92" width="28" height="22" rx="4" fill={EMERALD} opacity="0.18" stroke={EMERALD} strokeWidth="3" />
      <path d="M152 92v-6a8 8 0 0 1 16 0v6" stroke={EMERALD} strokeWidth="3" />
    </Svg>
  );
}

export function PublishingHero() {
  return (
    <Svg>
      <rect x="110" y="50" width="86" height="64" rx="8" fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeWidth="3" />
      <circle cx="132" cy="72" r="7" fill={AMBER} opacity="0.8" />
      <path d="M116 108l22-20 16 12 18-16 18 22" stroke="currentColor" strokeWidth="3" />
      <path d="M196 78c14 4 22 8 22 8s0 28-22 40c-22-12-22-40-22-40s8-4 22-8z" fill={EMERALD} fillOpacity="0.14" stroke={EMERALD} strokeWidth="3" />
      <path d="M188 104l6 6 12-14" stroke={EMERALD} strokeWidth="3" />
    </Svg>
  );
}

export function CrewHero() {
  return (
    <Svg>
      <circle cx="160" cy="92" r="56" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <circle cx="160" cy="92" r="34" stroke="currentColor" strokeWidth="2" opacity="0.4" />
      <circle cx="160" cy="92" r="10" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="3" />
      {[[160, 36, EMERALD], [216, 92, INDIGO], [160, 148, AMBER], [104, 92, ROSE], [120, 54, EMERALD], [200, 130, INDIGO]].map(([x, y, c], i) => (
        <circle key={i} cx={x as number} cy={y as number} r="6" fill={c as string} />
      ))}
    </Svg>
  );
}

export function WhyDecentralizationHero() {
  const nodes = [[60, 60], [110, 110], [160, 50], [210, 110], [260, 60], [160, 140]];
  return (
    <Svg>
      {nodes.map((a, i) => nodes.slice(i + 1).map((b, j) => (
        <line key={`${i}-${j}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="currentColor" strokeWidth="1.5" opacity="0.18" />
      )))}
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 2 ? 9 : 6} fill="currentColor" fillOpacity={i === 2 ? 0.25 : 0.12} stroke="currentColor" strokeWidth="3" />
      ))}
    </Svg>
  );
}

export function WotVsAlgorithmsHero() {
  return (
    <Svg>
      <path d="M70 134V60h-2 4-2" />
      <rect x="56" y="54" width="40" height="80" rx="8" fill={ROSE} fillOpacity="0.10" stroke={ROSE} strokeWidth="3" />
      <path d="M64 72h24M64 86h24M64 100h24" stroke={ROSE} strokeWidth="3" opacity="0.7" />
      <line x1="160" y1="60" x2="160" y2="130" stroke="currentColor" strokeWidth="2" opacity="0.2" />
      {[[210, 60], [260, 92], [210, 124], [248, 50], [248, 134]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="6" fill={EMERALD} />
      ))}
      {[[210, 60], [260, 92], [210, 124]].map(([x, y], i) => (
        <line key={i} x1="230" y1="92" x2={x} y2={y} stroke={EMERALD} strokeWidth="2" opacity="0.5" />
      ))}
      <circle cx="230" cy="92" r="8" fill={EMERALD} fillOpacity="0.25" stroke={EMERALD} strokeWidth="3" />
    </Svg>
  );
}

export function RelayCommunitiesHero() {
  return (
    <Svg>
      {[110, 160, 210].map((x, i) => (
        <g key={i}>
          <path d={`M${x - 10} 140h20M${x - 6} 140l6-30 6 30`} stroke="currentColor" strokeWidth="3" />
          <path d={`M${x - 4} 110l4-22 4 22`} stroke="currentColor" strokeWidth="3" fill="currentColor" fillOpacity="0.08" />
          <circle cx={x} cy={86} r="4" fill={i === 1 ? AMBER : "currentColor"} />
        </g>
      ))}
      <path d="M150 70a30 26 0 0 1 20 0" stroke={INDIGO} strokeWidth="3" opacity="0.6" />
    </Svg>
  );
}

export function DataSovereigntyHero() {
  return (
    <Svg>
      <path d="M160 40c18 6 30 10 30 10s0 40-30 56c-30-16-30-56-30-56s12-4 30-10z" fill="currentColor" fillOpacity="0.10" stroke="currentColor" strokeWidth="3" />
      <circle cx="160" cy="86" r="11" fill="none" stroke={AMBER} strokeWidth="3" />
      <path d="M160 97v18M160 115h8" stroke={AMBER} strokeWidth="3" />
      <circle cx="160" cy="86" r="3.5" fill={AMBER} />
    </Svg>
  );
}

export function WhereHeadingHero() {
  return (
    <Svg>
      <path d="M40 150h240" stroke="currentColor" strokeWidth="2" opacity="0.2" />
      <path d="M150 150c0-30 8-54 30-70" stroke="currentColor" strokeWidth="3" strokeDasharray="2 8" />
      <path d="M212 44l5 11 12 2-9 9 2 12-10-6-10 6 2-12-9-9 12-2z" fill={AMBER} stroke={AMBER} strokeWidth="2" />
      {[70, 110, 250, 280].map((x, i) => (
        <circle key={i} cx={x} cy={30 + (i % 2) * 20} r="1.6" fill="currentColor" opacity="0.4" />
      ))}
    </Svg>
  );
}

export function NostrVsAlternativesHero() {
  const bars = [[120, 40, EMERALD], [150, 64, INDIGO], [180, 80, INDIGO], [210, 56, INDIGO]];
  return (
    <Svg>
      <path d="M96 140h160" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      {bars.map(([x, h, c], i) => (
        <rect key={i} x={x as number} y={140 - (h as number)} width="20" height={h as number} rx="4"
          fill={c as string} fillOpacity={i === 0 ? 0.9 : 0.25} stroke={c as string} strokeWidth="2" />
      ))}
    </Svg>
  );
}

/* ───────────────────────── Concept diagrams ───────────────────────── */

function KeyShape({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y})`} stroke={color} strokeWidth="3" fill="none">
      <circle cx="0" cy="0" r="9" />
      <circle cx="0" cy="0" r="3" fill={color} />
      <path d="M9 0h24M27 0v8M33 0v8" />
    </g>
  );
}

export function KeyPairDiagram() {
  return (
    <Svg>
      <text x="160" y="26" textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.6">Two keys, one you</text>
      <KeyShape x={70} y={78} color={EMERALD} />
      <text x="92" y="118" textAnchor="middle" fontSize="9" fill={EMERALD}>Public · share it</text>
      <KeyShape x={200} y={78} color={ROSE} />
      <text x="222" y="118" textAnchor="middle" fontSize="9" fill={ROSE}>Secret · keep it</text>
    </Svg>
  );
}

export function SealedMessageDiagram() {
  return (
    <Svg>
      <rect x="30" y="74" width="44" height="32" rx="5" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="3" />
      <path d="M84 90h26" stroke="currentColor" strokeWidth="3" strokeDasharray="2 6" />
      <rect x="120" y="68" width="56" height="44" rx="6" fill={EMERALD} fillOpacity="0.12" stroke={EMERALD} strokeWidth="3" />
      <path d="M120 74l28 20 28-20" stroke={EMERALD} strokeWidth="3" />
      <path d="M142 100v-5a6 6 0 0 1 12 0v5" stroke={EMERALD} strokeWidth="2.5" />
      <path d="M186 90h26" stroke="currentColor" strokeWidth="3" strokeDasharray="2 6" />
      <path d="M222 140h40M230 140l6-26 6 26" stroke="currentColor" strokeWidth="3" />
      <circle cx="242" cy="108" r="3" fill="currentColor" />
      <text x="242" y="62" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.55">relay can't read it</text>
    </Svg>
  );
}

export function CircleOfTrustDiagram() {
  return (
    <Svg>
      <circle cx="160" cy="92" r="62" stroke="currentColor" strokeWidth="1.5" opacity="0.2" />
      <circle cx="160" cy="92" r="38" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
      <circle cx="160" cy="92" r="9" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="3" />
      {[[160, 54, EMERALD], [198, 92, EMERALD], [160, 130, INDIGO], [122, 92, INDIGO]].map(([x, y, c], i) => (
        <circle key={i} cx={x as number} cy={y as number} r="6" fill={c as string} />
      ))}
      {[[122, 40], [212, 50], [104, 138], [224, 132]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="5" fill="currentColor" opacity="0.25" />
      ))}
      <text x="160" y="172" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.55">closest people first</text>
    </Svg>
  );
}

export function RelayTowersDiagram() {
  return (
    <Svg>
      <path d="M70 140h44M82 140l6-40 6 40" stroke="currentColor" strokeWidth="3" />
      <path d="M86 100l6-30 6 30" stroke="currentColor" strokeWidth="3" fill="currentColor" fillOpacity="0.08" />
      <circle cx="92" cy="66" r="4" fill={AMBER} />
      <path d="M112 56a34 34 0 0 1 0 40M70 56a34 34 0 0 0 0 40" stroke={INDIGO} strokeWidth="3" opacity="0.6" />
      <text x="92" y="160" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.6">Public · open</text>
      <path d="M206 140h44M218 140l6-40 6 40" stroke="currentColor" strokeWidth="3" />
      <rect x="214" y="64" width="24" height="20" rx="4" fill={EMERALD} fillOpacity="0.14" stroke={EMERALD} strokeWidth="3" />
      <path d="M220 64v-4a6 6 0 0 1 12 0v4" stroke={EMERALD} strokeWidth="2.5" />
      <text x="228" y="160" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.6">Private · invite</text>
    </Svg>
  );
}

export function WalletConnectDiagram() {
  return (
    <Svg>
      <rect x="40" y="64" width="70" height="52" rx="10" fill="currentColor" fillOpacity="0.10" stroke="currentColor" strokeWidth="3" />
      <text x="75" y="94" textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.7">Wallet</text>
      <path d="M118 90h84" stroke={AMBER} strokeWidth="3" strokeDasharray="3 6" />
      <rect x="146" y="78" width="28" height="24" rx="5" fill={AMBER} fillOpacity="0.14" stroke={AMBER} strokeWidth="2.5" />
      <path d="M156 88l-3 6h5l-2 5 7-8h-5l3-5z" fill={AMBER} />
      <rect x="210" y="64" width="70" height="52" rx="10" fill={INDIGO} fillOpacity="0.10" stroke={INDIGO} strokeWidth="3" />
      <text x="245" y="94" textAnchor="middle" fontSize="9" fill={INDIGO}>Relay Outpost</text>
      <text x="160" y="138" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.55">linked by a connection code</text>
    </Svg>
  );
}

export function ZapDiagram() {
  return (
    <Svg>
      <rect x="40" y="62" width="74" height="56" rx="8" fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeWidth="3" />
      <path d="M52 80h50M52 92h40M52 104h30" stroke="currentColor" strokeWidth="3" opacity="0.5" />
      <path d="M150 58l-18 36h16l-8 30 30-42h-18l10-24z" fill={AMBER} stroke={AMBER} strokeWidth="2" />
      <circle cx="246" cy="90" r="26" fill={AMBER} fillOpacity="0.14" stroke={AMBER} strokeWidth="3" />
      <path d="M246 74v32M239 81h10a4 4 0 0 1 0 8h-10M239 89h12a4 4 0 0 1 0 8h-12" stroke={AMBER} strokeWidth="2.6" />
    </Svg>
  );
}

export function StrippedPhotoDiagram() {
  return (
    <Svg>
      <rect x="38" y="60" width="80" height="60" rx="8" fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeWidth="3" />
      <circle cx="60" cy="80" r="6" fill={AMBER} opacity="0.8" />
      <path d="M44 114l20-18 14 10 16-14 18 22" stroke="currentColor" strokeWidth="3" />
      <path d="M104 56a8 8 0 1 1 0 0M104 54v8" stroke={ROSE} strokeWidth="3" />
      <circle cx="104" cy="52" r="6" fill="none" stroke={ROSE} strokeWidth="3" />
      <path d="M104 58v6" stroke={ROSE} strokeWidth="3" />
      <path d="M130 90h28" stroke={EMERALD} strokeWidth="3" strokeDasharray="3 6" />
      <rect x="172" y="60" width="80" height="60" rx="8" fill={EMERALD} fillOpacity="0.06" stroke={EMERALD} strokeWidth="3" />
      <path d="M178 114l20-18 14 10 16-14 18 22" stroke={EMERALD} strokeWidth="3" />
      <circle cx="194" cy="80" r="6" fill={EMERALD} opacity="0.6" />
      <text x="212" y="140" textAnchor="middle" fontSize="9" fill={EMERALD}>clean — no location</text>
    </Svg>
  );
}

export function CentralVsNodesDiagram() {
  return (
    <Svg>
      <circle cx="80" cy="90" r="16" fill={ROSE} fillOpacity="0.14" stroke={ROSE} strokeWidth="3" />
      {[[40, 50], [120, 50], [40, 130], [120, 130], [40, 90], [120, 90]].map(([x, y], i) => (
        <g key={i}>
          <line x1="80" y1="90" x2={x} y2={y} stroke={ROSE} strokeWidth="2" opacity="0.4" />
          <circle cx={x} cy={y} r="4" fill={ROSE} opacity="0.6" />
        </g>
      ))}
      <text x="80" y="160" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.6">one owner</text>
      <line x1="150" y1="40" x2="150" y2="140" stroke="currentColor" strokeWidth="1.5" opacity="0.2" />
      {(() => { const n = [[200, 56], [248, 78], [284, 56], [216, 110], [264, 124], [292, 100]]; return (
        <>
          {n.map((a, i) => n.slice(i + 1).map((b, j) => (
            <line key={`${i}-${j}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={EMERALD} strokeWidth="1.4" opacity="0.25" />
          )))}
          {n.map(([x, y], i) => (<circle key={i} cx={x} cy={y} r="5" fill={EMERALD} />))}
        </>
      ); })()}
      <text x="248" y="160" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.6">no owner</text>
    </Svg>
  );
}

export function AlgorithmVsTrustDiagram() {
  return (
    <Svg>
      <path d="M56 56h60l-18 28v26h-24V84z" fill={ROSE} fillOpacity="0.10" stroke={ROSE} strokeWidth="3" />
      <path d="M74 124l16 14M102 124l-16 14" stroke={ROSE} strokeWidth="3" opacity="0.7" />
      <text x="86" y="160" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.6">the algorithm</text>
      <line x1="160" y1="44" x2="160" y2="140" stroke="currentColor" strokeWidth="1.5" opacity="0.2" />
      {(() => { const n = [[210, 58], [258, 84], [214, 116], [256, 128], [288, 70]]; return (
        <>
          {n.map(([x, y], i) => (<line key={i} x1="236" y1="92" x2={x} y2={y} stroke={EMERALD} strokeWidth="2" opacity="0.45" />))}
          {n.map(([x, y], i) => (<circle key={i} cx={x} cy={y} r="6" fill={EMERALD} />))}
          <circle cx="236" cy="92" r="8" fill={EMERALD} fillOpacity="0.25" stroke={EMERALD} strokeWidth="3" />
        </>
      ); })()}
      <text x="246" y="160" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.6">your circle</text>
    </Svg>
  );
}

export function PortableIdentityDiagram() {
  return (
    <Svg>
      {[[60, 50], [212, 50], [136, 110]].map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="48" height="36" rx="6" fill="currentColor" fillOpacity="0.06" stroke="currentColor" strokeWidth="2.5" opacity={0.55} />
      ))}
      <path d="M108 68h104M84 86l52 24M236 68l-100 42" stroke={AMBER} strokeWidth="2" strokeDasharray="3 6" opacity="0.6" />
      <KeyShape x={138} y={128} color={AMBER} />
      <text x="160" y="170" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.6">one identity, every app</text>
    </Svg>
  );
}

export function OutpostSectionsDiagram() {
  const cells = ["Posts", "Discussions", "Chat", "Articles", "About"];
  return (
    <Svg>
      {cells.map((label, i) => {
        const x = 26 + (i % 3) * 96;
        const y = 44 + Math.floor(i / 3) * 56;
        return (
          <g key={label}>
            <rect x={x} y={y} width="84" height="44" rx="8" fill="currentColor" fillOpacity="0.07" stroke="currentColor" strokeWidth="2.5" />
            <text x={x + 42} y={y + 27} textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.75">{label}</text>
          </g>
        );
      })}
    </Svg>
  );
}

export function EventRsvpDiagram() {
  return (
    <Svg>
      <rect x="64" y="46" width="120" height="96" rx="10" fill="currentColor" fillOpacity="0.07" stroke="currentColor" strokeWidth="3" />
      <path d="M64 72h120" stroke="currentColor" strokeWidth="3" />
      <path d="M92 38v16M156 38v16" stroke="currentColor" strokeWidth="3" />
      {[0, 1].map((r) => [0, 1, 2].map((c) => (
        <circle key={`${r}-${c}`} cx={88 + c * 36} cy={92 + r * 22} r="2.6" fill="currentColor" opacity="0.3" />
      )))}
      <circle cx="216" cy="92" r="26" fill={EMERALD} fillOpacity="0.14" stroke={EMERALD} strokeWidth="3" />
      <path d="M204 92l8 9 14-16" stroke={EMERALD} strokeWidth="3.4" />
      <text x="216" y="138" textAnchor="middle" fontSize="9" fill={EMERALD}>RSVP</text>
    </Svg>
  );
}
