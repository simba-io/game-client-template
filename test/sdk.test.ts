// Both SDK entry points resolve, with types, from the installed git dependency.
import { describe, expect, it } from "vitest";
import {
  MANIFEST_FILENAME,
  createRng,
  type GameModule,
} from "@arcadepro/game-sdk";
import { RunDriver, createLinkedTransports } from "@arcadepro/game-sdk/client";

describe("@arcadepro/game-sdk", () => {
  it("root entry resolves", () => {
    expect(MANIFEST_FILENAME).toBe("arcadepro.json");
    expect(createRng(1).nextUint32()).toBe(createRng(1).nextUint32());
    const mod: GameModule | null = null;
    expect(mod).toBeNull();
  });

  it("client entry resolves", () => {
    expect(typeof RunDriver).toBe("function");
    expect(createLinkedTransports()).toHaveLength(2);
  });
});
