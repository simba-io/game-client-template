# ArcadePro: System Architecture

> **This file is the single source of truth for how ArcadePro fits together.**
> An identical copy lives at `docs/ARCHITECTURE.md` in every ArcadePro repo. If you change
> it in one repo, make the same change in the others (or flag it to Cameron).
>
> Last updated: 2026-10-25. Owner: Cameron McKay (GitHub org `simba-io`).

---

## 1. What ArcadePro is

ArcadePro is a **skill-based online arcade**, delivered as a **mobile app** (with web as a likely
second target). Players get **free entry**. Each game has a **weekly competition**, and the top
verified score each week wins a prize drop. Revenue comes from ads and brand sponsors, including
branded sponsor games.

Three properties drive almost every technical decision:

1. **Scores must be trustworthy.** Prizes are paid on them, so the server never trusts a score
   the client reports. It **replays the player's inputs** through the game's rules and computes
   the score itself.
2. **Every player faces identical conditions.** To stay a *game of skill* rather than a game of
   chance (UK Gambling Act), all randomness in a competition comes from **one seed per game per
   week**, shared by every player. There is never per-player luck.
3. **Games are many and change often.** New games and sponsor games must be added **without
   redeploying the platform app**, so game builds live outside the app and are loaded at runtime.

---

## 2. Repositories

| Repo | Visibility | What it is | Status |
|---|---|---|---|
| `simba-io/arcadepro-game-sdk` | private | `@arcadepro/game-sdk`: the contract between platform, games and server (types, seeded RNG, replay, message protocol) | v0.1.0 tagged |
| `simba-io/arcadepro-supabase` | private | Supabase backend: database migrations and the `submit-run` edge function | `submit-run` v1 deployed |
| `simba-io/game-client-template` | public | Starting point for **every** ArcadePro game: PixiJS + Vite, wired to the SDK, Stub Tapper as the built-in example | Being adapted (see its `ADAPTATION_PLAN.md`) |
| `simba-io/arcade-pro` | not created yet | The platform app: auth, dashboard, game menu, leaderboards, and the **game shell** that hosts games | Not started |
| `simba-io/<game>-client` | per game | One repo per game, created from `game-client-template` | e.g. `memory-match-client` (pre-ArcadePro, not adapted) |

**Rule:** game code never lives in `arcade-pro`, and platform code never lives in a game repo.
They meet only through the SDK contract.

---

## 3. The big picture

```
┌──────────────────────── Mobile app (arcade-pro) ─────────────────────────┐
│  React UI: login · dashboard · game menu · leaderboards · results        │
│                                                                           │
│  ┌──── <iframe sandbox="allow-scripts" src="game-shell.html"> ────────┐   │
│  │  Game shell (bundled in the app, owned by arcade-pro)               │   │
│  │   1. fetch  <build>/arcadepro.json   (GameManifest)                 │   │
│  │   2. import <build>/game.js          (ES module from Storage)       │   │
│  │   3. game.mount(container, { assetBaseUrl, mode: "platform" })      │   │
│  │  Game (from the game repo) talks to the app ONLY via postMessage    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└──────────────┬─────────────────────────────────────────┬─────────────────┘
               │ supabase-js (player's session)          │ HTTPS GET (public)
               ▼                                         ▼
┌─────────────────────────── Supabase: platform-data ───────────────────────┐
│  Auth (email/password)        Storage bucket: game-builds (public read)    │
│  Postgres + RLS               Edge function: submit-run (replays runs)     │
│  RPC: start_run               SQL: record_run_result (service role only)   │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Supabase project

| Item | Value |
|---|---|
| Organisation | **Arcade Pro** (free plan) |
| Project | **platform-data** |
| Project ref / ID | `dvocvpbnquklcfbbbrfi` |
| Region | `eu-west-1` (Ireland) |
| API URL | `https://dvocvpbnquklcfbbbrfi.supabase.co` |
| Public build URL base | `https://dvocvpbnquklcfbbbrfi.supabase.co/storage/v1/object/public/game-builds/` |
| Keys | Publishable/anon key: client-safe, read from env. **Service role key: server/CI only, never commit it, never ship it in a client.** |

Free-plan limits to remember: leaked-password protection is unavailable, the built-in email
sender is for testing only (a custom SMTP provider is needed before launch), and the 50 MB file
size limit is set on the `game-builds` bucket.

### 4.1 Database (schema `public`)

| Table / view | Purpose | Client access (RLS) |
|---|---|---|
| `profiles` | One row per auth user: `display_name` (`^[A-Za-z0-9_]{3,20}$`, unique). Auto-created by the `on_auth_user_created` trigger from `raw_user_meta_data.display_name`, falling back to `player_<10 hex>` | Read: everyone. Update: own row, `display_name` column only |
| `games` | `id` (slug `^[a-z0-9-]{2,40}$`), `title`, `description`, `thumbnail_path`, `status` (`draft`/`live`/`retired`), `current_version`, `min_age` | Read: `live` games only |
| `game_versions` | PK (`game_id`, `version` semver). `tick_rate`, `max_ticks`, `build_path` (always `"<game_id>/<version>/"`), `core_package`, `status` (`active`/`deprecated`) | Read: active versions of live games |
| `competitions` | One per game per week. `game_version` and `seed` (uint32) are **fixed for the whole competition**. `starts_at`, `ends_at`, `status`, `prize_description`, `prize_value_pence`. A GiST exclusion constraint stops two competitions for the same game overlapping | Read: all columns **except `seed`** (column grants) |
| `runs` | One row per play: `issued` → `verified` / `flagged` / `rejected` / `expired`. Stores `token_hash` (sha256), `inputs` (InputLog JSON), `client_score`, `verified_score`, reasons | Read: own runs, limited columns. No writes |
| `competition_entries` | Each player's best **verified** score per competition (`best_score`, `best_run_id`, `achieved_at`, `runs_played`) | Read: everyone. No writes |
| `leaderboard` (view, security_invoker) | `rank()` per competition, ordered by `best_score desc, achieved_at asc` (ties go to whoever got there first), joined to `display_name` | Read: everyone |

**Clients never write** to games, versions, competitions, runs or entries. Everything goes
through `start_run` (RPC) and `submit-run` (edge function).

### 4.2 Server functions

| Function | Who can call | What it does |
|---|---|---|
| `public.start_run(p_game_id text) → jsonb` | `authenticated` | Finds the open competition for the game, expires the player's previous `issued` run for it (one live run per player), creates a run with a 32-byte random token (only its sha256 is stored), and returns a **`RunSession`**. `expiresAt` = now + `max_ticks / tick_rate` seconds + 10 min. Raises `competition_closed`, `profile_missing` or `not_authenticated` |
| `submit-run` edge function (`verify_jwt = true`) | signed-in player | See §6. Returns a **`RunVerdict`** |
| `public.record_run_result(...)` | `service_role` only | Locks the run row (`for update`), refuses anything not `issued`, writes the verdict, and upserts `competition_entries` in the same transaction. Returns the verdict JSON |
| `handle_new_user()` trigger | n/a (not callable via API) | Creates the profile on sign-up |

### 4.3 Storage

Bucket **`game-builds`**: public read, uploads by the service role only (no client policies).

```
game-builds/
  <game_id>/<version>/        ← game_versions.build_path
    arcadepro.json            ← GameManifest (see §5.2)
    game.js                   ← ES module entry, exports mount()
    chunks/*.js               ← code-split chunks (Pixi renderers etc.)
    assets/...                ← images, audio, fonts (from the game's public/ folder)
  <game_id>/thumbnail.png     ← games.thumbnail_path
```

**Important:** Supabase Storage serves `.html` as `text/plain` for security, so **builds never
contain an HTML page**. Every file must be uploaded with the correct `Content-Type`
(`.js` → `text/javascript`, `.json` → `application/json`, `.png` → `image/png`, etc.),
otherwise browsers refuse to run module scripts.

---

## 5. How a game is loaded (hosting option B, chosen 2026-10-25)

The platform owns one small **game shell** page that is **bundled inside the app**. Each game
build is just an ES module plus assets in Storage. This was chosen over a separate static host
because the platform is a mobile app: one shell inside the app, games fetched at runtime, and no
extra hosting service.

### 5.1 Load sequence

1. The player taps a game. The platform reads `games` + `game_versions` (via RLS) and calls
   `start_run(game_id)`, getting back a `RunSession`.
2. The platform creates `<iframe sandbox="allow-scripts" src="game-shell.html">`.
   **Do not add `allow-same-origin`.** The iframe then gets an opaque origin, so the game can
   never read the app's storage, cookies or Supabase session.
3. The platform posts a shell-internal `shell:load` message with the manifest URL
   (`<public build URL base><build_path>arcadepro.json`) and the expected `gameId` + `gameVersion`.
4. The shell fetches the manifest, checks that `gameId`/`gameVersion` match what the competition
   expects (refusing to run on a mismatch), then does `await import(<build_path>/<manifest.entry>)`.
5. The shell calls `module.mount(container, { assetBaseUrl, mode: "platform" })`. The game must load
   every asset relative to `assetBaseUrl`, never from absolute `/` paths.
6. From here the **SDK protocol** (§5.3) applies: the game posts `ready`, the platform answers
   with `start` (the `RunSession`), and so on.

### 5.2 `arcadepro.json` (GameManifest), written by every game build

```json
{
  "manifestVersion": 1,
  "gameId": "stub-tapper",
  "gameVersion": "0.0.1",
  "sdkVersion": "0.2.0",
  "entry": "game.js",
  "orientation": "portrait",
  "designWidth": 1920,
  "designHeight": 3000,
  "builtAt": "2026-10-25T12:00:00Z"
}
```
The TypeScript type `GameManifest` and the module interface `GameModule` belong in the SDK
(`src/manifest.ts`, added in SDK v0.2.0; see the template's `ADAPTATION_PLAN.md`, Phase 0).

### 5.3 Platform ↔ game message protocol (SDK `protocol.ts`, `PROTOCOL_VERSION = 1`)

Every message is `{ source: "arcadepro", v: 1, type, payload? }`. The receiver ignores anything
failing `isProtocolMessage()`, and the game only accepts messages whose `event.source === window.parent`.

| Direction | `type` | Payload | When |
|---|---|---|---|
| game → host | `ready` | `{ gameId, gameVersion }` | After mount, once assets are loaded |
| host → game | `start` | `RunSession` | The player presses play |
| game → host | `run:progress` | `{ runId, score }` | Optional, throttled (≤ 4/s) live score |
| game → host | `run:end` | `RunSubmission` | The core reports `isOver` |
| host → game | `run:result` | `{ runId, verdict: RunVerdict }` | After `submit-run` answers |
| host → game | `pause` / `resume` | n/a | App backgrounded, menu opened |
| host → game | `mute` | `{ muted }` | Sound toggle |
| game → host | `error` | `{ message, runId? }` | Unrecoverable game error |

The game posts with `window.parent.postMessage(msg, "*")` (the parent cannot be targeted by
origin from an opaque-origin frame). Messages contain no secrets except `runToken`, which is
single-use and bound to the player.

### 5.4 Mobile / app-store constraints (Apple guideline 4.7, tightened Nov 2025)

- Games must run on the system **WebKit / JavaScriptCore** only: no custom JS engines, and **no
  native API bridges exposed to games** (camera, push, files, location...) without Apple approval.
  Games only get the `postMessage` protocol above.
- The app must be able to produce an **index of hosted games** (name, description, developer,
  version, age rating). `games` + `game_versions` hold this data.
- **Age gating:** each game has `games.min_age`. The platform must hide or gate games above the
  player's age.
- Each mini game's data collection must be disclosed. ArcadePro games collect only inputs and scores.
- Prize competitions in app stores have their own rules (Apple 5.3, Google Play real-money and
  contest policies). **Check these before submitting the app.** This is an open item (§10).

---

## 6. Run lifecycle (anti-cheat)

```
platform            Supabase                 game (in shell)
   │ start_run(gameId) ─►│ creates run, token     │
   │◄──── RunSession ─────│                         │
   │──────────── start(RunSession) ───────────────► │ core.init(config)
   │                      │                         │ fixed-tick loop, record inputs
   │◄─────────────────── run:end(RunSubmission) ─── │
   │ POST submit-run ────►│ 1 auth: JWT → user      │
   │  {runToken,          │ 2 load run (service)    │
   │   submission}        │ 3 token sha256 match?   │
   │                      │ 4 not expired, version? │
   │                      │ 5 replay(core, SERVER   │
   │                      │   config, inputs)       │
   │                      │ 6 plausibility checks   │
   │                      │ 7 record_run_result     │
   │◄──── RunVerdict ─────│                         │
   │──────────── run:result(verdict) ─────────────► │ show result
```

**Verdict rules (`submit-run/validate.ts`):**
- Run missing, owned by someone else, or token wrong → `rejected: unknown_run`, **not recorded**
  (an attacker cannot use up somebody else's run).
- Run `expired` (superseded by a newer `start_run`) → `rejected: run_expired`, not recorded.
- Run not `issued` → `rejected: run_already_submitted`, not recorded.
- Past `expires_at` → recorded `rejected: run_expired`.
- `gameId`/`gameVersion` differ from the run's → recorded `rejected: version_mismatch`.
- No core registered for `gameId@version` → recorded `rejected: replay_failed`.
- Replay errors → recorded `rejected: malformed_inputs | replay_failed`.
- Plausibility failures (`score_above_max`, `input_rate_too_high`, `time_drift`) or
  `clientScore ≠ replayed score` (`client_score_mismatch`) → recorded **`flagged`**: held for
  manual review and **not on the leaderboard**.
- Otherwise → **`verified`**, and `competition_entries` is updated if the score is a new best.

**The seed, tick rate and version always come from the server's copy of the run, never from
the client.**

---

## 7. Determinism rules (every game core)

A game's rules live in a **headless core** implementing `GameCore` from the SDK:
`init(config) → state`, `step(state, inputsThisTick) → state`, `isOver(state)`, `score(state)`.
The browser and the server run the **same core**, so they must agree bit-for-bit.

1. **No `Math.random()`.** Use `createRng(config.seed)` from the SDK (mulberry32). Store the RNG
   in state if you need it after `init`.
2. **No wall-clock time** (`Date`, `performance.now()`, `setTimeout`). Time = tick count.
   One `step()` = exactly `1 / tickRate` seconds.
3. **No DOM, Pixi, audio, network, storage or `window`** in core code.
4. **Integer or fixed-point maths for anything that affects score or game outcome.** Floats are
   only safe if every operation is identical on both sides. Avoid `Math.sin`/`cos`/`pow`/`exp`
   in outcome-affecting code; their results can differ between JS engines.
5. **Deterministic iteration:** arrays, or `Map`/`Set` in insertion order. Never sort with a
   comparator that can return inconsistent results.
6. **Score is a finite, non-negative integer.**
7. **Inputs are the only external influence.** An input is `{ t: tick, a: action, v?: number }`.
   `t` is the tick the input applies to. Events are in non-decreasing `t` order, and every `a`
   is listed in `core.actions`.
8. **Randomness only varies conditions shared by everyone** (layout, spawn pattern from the
   weekly seed). It never rewards one player over another.
9. **Every game ships a golden test:** a fixed seed plus fixed inputs give a hard-coded score.
   If that test changes, the rules changed, so bump the game version.

---

## 8. Versioning and releasing

- **SDK:** semver with git tags (`vX.Y.Z`). Any change to `replay`, `rng`, run types or the
  protocol can change scores or break games, so treat it as breaking. Consumers pin an exact tag.
  The backend **vendors** a copy of `run.ts`, `core.ts`, `rng.ts` and `replay.ts` into
  `submit-run/sdk/`, converted to Deno `.ts` imports. Keep them in sync.
- **Games:** semver per game (`package.json` `version` = `gameVersion` = `game_versions.version`).
  **Any change to core rules = new version.** A competition pins one version for its whole week.
- **Release a game version (currently manual, CI planned):**
  1. Run the game's `npm test` (golden + determinism tests).
  2. `npm run build` → `dist/` (manifest, `game.js`, chunks, assets).
  3. `npm run build:core` → `dist-core/core.js` (self-contained ESM with the SDK bundled in).
  4. Upload `dist/` to `game-builds/<game_id>/<version>/` with correct content types.
  5. Copy `dist-core/core.js` to `arcadepro-supabase/supabase/functions/submit-run/cores/<game_id>@<version>.js`,
     register it in `cores/index.ts`, and redeploy `submit-run`.
  6. Insert the `game_versions` row (and the `games` row for a new game; set `current_version`).
  7. Point the next competition at the new version.
  8. Keep old cores registered until every competition that used them is `settled`.

---

## 9. Decisions log

| Date | Decision |
|---|---|
| 2026-10-18 | Build order: SDK contract → Supabase backend → platform; game builds live outside the platform repo |
| 2026-10-18 | Server replays inputs; client score is informational only |
| 2026-10-18 | One seed and one game version per game per weekly competition |
| 2026-10-18 | Supabase project `platform-data` (Ireland) in the Arcade Pro org |
| 2026-10-18 | Edge functions can't import a core chosen at runtime, so cores are vendored into `submit-run` and redeployed per release |
| 2026-10-25 | Use `game-client-template` (not memory-match) as the base for all games; Stub Tapper is its built-in example |
| 2026-10-25 | Hosting **option B**: a game shell bundled in the app loads ES-module builds from Storage |
| 2026-10-25 | Leaked-password protection skipped (needs a paid plan) |

---

## 10. Open items

- **SDK distribution:** currently a private git dependency
  (`github:simba-io/arcadepro-game-sdk#vX.Y.Z`, which needs the SDK's `prepare` script; see the
  template plan, Phase 0). CI will need a GitHub token with read access. Revisit public npm later.
- **Platform app technology:** React + PixiJS confirmed. The mobile wrapper (e.g. Capacitor vs
  React Native + WebView) is **not decided yet**. The shell + iframe design works with both.
- **Custom SMTP** for auth emails (Resend / Postmark / SendGrid) and auth Site URL / redirect URLs.
- **Competition scheduling:** a weekly job to create, open, close and settle competitions (pg_cron).
- **Flagged-run review tool** and winner selection.
- **Payouts:** Stripe (test mode first), age and identity checks before paying a prize, and
  confirmation from Stripe that skill-competition cash prizes are allowed.
- **Legal:** solicitor review of skill-game status, free-entry route, and app-store contest rules.
- **Stub Tapper** stays as the template example and test fixture. Retire its competition once a
  real game is live.
