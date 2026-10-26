# ADAPTATION_PLAN.md: turning game-client-template into the ArcadePro game template

**Audience:** Claude Code (and Cameron). Read `CLAUDE.md` and `docs/ARCHITECTURE.md` first.

**How to work through this plan**
- Do the phases **in order**. Within a phase, do the steps in order.
- At the end of each phase, check **every** acceptance criterion, run the full check
  (`npm run lint && npm run typecheck && npm test && npm run build`, once those scripts exist),
  then commit with the message given. Push after each phase.
- Tick off the phase in the **Progress** section at the bottom of this file in the same commit,
  adding a one-line note of anything that deviated from the plan.
- If something in this plan turns out to be wrong or impossible, **stop and explain** rather than
  improvising a different design. Cameron decides.

**Starting state (reviewed 2026-10-25, commit `714e994`)**
- 14 files: Vite 6 + PixiJS 8 + TS 5.7, `src/main.ts` (Pixi app, 1920×3000 portrait design area,
  letterbox resize on `window`), `src/Scene.ts` (empty `update(delta)` that nothing calls),
  `index.html`, `public/assets/bunny.png`, `public/assets/logo.svg`, empty `public/style.css`.
- `package.json` is named `framework-react`, version `0.0.0`. Dependencies: `pixi.js ^8.8.1`, `simple-sound-editor ^1.0.0` (unused).
- **`npm run build` fails:** 44 Prettier formatting errors (auto-fixable) + `'delta' is declared but never read`
  (ESLint `no-unused-vars` and `tsc` TS6133). `vite build` on its own succeeds.
- No game loop, no tests, no SDK.

---

## Phase 0: SDK v0.2.0 (in repo `simba-io/arcadepro-game-sdk`, not this repo)

The template needs generic client-side helpers that **every** game will share. They belong in
the SDK so all games behave identically and bugs get fixed once.

**Do not modify `src/run.ts`, `src/core.ts`, `src/rng.ts`, `src/replay.ts` or `src/protocol.ts`.**
The deployed `submit-run` validator vendors the first four, and the protocol is the platform
contract. Only add files and exports.

### 0.1 Make the git dependency installable
- `package.json`: add `"prepare": "npm run build"`. npm runs `prepare` when installing a git
  dependency; without it `dist/` (gitignored) never exists and imports fail.
- Bump `"version"` to `"0.2.0"`.
- Add a subpath export:
  ```json
  "exports": {
    ".":        { "types": "./dist/index.d.ts",        "import": "./dist/index.js" },
    "./client": { "types": "./dist/client/index.d.ts", "import": "./dist/client/index.js" }
  }
  ```
- Add devDependency `vitest` and change `"test"` to `"npm run build && vitest run && tsx test/determinism.test.ts"`
  (keep the existing determinism script working, or port it to vitest; either is fine).

### 0.2 `src/manifest.ts` (DOM-free, exported from the root `index.ts`)
```ts
export const MANIFEST_FILENAME = "arcadepro.json";
export const MANIFEST_VERSION = 1;

export interface GameManifest {
  manifestVersion: 1;
  gameId: string;          // ^[a-z0-9-]{2,40}$
  gameVersion: string;     // semver x.y.z
  sdkVersion: string;      // SDK version the build was made with
  entry: string;           // relative path of the ES module, normally "game.js"
  orientation: "portrait" | "landscape";
  designWidth: number;
  designHeight: number;
  builtAt: string;         // ISO timestamp
}

export function isGameManifest(x: unknown): x is GameManifest; // strict shape + regex checks

/** Handed to mount() by the platform shell (or the dev host). */
export interface MountContext {
  /** Absolute URL of the build folder, ending in "/". Load every asset relative to this. */
  assetBaseUrl: string;
  mode: "platform" | "standalone";
  /** Optional transport override; defaults to postMessage to window.parent. */
  transport?: Transport;   // type re-declared here structurally (see 0.3) so root stays DOM-free
}

export interface GameInstance { destroy(): void; }

/** What a game build's entry module (game.js) must export. */
export interface GameModule {
  mount(container: HTMLElement, ctx: MountContext): Promise<GameInstance>;
}
```
(`HTMLElement` as a type only is fine. The root build already has `lib: DOM` in tsconfig. Root
code must not *use* DOM globals at runtime.)

### 0.3 `src/client/` (browser helpers, exported only via `@arcadepro/game-sdk/client`)

**`transport.ts`**
```ts
export interface Transport {
  send(msg: ProtocolMessage): void;
  subscribe(handler: (msg: ProtocolMessage) => void): () => void; // returns unsubscribe
}
/** Production: posts to `target` with targetOrigin "*", accepts only events whose
 *  event.source === target and isProtocolMessage(event.data). */
export function postMessageTransport(target: Window): Transport;
/** Dev/tests: two linked in-memory transports (A.send → B handlers, async via queueMicrotask). */
export function createLinkedTransports(): [Transport, Transport];
```

**`fixed-step.ts`: pure, no requestAnimationFrame, unit-testable**
```ts
export class FixedStepLoop {
  constructor(opts: { tickRate: number; maxStepsPerFrame?: number /* default 5 */ });
  readonly stepMs: number;                 // 1000 / tickRate
  get paused(): boolean;
  get activeMs(): number;                  // total elapsed ms fed while NOT paused (→ clientDurationMs)
  pause(): void; resume(): void;
  /** Feed real elapsed ms (e.g. Pixi ticker.deltaMS). Returns how many steps to run now.
   *  Accumulates remainder; caps at maxStepsPerFrame and DROPS excess accumulated time
   *  (prevents spiral of death; dropped time is also NOT added to activeMs). Returns 0 while paused. */
  advance(elapsedMs: number): number;
  reset(): void;
}
```
Note: dropped time must not count towards `activeMs`. Otherwise a stall makes wall-clock time
exceed simulated time and the run gets flagged for `time_drift`.

**`input-recorder.ts`**
```ts
export class InputRecorder {
  constructor(allowedActions: readonly string[]);
  /** Stamp with the tick that will be simulated NEXT (set by the driver). Throws on unknown action.
   *  Ignored (returns false) when closed. */
  record(action: string, value?: number): boolean;
  setPendingTick(t: number): void;
  /** Remove and return all events stamped with tick t (in recording order). */
  drain(t: number): InputEvent[];
  close(): void;                           // after isOver: stop accepting inputs
  readonly events: readonly InputEvent[];  // full log in order (for the submission)
  reset(): void;
}
```

**`run-driver.ts`: glues core + loop + recorder. MUST mirror `replay()` exactly.**
```ts
export class RunDriver<S> {
  constructor(core: GameCore<S>, opts?: { maxStepsPerFrame?: number });
  readonly loop: FixedStepLoop;
  readonly recorder: InputRecorder;
  get state(): S | null;  get tick(): number;  get running(): boolean;
  start(session: RunSession): void;   // checks session.config.gameId/gameVersion/tickRate === core's; state = core.init(config)
  /** Call every frame with elapsed ms. For each step: recorder.setPendingTick(tick);
   *  batch = recorder.drain(tick); state = core.step(state, batch); tick++;
   *  if core.isOver(state): finish. Between frames, setPendingTick(tick) so new inputs land on the next tick. */
  advance(elapsedMs: number): void;
  onEnd(cb: (submission: RunSubmission) => void): () => void;
  pause(): void; resume(): void;
}
```
On finish: `recorder.close()`, then build
`RunSubmission { runId, gameId, gameVersion, inputs: { totalTicks: tick, events: recorder.events }, clientScore: core.score(state), clientDurationMs: Math.round(loop.activeMs) }`.
Also finish if `tick === core.maxTicks` even if `isOver` is false (replay never goes past `maxTicks`).
**Invariant:** every recorded event has `t < totalTicks`. `replay()` rejects `t >= totalTicks`,
so after the final step no event may be stamped with the final tick value.

**`game-bridge.ts`: the game side of the protocol**
```ts
export class GameBridge {
  constructor(opts: { gameId: string; gameVersion: string; transport: Transport });
  ready(): void;                                 // sends "ready"
  progress(runId: string, score: number): void;  // throttled to ≤ 4 msgs/s, last value wins
  end(submission: RunSubmission): void;          // sends "run:end"
  error(message: string, runId?: string): void;
  onStart(cb: (s: RunSession) => void): () => void;
  onResult(cb: (r: { runId: string; verdict: RunVerdict }) => void): () => void;
  onPause(cb: () => void): () => void;  onResume(cb: () => void): () => void;
  onMute(cb: (muted: boolean) => void): () => void;
  dispose(): void;
}
```

**`standalone-host.ts`: fake platform for `npm run dev` and tests**
```ts
export class StandaloneHost {
  constructor(opts: { coreModule: GameCoreModule<any>; transport: Transport; seed?: number; log?: (line: string) => void });
  /** Sends "start" with a fake RunSession: runId = crypto.randomUUID(), runToken "dev",
   *  config from the core (seed: opts.seed ?? random uint32), expiresAt now+1h, player { displayName: "dev", personalBest }. */
  startRun(): RunSession;
  // On "run:end": runs replay() + checkPlausibility() + client-score comparison exactly like
  // submit-run/validate.ts and answers "run:result" with the same RunVerdict shapes
  // (verified / flagged with reasons / rejected with reason). Tracks personal best in memory.
  dispose(): void;
}
```
The verdict logic should be a shared pure function, `verifySubmission(coreModule, config, submission): RunVerdict`,
exported from the **root** SDK (DOM-free) so the template harness and tests use the exact same rules.
Mirror the server's ordering: replay error → rejected; plausibility reasons +
`client_score_mismatch` → flagged; else verified.

### 0.4 Tests (vitest) in the SDK
- `fixed-step`: 60 Hz with deltas of 16.67 ms gives ~60 steps per 1000 ms; a 1000 ms stall returns
  `maxStepsPerFrame` steps and `activeMs` grows by `maxStepsPerFrame * stepMs` only; while paused
  `advance` returns 0 and `activeMs` doesn't grow.
- `input-recorder`: unknown action throws; `drain` returns only that tick's events in order; closed recorder ignores input.
- **`run-driver` ≡ `replay` (most important):** using the Stub Tapper core copied into the test
  (rules in template Phase 3), simulate 200 runs with random frame deltas (5–50 ms), random taps
  between frames and random seeds. For each, `replay(core, config, submission.inputs).score === submission.clientScore`
  and `ticks === submission.inputs.totalTicks`.
- `game-bridge` + `standalone-host` over `createLinkedTransports()`: full ready → start → end → result flow.
- `isGameManifest`: accepts the example manifest in ARCHITECTURE §5.2 and rejects bad ids, versions or missing fields.

### 0.5 Release
- Update the SDK `README.md` and `CLAUDE.md` (document new files and the client subpath).
- Commit `feat: v0.2.0 client helpers, manifest, verifySubmission`, then tag `v0.2.0` and push the tag:
  `git tag v0.2.0 && git push origin main --tags`.

**Acceptance:** `npm test` green in the SDK; in a scratch folder,
`npm i github:simba-io/arcadepro-game-sdk#v0.2.0` installs, and both `import { createRng } from "@arcadepro/game-sdk"`
and `import { RunDriver } from "@arcadepro/game-sdk/client"` resolve with types.

---

## Phase 1: housekeeping and tooling (this repo)

1. `npx eslint . --fix`. Fix the remaining `delta` error by deleting `src/Scene.ts`'s unused
   parameter (Scene.ts is replaced in Phase 5 anyway).
2. `package.json`:
   - `"name": "arcadepro-game-stub-tapper"`, `"version": "0.0.1"`, `"description": "ArcadePro game template (example: Stub Tapper)"`.
   - Remove `"start"`. Scripts (placeholders allowed until later phases implement them):
     ```json
     "dev": "vite",
     "lint": "eslint .",
     "typecheck": "tsc --noEmit",
     "test": "vitest run",
     "build": "npm run lint && npm run typecheck && vite build && node scripts/write-manifest.mjs",
     "build:core": "vite build --config vite.core.config.ts",
     "harness": "npm run build && vite --config vite.harness.config.ts",
     "release": "node scripts/release.mjs"
     ```
   - devDependencies: add `vitest`, `@types/node`.
   - `"engines": { "node": ">=20" }`. Add `.nvmrc` containing `20`.
3. `tsconfig.json`: include `["src", "test", "harness", "vite*.config.ts"]` (or split configs if
   needed). Keep `strict`. Add `"types": ["vite/client", "node"]` only where needed. Don't let Node
   types leak into `src/core` (the lint rules in Phase 3 guard this anyway).
4. `.gitignore`: add `dist-core`, `.env*` (but keep `!.env.example`).
5. Add `.env.example` (no real values):
   ```
   SUPABASE_URL=https://dvocvpbnquklcfbbbrfi.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=        # release only. NEVER commit a real value
   ARCADEPRO_SUPABASE_DIR=../arcadepro-supabase
   ```
6. Copy `docs/ARCHITECTURE.md` in if it isn't there already (it is committed alongside this plan).

**Acceptance:** `npm run lint` and `npm run typecheck` pass; `npx vite build` still succeeds; `npm test` runs (no tests yet is OK if vitest is configured with `passWithNoTests: true`).
**Commit:** `chore: fix lint/type errors, rename package, add tooling scripts`

---

## Phase 2: SDK dependency and game identity

1. `npm i github:simba-io/arcadepro-game-sdk#v0.2.0` (Cameron's GitHub credentials give access; it's a private repo).
2. Create `src/game.config.ts`:
   ```ts
   export const GAME = {
     id: "stub-tapper",
     version: "0.0.1",
     title: "Stub Tapper",
     orientation: "portrait",
     designWidth: 1920,
     designHeight: 3000,
     background: 0x1099bb,
   } as const;
   ```
3. `test/config.test.ts`: assert `pkg.version === GAME.version === coreModule.core.version`
   and `GAME.id === coreModule.core.gameId` (the core comes in Phase 3, so add the core assertions then).

**Acceptance:** import from both SDK entry points compiles; the config test passes.
**Commit:** `feat: add @arcadepro/game-sdk v0.2.0 and game.config`

---

## Phase 3: headless core (Stub Tapper) and purity lint

### 3.1 Rules: must match the deployed validator exactly
This is a copy of `arcadepro-supabase/supabase/functions/submit-run/cores/stub-tapper.ts`. **Do not change behaviour.**

`src/core/rules.ts`
```ts
import { createRng, type GameCore, type GameCoreModule } from "@arcadepro/game-sdk";

const TICK_RATE = 60;
const MAX_TICKS = TICK_RATE * 30;     // 30 seconds
const BONUS_TICKS = 20;

export interface StubTapperState {
  tick: number;
  score: number;
  bonus: ReadonlySet<number>;          // ticks on which a tap scores 2
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
```
`src/core/index.ts`
```ts
import type { GameCoreModule } from "@arcadepro/game-sdk";
import { core, plausibility, type StubTapperState } from "./rules";
export type { StubTapperState };
export const coreModule: GameCoreModule<StubTapperState> = { core, plausibility };
export default coreModule;
```
Use `GAME.id`/`GAME.version` only if importing `game.config.ts` doesn't pull in anything
non-pure. `game.config.ts` must stay a plain constant module. Otherwise keep the literals and
rely on the config test.

For **future games**, the rendering layer may need extra read-only info from state (e.g. "is
this a bonus tick?"). Expose it via pure helper functions in `src/core/` (e.g.
`isBonusTick(state)`), never by duplicating rules in the client.

### 3.2 Purity lint (append to `eslint.config.mjs`)
```js
{
  files: ["src/core/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      paths: [{ name: "@arcadepro/game-sdk/client", message: "Core must not use client helpers." }],
      patterns: [{ group: ["pixi.js", "pixi.js/*", "simple-sound-editor", "../client/*", "../dev/*", "node:*"],
                   message: "Core must be headless and deterministic (see docs/ARCHITECTURE.md §7)." }],
    }],
    "no-restricted-globals": ["error",
      "window", "document", "navigator", "performance", "Date", "fetch", "XMLHttpRequest",
      "localStorage", "sessionStorage", "setTimeout", "setInterval", "requestAnimationFrame", "crypto"],
    "no-restricted-properties": ["error",
      { object: "Math", property: "random", message: "Use createRng(config.seed)." },
      { object: "Math", property: "sin" }, { object: "Math", property: "cos" }, { object: "Math", property: "tan" },
      { object: "Math", property: "atan2" }, { object: "Math", property: "pow" }, { object: "Math", property: "exp" },
      { object: "Math", property: "log" }],
  },
}
```
Prove it works: temporarily add `Math.random()` to `rules.ts`, confirm lint fails, then remove it.

**Acceptance:** lint passes; the purity rules demonstrably fire; config test now checks the core identity.
**Commit:** `feat(core): Stub Tapper headless core + core purity lint rules`

---

## Phase 4: core tests

`test/core.golden.test.ts`: **these exact values are verified against the live server (2026-10-18).**
```ts
const config = { gameId: "stub-tapper", gameVersion: "0.0.1", seed: 4051550508, tickRate: 60 };
const every = (n: number, count: number) =>
  ({ totalTicks: 1800, events: Array.from({ length: count }, (_, i) => ({ t: i * n, a: "tap" })) });
// replay(core, config, every(12, 150)) → { ok: true, score: 153, ticks: 1800, ended: true }
// replay(core, config, every(10, 180)) → { ok: true, score: 183, ticks: 1800, ended: true }
// a log tapping on every tick 0..1799 → score 1820, and checkPlausibility flags ["input_rate_too_high"]
```
`test/core.determinism.test.ts`
- For 100 random seeds × random input logs, `replay` twice gives identical results.
- Different seeds give different bonus sets (at least 95 of 100 pairs differ).
- `init` doesn't mutate anything shared; `step` doesn't mutate its input state (deep-freeze state in the test).
- An unknown action is rejected (`malformed_inputs`), a log longer than `maxTicks` is rejected, and `t` out of order is rejected.

`test/verify.test.ts`: `verifySubmission` from the SDK with this core gives `verified` for an
honest submission, `flagged ["client_score_mismatch"]` for an inflated `clientScore`, and
`flagged ["time_drift"]` for `clientDurationMs: 8000` on a full 30 s run.

**Acceptance:** all green; the golden numbers exactly as above.
**Commit:** `test(core): golden, determinism and verification tests`

---

## Phase 5: client (rendering, loop, input, bridge) and standalone dev

### 5.1 `src/client/entry.ts`
```ts
import type { GameModule } from "@arcadepro/game-sdk";
import { App } from "./App";
export const mount: GameModule["mount"] = async (container, ctx) => {
  const app = new App(container, ctx);
  await app.init();
  return { destroy: () => app.destroy() };
};
export default { mount } satisfies GameModule;
```

### 5.2 `src/client/App.ts` responsibilities
- `new PIXI.Application()` + `await app.init({ resizeTo: container, background: GAME.background, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2) })`, then append `app.canvas` to `container`.
  Canvas style: `display:block; touch-action:none; user-select:none; -webkit-tap-highlight-color:transparent`.
- **Viewport** (`viewport.ts`): the existing letterbox maths from `main.ts`
  (`scale = min(w/DESIGN_W, h/DESIGN_H)`, centred), driven by a `ResizeObserver` on `container`
  (not `window`). The root `Container` holds all scenes in design coordinates (1920×3000).
- Assets: `await PIXI.Assets.load([ctx.assetBaseUrl + "assets/logo.svg", ...])`. No absolute paths.
- Transport: `ctx.transport ?? postMessageTransport(window.parent)`.
- `GameBridge` with `GAME.id`/`GAME.version`; `driver = new RunDriver(coreModule.core)`.
- After assets load: `bridge.ready()` and show `TitleScene` ("Waiting for platform…" in platform
  mode; in standalone mode the dev host shows a Start button, see 5.5).
- `bridge.onStart(session)`: if `session.config.gameId/gameVersion` differ from `GAME`, call
  `bridge.error("version_mismatch")` and stop. Otherwise `driver.start(session)` and show `PlayScene`.
- Ticker: `app.ticker.add((t) => { driver.advance(t.deltaMS); currentScene.render(driver.state); })`.
  Call `bridge.progress(runId, core.score(state))` at most 4×/s (the bridge throttles).
- `driver.onEnd(sub)`: `bridge.end(sub)` and show `ResultScene` in a "Verifying…" state.
- `bridge.onResult`: `ResultScene` shows verified score (+ "New personal best!"), or the flagged/rejected message.
- Pause: `bridge.onPause` → `driver.pause()` + mute audio; `bridge.onResume` → `driver.resume()`.
  Also `document.addEventListener("visibilitychange", …)` → pause when hidden; resume only if the host hasn't paused.
- `destroy()`: remove listeners, dispose the bridge, stop the ticker, `app.destroy(true, { children: true, texture: true })`.

### 5.3 `src/client/input.ts`
- `pointerdown` on the play area → `driver.recorder.record("tap")`. Only while the driver is
  running. Multiple pointers = multiple taps (multi-touch allowed).
- Keyboard `Space` → `"tap"` (desktop testing convenience; ignore auto-repeat with `e.repeat`).
- **Never** call core functions from input handlers. Input handlers only record.

### 5.4 Scenes (`src/client/scenes/`), each `extends PIXI.Container` with `render(state)`
- `TitleScene`: logo + title + status text.
- `PlayScene` (Stub Tapper): a large circular tap target in the centre, a score label
  (`core.score(state)`), a time bar (`1 - state.tick / core.maxTicks`), and a brief flash when the
  current tick is a bonus tick (read via a pure helper exported from `src/core`, e.g. `isBonusTick(state)`).
  A visual pulse on each tap is fine (purely cosmetic).
- `ResultScene`: final score, verdict text, and in standalone mode a "Play again" button that calls `host.startRun()`.
- Keep scenes generic in structure. Future games replace their contents.

### 5.5 `src/dev/standalone.ts` + `index.html`
- `index.html`: full-viewport `<div id="game-container">`, black background, loads `/src/dev/standalone.ts`. Title "Stub Tapper (dev)".
- `standalone.ts`: `[gameSide, hostSide] = createLinkedTransports()`;
  `host = new StandaloneHost({ coreModule, transport: hostSide, seed: Number(new URLSearchParams(location.search).get("seed")) || undefined, log: console.log })`;
  `await mount(container, { assetBaseUrl: new URL("./", location.href).href, mode: "standalone", transport: gameSide })`.
  Add a small DOM overlay (not Pixi) with **Start run**, the seed, and the last verdict JSON for debugging.
- Delete `src/main.ts` and `src/Scene.ts` (superseded) and the empty `public/style.css`.

### 5.6 `src/client/audio.ts`
`interface GameAudio { play(event: string): void; setMuted(m: boolean): void; }` with a no-op
implementation wired to `bridge.onMute` and pause. **Do not import `simple-sound-editor` yet.**

**Acceptance:**
- `npm run dev` → tap the target → after 30 s a verdict appears: `verified` with the replayed
  score equal to the on-screen score. Test on desktop and in Chrome DevTools mobile emulation.
- Switching tabs mid-run pauses; after resuming, the run still ends `verified` (no `time_drift` flag).
- Holding Space or auto-clicking > 20/s ends `flagged ["input_rate_too_high"]`.
- Seed via `?seed=4051550508` shows the same bonus flashes every time.
**Commit:** `feat(client): fixed-tick play loop, input recording, platform bridge, standalone dev host`

---

## Phase 6: build outputs (platform build, manifest, core bundle)

### 6.1 `vite.config.ts`
```ts
import { defineConfig } from "vite";
export default defineConfig(({ command }) => ({
  base: "./",
  server: { port: 8080, open: true },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: command === "build" ? {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    lib: { entry: "src/client/entry.ts", formats: ["es"], fileName: () => "game.js" },
    rollupOptions: {
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
    copyPublicDir: true,
  } : undefined,
}));
```
- Library mode does **not** emit `index.html` (correct: Storage can't serve HTML). `public/` is copied to `dist/` (so `public/assets/x.png` → `dist/assets/x.png`).
- Remove `public/favicon.png` from the build if it gets copied (move it out of `public/`, or delete it).

### 6.2 `scripts/write-manifest.mjs`
Reads `package.json` (version), `src/game.config.ts` values (simplest: also export the same values
from a `game.config.json` that `game.config.ts` imports, so Node can read it without TS), and the
installed SDK version (`node_modules/@arcadepro/game-sdk/package.json`). Writes
`dist/arcadepro.json` per ARCHITECTURE §5.2 and validates it with `isGameManifest`. Fails the
build on mismatch.

### 6.3 `vite.core.config.ts`
```ts
import { defineConfig } from "vite";
export default defineConfig({
  build: {
    outDir: "dist-core",
    emptyOutDir: true,
    target: "es2022",
    minify: false,             // readable for review; the validator vendors this file
    lib: { entry: "src/core/index.ts", formats: ["es"], fileName: () => "core.js" },
    rollupOptions: { external: [] },   // bundle the SDK in; output must have ZERO imports
  },
});
```

### 6.4 Build checks (`test/bundle.test.ts`, runs only if `dist/` and `dist-core/` exist; otherwise skipped)
- `dist/arcadepro.json` passes `isGameManifest`, its `gameVersion === package.json version`, and `entry` exists.
- `dist/` contains **no** `.html` files.
- No file in `dist/` references `"/assets/` (absolute asset paths).
- `dist-core/core.js` contains no `import ` / `require(` statements.
- `await import("../dist-core/core.js")` → its default export passes the **golden test values** from Phase 4.

**Acceptance:** `npm run build && npm run build:core && npm test` all green; `dist/` looks like
ARCHITECTURE §4.3; `dist-core/core.js` is a single readable file.
**Commit:** `build: library-mode platform build, manifest, headless core bundle`

---

## Phase 7: platform-mode harness (proves hosting option B)

The real game shell will live in `arcade-pro-client`. This harness contains a **reference copy** of
that shell so option B is proven before the platform exists. Keep it small and faithful to
ARCHITECTURE §5.1.

### 7.1 Files
- `harness/index.html` + `harness/platform.ts` (the **fake platform**, top-level page):
  - Creates `<iframe id="game" sandbox="allow-scripts" src="shell.html">` sized like a phone (e.g. 390×844, plus a "fill window" toggle).
    **No `allow-same-origin`.**
  - The manifest URL comes from `?manifest=` (default `http://localhost:8081/build/arcadepro.json`).
  - On iframe load: `iframe.contentWindow.postMessage({ type: "shell:load", manifestUrl, gameId, gameVersion }, "*")`.
  - Protocol via `postMessageTransport(iframe.contentWindow)`: on `ready`, enable a **Play** button →
    send `start` with a locally generated `RunSession` (like StandaloneHost); on `run:end`,
    compute the verdict with `verifySubmission` using the core imported from `../src/core` → send `run:result`.
  - **Pause/Resume** and **Mute** buttons send those messages. A log panel shows every message in both directions.
- `harness/shell.html` + `harness/shell.ts` (the **reference shell**):
  - Accepts `shell:load` only when `event.source === window.parent`.
  - `fetch(manifestUrl)` → `isGameManifest` → check `gameId`/`gameVersion` match → `import(new URL(manifest.entry, manifestUrl).href)`.
  - `module.default.mount(document.getElementById("root"), { assetBaseUrl: new URL("./", manifestUrl).href, mode: "platform" })`.
  - Any failure → `window.parent.postMessage({ type: "shell:error", message }, "*")` and display it.
- `vite.harness.config.ts`: root `harness/`, port 8081, serve the built `dist/` at `/build/`
  (e.g. a tiny middleware plugin or `server.fs.allow` + an alias). The served `.js` must have a JS
  MIME type and `access-control-allow-origin: *`, because the opaque-origin iframe needs CORS for module imports.

### 7.2 Local acceptance
- `npm run harness` → open http://localhost:8081 → Play → tap → `verified`. Pause/Resume and Mute work.
- The iframe really is sandboxed: from inside the game, `document.cookie` access throws or is
  empty and `localStorage` throws (log this once in a dev-only check, then remove it).
- Works in **Chrome and Safari** (Safari = WebKit, the engine the iOS app will use). If possible
  also test in the iOS Simulator's Safari.
**Commit:** `feat(harness): sandboxed platform harness with reference game shell`

### 7.3 Staging test against real Supabase Storage (needs Cameron)
This is the first time a build is loaded from Storage, so it verifies Content-Type and CORS.
1. Implement Phase 8's release script first, but **only** with `--prefix _staging`.
2. Cameron runs `npm run release -- --execute --prefix _staging` with the service-role key in `.env.local`.
3. Open `http://localhost:8081/?manifest=https://dvocvpbnquklcfbbbrfi.supabase.co/storage/v1/object/public/game-builds/_staging/stub-tapper/0.0.1/arcadepro.json`.
4. **Acceptance:** the game loads, plays and verifies. In DevTools → Network: `game.js` and the
   chunks return `200` with `content-type: text/javascript` and `access-control-allow-origin: *`.
5. **If it fails on CORS or MIME type, stop and report the exact response headers to Cameron.**
   Do not work around it with a different hosting design.
**Commit (if code changed):** `fix(release): …` / note the result in Progress.

---

## Phase 8: release script

`scripts/release.mjs` (Node ESM; add devDependency `@supabase/supabase-js` and `dotenv`).
- Reads `.env.local`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ARCADEPRO_SUPABASE_DIR`.
- Flags: `--execute` (default is a **dry run** that prints everything it would do), `--prefix <p>` (e.g. `_staging`).
- Steps:
  1. Refuse if `git status --porcelain` is not empty (unless `--prefix _staging`).
  2. Run `npm test`, `npm run build`, `npm run build:core` (stop on failure).
  3. Read `dist/arcadepro.json` and check `gameVersion === package.json version`.
  4. Target folder: `[prefix/]<gameId>/<version>/` in bucket `game-builds`.
     **Refuse if the folder already contains files**, because released versions are immutable
     (allowed under `_staging`: then delete and re-upload).
  5. Upload every file in `dist/` with an explicit `contentType` from this map (fail on unknown extensions):
     `.js .mjs → text/javascript`, `.json → application/json`, `.png → image/png`,
     `.jpg .jpeg → image/jpeg`, `.webp → image/webp`, `.svg → image/svg+xml`, `.mp3 → audio/mpeg`,
     `.ogg → audio/ogg`, `.wav → audio/wav`, `.woff2 → font/woff2`, `.ttf → font/ttf`,
     `.css → text/css`, `.txt .atlas .fnt → text/plain`.
     `cacheControl`: `"31536000"` for everything except `arcadepro.json`, which gets `"60"`.
  6. Without `--prefix`, copy `dist-core/core.js` →
     `${ARCADEPRO_SUPABASE_DIR}/supabase/functions/submit-run/cores/<gameId>@<version>.js`.
  7. Print the follow-up checklist: register the core in `cores/index.ts`, redeploy `submit-run`, and the
     SQL to insert the `game_versions` row (and the `games` row with `min_age`, if new):
     ```sql
     insert into public.game_versions (game_id, version, tick_rate, max_ticks, build_path, core_package)
     values ('<id>', '<ver>', <tickRate>, <maxTicks>, '<id>/<ver>/', 'vendored:submit-run/cores/<id>@<ver>.js');
     ```
- **The script never writes to the database.** DB changes stay deliberate (done by Cameron or via Claude chat with the Supabase connector).
- Never print the service-role key. Exit with an error if it's missing on `--execute`.

**Acceptance:** dry run prints a correct plan with no network writes; the staging run (Phase 7.3) succeeds.
**Commit:** `feat(release): build upload + core vendoring script (dry-run by default)`

---

## Phase 9: template polish

1. `README.md`: what the template is, quick start, commands, the "Create a new game from this
   template" checklist (copy it from CLAUDE.md), and how to release.
2. Cameron: GitHub → repo **Settings → General → Template repository** ✔.
3. Final full check from a fresh clone: `npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm run build:core`.

**Commit:** `docs: template README and new-game checklist`

---

## Phase 10 (later, not now): CI

GitHub Actions on tag `v*`: run the checks, build, upload (using the repo secret
`SUPABASE_SERVICE_ROLE_KEY`), and open a PR on `arcadepro-supabase` adding the core. Needs a
token that can read the private SDK repo and write to the backend repo. Plan with Cameron first.

---

## Progress

- [x] Phase 0: SDK v0.2.0. Deviations: determinism test ported to vitest (tsx dropped); `Transport` declared in root `manifest.ts` and re-exported from `/client`; `verifySubmission` takes an optional 4th arg `personalBest` (sets `isPersonalBest`); `RunDriver.pause()` also ignores inputs (`InputRecorder.suspend()`/`unsuspend()`, `RunDriver.paused`).
- [x] Phase 1: housekeeping and tooling. Deviations: one tsconfig with `"types": ["vite/client"]` (Node types installed but not listed, so they can't leak into `src/core`; add a Node-only config when scripts/configs need them); vitest settings (`passWithNoTests`) live in a separate `vitest.config.ts` so Phase 6 can rewrite `vite.config.ts` freely.
- [x] Phase 2: SDK dependency and game identity. Added `test/sdk.test.ts` to prove both SDK entry points resolve with types.
- [x] Phase 3: headless core and purity lint. Core keeps literal id/version (CLAUDE.md limits core imports to the SDK and `src/core`), guarded by the config test; dropped the spec's unused `GameCoreModule` import from `rules.ts` (fails `noUnusedLocals`). Purity rules proven with a probe file (11/11 violations caught) and `Math.random()` in `rules.ts`.
- [x] Phase 4: core tests. Golden values match exactly. `Object.freeze` can't protect a `Set`, so the step-purity test also snapshots `bonus` before/after each step.
- [x] Phase 5: client and standalone dev. Deviations: "Play again" (standalone only) fires a DOM `arcadepro:play-again` event on the container that the dev host answers with `startRun()` (the protocol has no "request a run" message); Space ignores auto-repeat per 5.3, so the >20/s flag was checked by auto-clicking, not by holding Space; tab-switch pause verified by simulating `visibilitychange` (the in-app test browser doesn't hide background tabs), still needs a real-browser check. Verified in-browser: honest runs `verified` with replayed = on-screen score, pause excludes hidden time (36.0 s run, no `time_drift`), auto-click flagged `input_rate_too_high`, `?seed=` gives identical bonus ticks, mobile 375×812 layout + bonus flash seen.
- [x] Phase 6: build outputs. Deviations: `vite.core.config.ts` adds `copyPublicDir: false` (otherwise `public/` lands in `dist-core/`); `background` in `game.config.json` is the string `"#1099bb"` (JSON has no hex literals); Node types moved to `tsconfig.node.json` (tests + build configs) so the bundle test can use `fs` while `src/` stays Node-free; `public/favicon.png` deleted. Note: ES library mode doesn't minify whitespace, so `chunks/entry-*.js` is ~711 KB (~179 KB gzip). Consider `build.minify` before launch.
- [ ] Phase 7: harness (7.2 local, 7.3 staging with Cameron). **7.1 + 7.2 done**; 7.3 pending (needs Phase 8's release script + Cameron). Verified in headless Chrome 155 over CDP (the in-app test browser blocks opaque-origin iframes with `ERR_BLOCKED_BY_CLIENT`): sandbox is opaque (`document.cookie`, `localStorage`, `sessionStorage`, `parent.document` all throw `SecurityError`; check logged then removed), Play → real mouse taps into the iframe → `verified`, Pause/Resume (5 s paused → 35.0 s run, no `time_drift`, taps while paused ignored) and Mute delivered, `?gameVersion=9.9.9` refused by the shell. Deviations: `server.cors` adds `"null"` to Vite's localhost default (the sandboxed shell's own module requests need it); the platform reuses the SDK's `StandaloneHost` over a logging `postMessageTransport` for start/verdicts. **Not yet tested in Safari/WebKit** (no Mac here): Cameron to run `npm run harness` in Safari / iOS Simulator.
- [x] Phase 8: release script. Dry runs only (no `.env.local` here, nothing uploaded); 7.3's `_staging` upload is Cameron's. Deviations: builds run before `npm test` so the bundle checks test exactly what gets uploaded; a dry run reports every blocker and still prints the full plan (exit 1 if `--execute` would refuse); `arcadepro.json` uploads last; under `_staging` every file gets `cacheControl "60"` (re-uploads reuse the same unhashed paths like `game.js`); the core is only copied if no different file already exists. Guards tested: missing URL/key on `--execute`, dirty tree, unknown args/prefix, unknown file type; the key is never printed. Note: `stub-tapper@0.0.1` is already registered (as `cores/stub-tapper.ts`) and in `game_versions`, so a production release of it would duplicate both; only release new versions.
- [x] Phase 9: template polish. README added; its new-game checklist corrects the CLAUDE.md one (identity now lives in `src/game.config.json`; golden values also live in `test/bundle.test.ts` and `test/verify.test.ts`), and CLAUDE.md now matches it. Platform references renamed to `arcade-pro-client`. Fresh-clone full check passed. **Cameron:** tick GitHub → Settings → General → **Template repository**.
