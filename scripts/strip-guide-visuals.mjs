// One-off: strip all banners/diagrams/placeholder media from the 12 guide pages
// that use the wtf illustration system. Removes:
//   - the GuideHero import + its single-line usage (top banner)
//   - the illustrations import line
//   - StepCard media props: standalone `mediaBanner` / `mediaVideo`, and any
//     single-line `image={<SomeDiagram />}`
// Leaves all step text/structure intact. Shared components + illustrations.tsx
// are kept on disk (unused) as scaffolding for later. NostrVsAlternatives.tsx
// (a .webp hero, different pattern) is handled separately by hand.
import { readFileSync, writeFileSync } from "node:fs";

const DIR = "client/src/pages";
const FILES = [
  "FirstTenMinutes", "SettingUpOutpost", "ConnectingWallet", "UsingContentCalendar",
  "EncryptedMessages", "PublishingPrivacy", "ManagingCrew", "WhyDecentralization",
  "WotVsAlgorithms", "RelayCommunities", "DataSovereignty", "WhereNostrIsHeading",
];

const isMediaProp = (t) =>
  t === "mediaBanner" || t === "mediaVideo" || /^image=\{<.*\/>\}$/.test(t);

for (const name of FILES) {
  const path = `${DIR}/${name}.tsx`;
  const lines = readFileSync(path, "utf8").split("\n");
  let removed = 0;
  const kept = lines.filter((line) => {
    const t = line.trim();
    if (t.startsWith('import { GuideHero }')) { removed++; return false; }
    if (t.startsWith("import {") && t.includes('from "@/components/wtf/illustrations"')) { removed++; return false; }
    if (t.startsWith("<GuideHero")) { removed++; return false; }
    if (isMediaProp(t)) { removed++; return false; }
    return true;
  });
  // collapse any 3+ consecutive blank lines left behind into one
  const out = [];
  for (const l of kept) {
    if (l.trim() === "" && out.length && out[out.length - 1].trim() === "") continue;
    out.push(l);
  }
  writeFileSync(path, out.join("\n"));
  console.log(`${name.padEnd(22)} removed ${removed} lines`);
}
console.log("done");
