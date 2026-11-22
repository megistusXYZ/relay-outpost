import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

/**
 * The production image installs its runtime packages by hand (Dockerfile,
 * runtime stage), outside the lockfile. Those pins drift: the October
 * dependency update raised sharp to 0.35.5 for its SVG loader fix in
 * package.json and the lockfile, and the image kept installing 0.35.4, so
 * every test ran the fixed library while production ran the old one.
 *
 * Every package the image installs must be the exact version the lockfile
 * resolves, which is the version the tests and the build ran against.
 */
const root = path.resolve(__dirname, "..");
const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")) as {
  packages: Record<string, { version?: string }>;
};

/** `name@version` pairs from the runtime stage's `npm install` line(s). */
function runtimePins(): Array<{ name: string; version: string }> {
  const runtime = dockerfile.slice(dockerfile.lastIndexOf("FROM "));
  // A backslash at a line end continues the command onto the next line.
  const install = runtime.match(/RUN npm install(?:[^\n\\]|\\\n)*/g) ?? [];
  const pins: Array<{ name: string; version: string }> = [];
  for (const block of install) {
    for (const m of block.matchAll(/(?:^|\s)((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)@(\d+\.\d+\.\d+[^\s\\]*)/g)) {
      pins.push({ name: m[1], version: m[2] });
    }
  }
  return pins;
}

describe("the production image installs what the tests ran", () => {
  const pins = runtimePins();

  it("finds the runtime install line (or this test proves nothing)", () => {
    expect(pins.map((p) => p.name)).toEqual(expect.arrayContaining(["sharp", "jsdom", "drizzle-orm", "pg"]));
  });

  it("every pinned package is the version the lockfile resolves", () => {
    const drift = pins
      .map(({ name, version }) => ({ name, image: version, lockfile: lock.packages[`node_modules/${name}`]?.version }))
      .filter((p) => p.image !== p.lockfile);
    expect(drift).toEqual([]);
  });
});
