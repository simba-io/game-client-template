# ArcadePro game template

The starting point for **every ArcadePro game**. Create a game repo from it (GitHub
**Use this template**), replace the example's rules, scenes and assets, and release.

It gives each game, already wired up and tested:

- a **headless, deterministic core** (`src/core/`) that the browser plays and the `submit-run`
  server replays to compute the score itself, with ESLint rules that keep it pure;
- a **PixiJS 8 client** (`src/client/`) with a fixed-tick loop, input recording, pause/mute, and the
  SDK protocol to the platform;
- a **standalone dev host** (`npm run dev`) that verifies each run locally with the server's rules;
- a **platform harness** (`npm run harness`) that loads the real build in a sandboxed iframe, like
  the platform does;
- **build outputs** for Supabase Storage (`dist/`) and for the validator (`dist-core/core.js`), and a
  **release script**.

The built-in example is **Stub Tapper** (`stub-tapper@0.0.1`): tap as fast as you can for 30
seconds, and 20 seed-chosen ticks score double. It's registered in the live validator, so its
rules and golden scores must not change.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the whole system fits together, and
[`CLAUDE.md`](CLAUDE.md) for the rules every game must follow.

## Quick start

Needs Node 20+ and read access to the private `simba-io/arcadepro-game-sdk` repo (installed as a
git dependency, so your GitHub credentials must work for `git clone` over HTTPS).

```bash
npm install
npm run dev
```

Open http://localhost:8080, press **Start run** and tap. After 30 seconds the dev host replays the
run and shows the verdict. `?seed=4051550508` fixes the seed.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Standalone play with a fake platform and local verdicts, on :8080 |
| `npm run lint` | ESLint + Prettier, including the core purity rules |
| `npm run typecheck` | `tsc` for `src/` (browser types), then tests and build configs (Node types) |
| `npm test` | Vitest: golden, determinism, verification, config and build-output checks |
| `npm run build` | lint + typecheck + library build → `dist/` (`game.js`, `chunks/`, `assets/`, `arcadepro.json`) |
| `npm run build:core` | The headless core as one file with no imports → `dist-core/core.js` |
| `npm run harness` | Build, then serve the platform harness on :8081 (sandboxed iframe + reference shell) |
| `npm run release` | Release script, **dry run by default** (see [Releasing](#releasing)) |

## Layout

```
src/
  game.config.json   game identity: id, version, title, orientation, design size, background
  game.config.ts     typed GAME constant read from game.config.json
  core/              headless rules (GameCore). Runs in the browser AND on the server
  client/            Pixi app, scenes, input, audio, viewport; entry.ts exports mount()
  dev/standalone.ts  npm run dev host
test/                vitest
harness/             fake platform page + reference game shell
scripts/             write-manifest.mjs, release.mjs
```

## Create a new game from this template

1. GitHub → `simba-io/game-client-template` → **Use this template** → `simba-io/<game-id>-client`.
2. **Identity:** in `src/game.config.json` set `id` (slug `^[a-z0-9-]{2,40}$`), `title`,
   `version: "0.1.0"`, `orientation`, design size and `background`. Set `package.json`
   `name`/`version` to match, and the `<title>` in `index.html`.
3. **Rules:** replace `src/core/rules.ts`. Set the core's `gameId`/`version` to match
   `game.config.json` (`test/config.test.ts` checks this), and its `actions`, `tickRate`, `maxTicks` and
   `plausibility`. Follow the determinism rules in ARCHITECTURE §7: `npm run lint` enforces most of
   them. Anything the client needs to read from state goes in pure helpers in `src/core/`.
4. **Tests:** replace the golden values (a fixed seed + fixed inputs → a hard-coded score) in
   `test/core.golden.test.ts`, `test/bundle.test.ts` and `test/verify.test.ts`. Adapt
   `test/core.determinism.test.ts` to the new actions and game id.
5. **Client:** replace the scenes in `src/client/scenes/`, the actions recorded in
   `src/client/input.ts`, the asset list in `src/client/App.ts` and the files in `public/assets/`.
   Load assets only relative to `ctx.assetBaseUrl`, never from `/assets/...`.
6. **Check:** `npm test && npm run build && npm run build:core && npm run harness`, and play a run in
   the harness. Then release (below).

Any change to the rules later means a **new version**, with new golden values.

## Releasing

Releases are manual for now; ARCHITECTURE §8 has the full sequence. The release script does the
Storage upload and copies the core into the backend repo. It **never** touches the database.

1. Copy `.env.example` to `.env.local` and fill in `SUPABASE_SERVICE_ROLE_KEY` (never commit it).
   `ARCADEPRO_SUPABASE_DIR` defaults to `../arcadepro-supabase`.
2. Try the build from real Storage first, under `_staging`:
   ```bash
   npm run release -- --prefix _staging
   npm run release -- --execute --prefix _staging
   npm run harness
   ```
   Open the `?manifest=` URL the script prints and play a run.
3. Commit everything, then preview and run the real release:
   ```bash
   npm run release
   npm run release -- --execute
   ```
   This uploads `dist/` to `game-builds/<id>/<version>/` (it refuses if that folder already has
   files: released versions are immutable) and copies `dist-core/core.js` to
   `arcadepro-supabase/supabase/functions/submit-run/cores/<id>@<version>.js`.
4. Do the follow-up steps the script prints: register the core in `cores/index.ts`, redeploy
   `submit-run`, run the `game_versions` SQL (and add the `games` row with `min_age` for a new
   game), and point the next competition at the version.

Without `--execute` the script builds, tests and prints the whole plan, but uploads and copies
nothing.
