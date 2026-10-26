// verifySubmission (the SDK's copy of the submit-run verdict rules) with this core.
import { describe, expect, it } from "vitest";
import { verifySubmission, type RunSubmission } from "@arcadepro/game-sdk";
import coreModule from "../src/core";

const config = {
  gameId: "stub-tapper",
  gameVersion: "0.0.1",
  seed: 4051550508,
  tickRate: 60,
};
const honest: RunSubmission = {
  runId: "run-1",
  gameId: "stub-tapper",
  gameVersion: "0.0.1",
  inputs: {
    totalTicks: 1800,
    events: Array.from({ length: 150 }, (_, i) => ({ t: i * 12, a: "tap" })),
  },
  clientScore: 153,
  clientDurationMs: 30_000,
};

describe("verifySubmission with Stub Tapper", () => {
  it("verifies an honest submission", () => {
    expect(verifySubmission(coreModule, config, honest)).toEqual({
      status: "verified",
      score: 153,
      isPersonalBest: true,
    });
  });

  it("flags an inflated clientScore", () => {
    expect(
      verifySubmission(coreModule, config, { ...honest, clientScore: 500 }),
    ).toEqual({
      status: "flagged",
      score: 153,
      reasons: ["client_score_mismatch"],
    });
  });

  it("flags time_drift for 8 s of wall-clock on a full 30 s run", () => {
    expect(
      verifySubmission(coreModule, config, {
        ...honest,
        clientDurationMs: 8000,
      }),
    ).toEqual({ status: "flagged", score: 153, reasons: ["time_drift"] });
  });
});
