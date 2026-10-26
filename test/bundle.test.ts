// Checks on the build outputs. Runs only when both dist/ and dist-core/ exist
// (npm run build && npm run build:core); otherwise skipped.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isGameManifest,
  replay,
  type GameCoreModule,
  type GameManifest,
} from "@arcadepro/game-sdk";
import pkg from "../package.json";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const distCore = join(root, "dist-core");
const built = existsSync(dist) && existsSync(distCore);

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe.skipIf(!built)("build outputs", () => {
  it("dist/arcadepro.json is a valid manifest for this version", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(join(dist, "arcadepro.json"), "utf8"),
    );
    expect(isGameManifest(manifest)).toBe(true);
    const m = manifest as GameManifest;
    expect(m.gameVersion).toBe(pkg.version);
    expect(existsSync(join(dist, m.entry))).toBe(true);
  });

  it("dist/ contains no HTML (Storage serves it as text/plain)", () => {
    expect(filesUnder(dist).filter((f) => f.endsWith(".html"))).toEqual([]);
  });

  it('no file in dist/ references absolute "/assets/ paths', () => {
    const text = filesUnder(dist).filter((f) => /\.(js|json|css|svg)$/.test(f));
    const offenders = text.filter((f) =>
      readFileSync(f, "utf8").includes('"/assets/'),
    );
    expect(offenders).toEqual([]);
  });

  it("dist-core/core.js has no import or require statements", () => {
    const code = readFileSync(join(distCore, "core.js"), "utf8");
    expect(code).not.toMatch(/^\s*import[\s{*"']/m);
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toMatch(/\brequire\s*\(/);
  });

  it("dist-core/core.js reproduces the golden values", async () => {
    const url = pathToFileURL(join(distCore, "core.js")).href;
    const { default: mod } = (await import(/* @vite-ignore */ url)) as {
      default: GameCoreModule;
    };
    const config = {
      gameId: "stub-tapper",
      gameVersion: "0.0.1",
      seed: 4051550508,
      tickRate: 60,
    };
    const every = (n: number, count: number) => ({
      totalTicks: 1800,
      events: Array.from({ length: count }, (_, i) => ({ t: i * n, a: "tap" })),
    });
    expect(replay(mod.core, config, every(12, 150))).toEqual({
      ok: true,
      score: 153,
      ticks: 1800,
      ended: true,
    });
    expect(replay(mod.core, config, every(10, 180))).toEqual({
      ok: true,
      score: 183,
      ticks: 1800,
      ended: true,
    });
    expect(replay(mod.core, config, every(1, 1800))).toMatchObject({
      score: 1820,
    });
  });
});
