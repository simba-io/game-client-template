# CLAUDE.md: game-client-template

This repo is the **starting point for every ArcadePro game**. Each new game repo is created
from it (GitHub "Use this template"), so anything built here is inherited by every future game.
Build it carefully, generically and well tested.

**Read first:**
1. `docs/ARCHITECTURE.md`: the whole ArcadePro system (platform, Supabase, SDK, run lifecycle,
   determinism rules, hosting option B). Treat it as authoritative.
2. `ADAPTATION_PLAN.md`: the step-by-step work to turn this repo into the ArcadePro template.
   **Work through it one phase at a time, in order.** Each phase has acceptance criteria; meet
   them all, then commit, before starting the next.

---

## What this repo produces

| Output | Command | Goes to |
|---|---|---|
| Playable dev build (standalone, fake platform) | `npm run dev` | your browser at http://localhost:8080 |
| Platform build: ES module + assets + `arcadepro.json` | `npm run build` → `dist/` | Supabase Storage `game-builds/<gameId>/<version>/` |
| Headless core for the server validator | `npm run build:core` → `dist-core/core.js` | `arcadepro-supabase/supabase/functions/submit-run/cores/<gameId>@<version>.js` |
| Platform-mode test (sandboxed iframe + reference shell) | `npm run harness` | http://localhost:8081 |

The built-in example game is **Stub Tapper** (`stub-tapper@0.0.1`): tap as many times as you can
in 30 seconds. 20 seed-chosen ticks score double. It is already registered in Supabase and in
the `submit-run` validator, so **its rules must stay exactly as specified** in
`ADAPTATION_PLAN.md`, Phase 3. Its golden scores prove the template and the server agree.

---

## Stack

- TypeScript (strict), **PixiJS 8**, **Vite 6** (library mode for builds), ESLint 9 flat config + Prettier
- **Vitest** for tests (added in Phase 1)
- `@arcadepro/game-sdk`, installed as a private git dependency:
  `"@arcadepro/game-sdk": "github:simba-io/arcadepro-game-sdk#v0.2.0"`
  - root import `@arcadepro/game-sdk`: types, `createRng`, `replay`, `checkPlausibility`, protocol, manifest (DOM-free)
  - `@arcadepro/game-sdk/client`: `FixedStepLoop`, `InputRecorder`, `RunDriver`, `GameBridge`, transports, `StandaloneHost` (browser only)
- `simple-sound-editor` (Cameron's own package, `simba-io/simple-sound-editor`): early stage, no
  public playback API yet. **Do not import it into the build until Cameron says it is ready.**
  Audio goes through `src/client/audio.ts` (a small interface with a no-op implementation).
- Node 20+.

## Target folder layout (after the plan is done)

```
src/
  game.config.json      single source of game identity: id, version, title, orientation, design size
  game.config.ts        typed GAME constant read from game.config.json
  core/                 HEADLESS RULES. Implements GameCore. Runs in browser AND on the server.
    index.ts            default export: GameCoreModule { core, plausibility }
    rules.ts            the actual game logic
  client/               everything visual / interactive (browser only)
    entry.ts            exports mount(container, ctx), the GameModule the platform shell imports
    App.ts              owns PIXI.Application, RunDriver, GameBridge, scene switching
    viewport.ts         letterboxed design-resolution scaling, driven by the container size
    input.ts            pointer/keyboard → recorder.record(action)
    audio.ts            audio interface (no-op for now), respects host mute
    scenes/             TitleScene, PlayScene, ResultScene
  dev/
    standalone.ts       npm run dev: mounts the game with StandaloneHost (fake platform + local replay)
test/                   vitest: golden, determinism, driver≡replay, config consistency, bundle
harness/                platform-mode test: fake platform page + reference game shell
scripts/                write-manifest.mjs, release.mjs
docs/ARCHITECTURE.md
```

## Hard rules

### Core (`src/core/**`): enforced by ESLint, never disable these rules
- Import only from `@arcadepro/game-sdk` (root, **not** `/client`) and other files in `src/core/`.
- **No** `Math.random`, `Date`, `performance`, timers, `window`, `document`, `fetch`, storage, Pixi, audio.
- Randomness: `createRng(config.seed)` only. Time: tick count only (`1 tick = 1 / tickRate s`).
- Integer maths for anything that affects score or outcome. Avoid `Math.sin/cos/tan/atan2/pow/exp/log` there.
- `score()` returns a finite, non-negative integer.
- `step()` must be a pure function of `(state, inputsThisTick)`. Return new state (or mutate a
  state object that is never shared with rendering mid-step), and make no other side effects.
- Every action the client can record must be listed in `core.actions`.

### Versions
- `package.json` `version` === `GAME.version` (in `game.config.ts`) === `core.version` === the
  manifest's `gameVersion`. A test enforces this.
- **Any change to rules in `src/core/` = bump the version**, and the golden test values will
  change too. Never change the golden expected values without bumping the version.
- Released versions are immutable. Never re-upload a different build to an existing version folder.

### Client
- Load every asset relative to `ctx.assetBaseUrl` (e.g. `ctx.assetBaseUrl + "assets/logo.svg"`).
  **Never** use absolute `/assets/...` paths, and **never** `import` image/audio files in TS
  (Vite library mode would inline them as base64). Put assets in `public/assets/`.
- The game renders **from the core's state**; it never computes score or outcome itself.
- Record inputs on `pointerdown` (not click/tap) for responsiveness.
- When the host sends `pause`, or the page is hidden (`visibilitychange`), pause the loop.
  Paused time must **not** count towards `clientDurationMs`, because the server flags runs whose
  wall-clock time differs from simulated time by more than the game's `maxTimeDrift`.
- Talk to the platform only through `GameBridge` (SDK protocol). No other globals, no `window.top`,
  no native APIs (app-store rule, see ARCHITECTURE §5.4).
- Mobile first: portrait 1920×3000 design resolution, `touch-action: none` on the canvas,
  cap renderer resolution at 2× for performance.

### General
- Keep `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` green on every commit.
- Prettier style is the source of truth (`npx eslint . --fix`). Don't fight it.
- Small, focused commits with conventional messages (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).
- Never commit `.env*` files, `dist/`, `dist-core/` or Supabase service-role keys.

## Commands (after Phase 1)

```bash
npm install
npm run dev          # standalone play with fake platform + local replay verdicts
npm run lint         # eslint (includes core purity rules)
npm run typecheck    # tsc: src (browser types), then tests + build configs (tsconfig.node.json)
npm test             # vitest run
npm run build        # lint + typecheck + vite lib build + manifest → dist/
npm run build:core   # headless core bundle → dist-core/core.js
npm run harness      # build + serve the platform-mode harness on :8081
npm run release      # dry run: shows what would be uploaded/copied (see Phase 8)
```

## When to stop and ask Cameron

- Anything that would change Stub Tapper's rules or golden values.
- Anything that needs a change to the **SDK's** `run.ts`, `core.ts`, `rng.ts`, `replay.ts` or
  `protocol.ts` (these affect scoring and the deployed server).
- Loading from Supabase Storage fails because of CORS or Content-Type (Phase 7b).
- Anything involving the Supabase service-role key, uploading to the real `game-builds` paths
  (not `_staging`), or changing the database.
- Adding a new runtime dependency to the game bundle.

## Creating a new game from this template

Same checklist as `README.md` (keep the two in sync):

1. GitHub → `simba-io/game-client-template` → **Use this template** → `simba-io/<game-id>-client`.
2. `src/game.config.json`: set `id` (slug `^[a-z0-9-]{2,40}$`), `title`, `version: "0.1.0"`, orientation,
   design size, background. Set `package.json` `name`/`version` and the `index.html` `<title>` to match.
3. Replace `src/core/rules.ts`. Set the core's `gameId`/`version` to match `game.config.json` (the
   config test checks), and `core.actions`, `tickRate`, `maxTicks` and `plausibility`.
4. Replace the golden values (seed + inputs → expected score) in `test/core.golden.test.ts`,
   `test/bundle.test.ts` and `test/verify.test.ts`; adapt `test/core.determinism.test.ts`.
5. Replace the scenes (`src/client/scenes/`), recorded actions (`src/client/input.ts`), asset list
   (`src/client/App.ts`) and `public/assets/`.
6. `npm test && npm run build && npm run build:core && npm run harness`, then release (README, ARCHITECTURE §8).
