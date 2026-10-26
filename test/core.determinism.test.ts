import { describe, expect, it } from "vitest";
import {
  createRng,
  replay,
  type InputEvent,
  type InputLog,
  type RunConfig,
} from "@arcadepro/game-sdk";
import { core, type StubTapperState } from "../src/core/rules";

const configFor = (seed: number): RunConfig =>
  Object.freeze({
    gameId: "stub-tapper",
    gameVersion: "0.0.1",
    seed,
    tickRate: 60,
  });

/** A random, valid input log: sorted taps within a random run length. */
function randomLog(rng: ReturnType<typeof createRng>): InputLog {
  const totalTicks = rng.int(0, core.maxTicks);
  const count = totalTicks === 0 ? 0 : rng.int(0, 400);
  const events = Array.from({ length: count }, () => rng.int(0, totalTicks - 1))
    .sort((a, b) => a - b)
    .map((t) => ({ t, a: "tap" }));
  return { totalTicks, events };
}

/** Freeze the state object and snapshot its Set, which Object.freeze can't protect. */
function freezeState(s: StubTapperState): () => void {
  Object.freeze(s);
  const bonus = [...s.bonus];
  const snapshot = { tick: s.tick, score: s.score };
  return () => {
    expect({ tick: s.tick, score: s.score }).toEqual(snapshot);
    expect([...s.bonus]).toEqual(bonus);
  };
}

describe("Stub Tapper determinism", () => {
  it("replaying the same log twice gives identical results (100 seeds)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 100; i++) {
      const config = configFor(rng.nextUint32());
      const log = randomLog(rng);
      const a = replay(core, config, log);
      const b = replay(core, config, log);
      expect(a.ok).toBe(true);
      expect(b).toEqual(a);
    }
  });

  it("different seeds give different bonus sets (≥ 95 of 100 pairs)", () => {
    const rng = createRng(11);
    let differ = 0;
    for (let i = 0; i < 100; i++) {
      const a = core.init(configFor(rng.nextUint32())).bonus;
      const b = core.init(configFor(rng.nextUint32())).bonus;
      if ([...a].sort().join() !== [...b].sort().join()) differ++;
    }
    expect(differ).toBeGreaterThanOrEqual(95);
  });

  it("init is a pure function of the config", () => {
    const config = configFor(4051550508);
    const a = core.init(config);
    core.init(configFor(1)); // unrelated run in between
    const b = core.init(config);
    expect(b).toEqual(a);
    expect(b.bonus).not.toBe(a.bonus); // no shared state between runs
    expect(config).toEqual(configFor(4051550508));
  });

  it("step does not mutate its input state or inputs", () => {
    let state = core.init(configFor(4051550508));
    const rng = createRng(3);
    for (let tick = 0; tick < core.maxTicks; tick++) {
      const inputs: InputEvent[] = Array.from({ length: rng.int(0, 2) }, () =>
        Object.freeze({ t: tick, a: "tap" }),
      );
      Object.freeze(inputs);
      const unchanged = freezeState(state);
      const next = core.step(state, inputs);
      unchanged();
      expect(next).not.toBe(state);
      expect(next.tick).toBe(tick + 1);
      state = next;
    }
    expect(core.isOver(state)).toBe(true);
  });

  it("rejects an unknown action", () => {
    const log = { totalTicks: 10, events: [{ t: 1, a: "cheat" }] };
    expect(replay(core, configFor(1), log)).toMatchObject({
      ok: false,
      error: "malformed_inputs",
    });
  });

  it("rejects a log longer than maxTicks", () => {
    const log = { totalTicks: core.maxTicks + 1, events: [] };
    expect(replay(core, configFor(1), log)).toMatchObject({
      ok: false,
      error: "malformed_inputs",
    });
  });

  it("rejects ticks out of order", () => {
    const log = {
      totalTicks: 10,
      events: [
        { t: 5, a: "tap" },
        { t: 2, a: "tap" },
      ],
    };
    expect(replay(core, configFor(1), log)).toMatchObject({
      ok: false,
      error: "malformed_inputs",
    });
  });
});
