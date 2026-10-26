// Single source of game identity. The values live in game.config.json so
// Node scripts (scripts/write-manifest.mjs) can read them without TypeScript.
// Keep this a plain constant module: it must never pull in anything non-pure.
import config from "./game.config.json";

export interface GameConfig {
  /** games.id slug, ^[a-z0-9-]{2,40}$. */
  readonly id: string;
  /** Semver; must equal package.json version and core.version. */
  readonly version: string;
  readonly title: string;
  readonly orientation: "portrait" | "landscape";
  readonly designWidth: number;
  readonly designHeight: number;
  /** Any CSS colour string Pixi accepts, e.g. "#1099bb". */
  readonly background: string;
}

export const GAME: GameConfig = Object.freeze(config as GameConfig);
