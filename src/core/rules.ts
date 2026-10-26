// Stub Tapper rules. A copy of arcadepro-supabase
// supabase/functions/submit-run/cores/stub-tapper.ts: do not change behaviour.
// Any rule change needs a new game version (docs/ARCHITECTURE.md §7).
import { createRng, type GameCore } from "@arcadepro/game-sdk";

const TICK_RATE = 60;
const MAX_TICKS = TICK_RATE * 30; // 30 seconds
const BONUS_TICKS = 20;

export interface StubTapperState {
  tick: number;
  score: number;
  bonus: ReadonlySet<number>; // ticks on which a tap scores 2
}

export const core: GameCore<StubTapperState> = {
  gameId: "stub-tapper",
  version: "0.0.1",
  tickRate: TICK_RATE,
  actions: ["tap"],
  maxTicks: MAX_TICKS,
  init(config) {
    const rng = createRng(config.seed);
    const bonus = new Set<number>();
    for (let i = 0; i < BONUS_TICKS; i++) bonus.add(rng.int(0, MAX_TICKS - 1));
    return { tick: 0, score: 0, bonus };
  },
  step(s, inputs) {
    const taps = inputs.filter((e) => e.a === "tap").length;
    const pts = taps * (s.bonus.has(s.tick) ? 2 : 1);
    return { ...s, tick: s.tick + 1, score: s.score + pts };
  },
  isOver: (s) => s.tick >= MAX_TICKS,
  score: (s) => s.score,
};

export const plausibility = { maxInputsPerSecond: 20, maxTimeDrift: 0.25 };

/** Read-only helper for rendering: true if a tap right now scores double. */
export const isBonusTick = (s: StubTapperState): boolean => s.bonus.has(s.tick);
