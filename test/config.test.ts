import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import { GAME } from "../src/game.config";
import coreModule from "../src/core";

// The core keeps its own literal id/version (it may only import the SDK and
// src/core), so these checks are what keep all three in step.
describe("game identity", () => {
  it("package.json version === GAME.version === core.version", () => {
    expect(pkg.version).toBe(GAME.version);
    expect(coreModule.core.version).toBe(GAME.version);
  });

  it("GAME.id === core.gameId, and is a valid games.id slug", () => {
    expect(coreModule.core.gameId).toBe(GAME.id);
    expect(GAME.id).toMatch(/^[a-z0-9-]{2,40}$/);
  });
});
