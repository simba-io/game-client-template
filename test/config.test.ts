import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import { GAME } from "../src/game.config";

describe("game identity", () => {
  it("package.json version matches GAME.version", () => {
    expect(pkg.version).toBe(GAME.version);
  });

  it("GAME.id is a valid games.id slug", () => {
    expect(GAME.id).toMatch(/^[a-z0-9-]{2,40}$/);
  });

  // Phase 3 adds: GAME.version === coreModule.core.version and GAME.id === coreModule.core.gameId.
});
