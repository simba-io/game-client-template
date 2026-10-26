// Golden values verified against the live submit-run server (2026-10-18).
// If any of these change, the rules changed: bump the game version.
import { describe, expect, it } from "vitest";
import { checkPlausibility, replay, type InputLog } from "@arcadepro/game-sdk";
import { core, plausibility } from "../src/core/rules";

const config = {
  gameId: "stub-tapper",
  gameVersion: "0.0.1",
  seed: 4051550508,
  tickRate: 60,
};
const every = (n: number, count: number): InputLog => ({
  totalTicks: 1800,
  events: Array.from({ length: count }, (_, i) => ({ t: i * n, a: "tap" })),
});

describe("Stub Tapper golden runs", () => {
  it("tap every 12 ticks × 150 → 153", () => {
    expect(replay(core, config, every(12, 150))).toEqual({
      ok: true,
      score: 153,
      ticks: 1800,
      ended: true,
    });
  });

  it("tap every 10 ticks × 180 → 183", () => {
    expect(replay(core, config, every(10, 180))).toEqual({
      ok: true,
      score: 183,
      ticks: 1800,
      ended: true,
    });
  });

  it("tap on every tick → 1820, flagged input_rate_too_high", () => {
    const log = every(1, 1800);
    const result = replay(core, config, log);
    expect(result).toEqual({ ok: true, score: 1820, ticks: 1800, ended: true });
    expect(checkPlausibility(core, plausibility, log, 1820, 30_000)).toEqual([
      "input_rate_too_high",
    ]);
  });
});
