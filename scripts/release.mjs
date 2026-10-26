// npm run release [-- --execute] [-- --prefix _staging]
//
// Uploads dist/ to Supabase Storage (bucket game-builds) and vendors
// dist-core/core.js into the arcadepro-supabase repo (docs/ARCHITECTURE.md §8).
//
// - DRY RUN by default: builds and checks everything, then prints what it
//   would do. Nothing is uploaded or copied without --execute.
// - --prefix <p> uploads under <p>/<gameId>/<version>/ (e.g. _staging) and
//   skips core vendoring. Only _staging may replace an existing folder.
// - NEVER writes to the database: it prints the SQL for a human to run.
// - Reads .env.local: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ARCADEPRO_SUPABASE_DIR.
//   The service-role key is never printed.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config as loadEnv } from "dotenv";
import { isGameManifest, MANIFEST_FILENAME } from "@arcadepro/game-sdk";

const BUCKET = "game-builds";
const STAGING = "_staging";
const CONTENT_TYPES = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".css": "text/css",
  ".txt": "text/plain",
  ".atlas": "text/plain",
  ".fnt": "text/plain",
};

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const distCore = join(root, "dist-core");

// ---------- arguments and environment ----------
const args = process.argv.slice(2);
const execute = args.includes("--execute");
const prefixIndex = args.indexOf("--prefix");
const prefix = prefixIndex >= 0 ? args[prefixIndex + 1] : undefined;
const known = new Set(["--execute", "--prefix", prefix]);
const unknownArgs = args.filter((a) => !known.has(a));
if (unknownArgs.length) die(`unknown argument(s): ${unknownArgs.join(" ")}`);
if (prefixIndex >= 0 && (!prefix || !/^[A-Za-z0-9_-]+$/.test(prefix))) {
  die("--prefix needs a simple folder name, e.g. --prefix _staging");
}
const staging = prefix === STAGING;

loadEnv({ path: join(root, ".env.local"), quiet: true });
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const backendDir = resolve(
  root,
  process.env.ARCADEPRO_SUPABASE_DIR?.trim() || "../arcadepro-supabase",
);

const mode = execute ? "EXECUTE" : "DRY RUN";
section(`release (${mode}${prefix ? `, prefix ${prefix}` : ""})`);
if (execute) {
  if (!supabaseUrl) die("SUPABASE_URL is missing (set it in .env.local)");
  if (!serviceKey)
    die("SUPABASE_SERVICE_ROLE_KEY is missing (set it in .env.local)");
}
line(`supabase:  ${supabaseUrl ?? "(SUPABASE_URL not set)"}`);
line(
  `key:       ${serviceKey ? "service-role key loaded (hidden)" : "not set"}`,
);

// Problems that stop a release. A dry run collects them and reports at the
// end, so the whole plan is still visible; --execute stops at the first.
const blockers = [];
function block(message) {
  if (execute) die(message);
  blockers.push(message);
  line(`✗ WOULD REFUSE: ${message}`);
}

// ---------- 1. clean working tree ----------
section("1. git working tree");
const porcelain = run("git", ["status", "--porcelain"], {
  capture: true,
}).trimEnd();
if (!porcelain) line("clean");
else if (staging)
  line(`dirty, allowed under ${STAGING}:\n${indent(porcelain)}`);
else block(`working tree is not clean:\n${indent(porcelain)}`);

// ---------- 2. build and test ----------
// Build first, then test, so the bundle checks (test/bundle.test.ts) run
// against exactly the files that will be uploaded.
section("2. build + test");
for (const script of ["build", "build:core", "test"]) {
  line(`$ npm run ${script}`);
  run("npm", ["run", script]);
}

// ---------- 3. manifest and core ----------
section("3. manifest + core");
const pkg = readJson(join(root, "package.json"));
const manifest = readJson(join(dist, MANIFEST_FILENAME));
if (!isGameManifest(manifest))
  die(`dist/${MANIFEST_FILENAME} is not a valid GameManifest`);
if (manifest.gameVersion !== pkg.version) {
  die(
    `manifest gameVersion ${manifest.gameVersion} != package.json version ${pkg.version}`,
  );
}
const { core } = (await import(pathToFileURL(join(distCore, "core.js")).href))
  .default;
if (core.gameId !== manifest.gameId || core.version !== manifest.gameVersion) {
  die(
    `dist-core/core.js is ${core.gameId}@${core.version}, manifest is ${manifest.gameId}@${manifest.gameVersion}`,
  );
}
const { gameId, gameVersion } = manifest;
line(
  `${gameId}@${gameVersion}  tickRate=${core.tickRate}  maxTicks=${core.maxTicks}  sdk=${manifest.sdkVersion}`,
);

// ---------- 4. target folder ----------
const folder = `${prefix ? `${prefix}/` : ""}${gameId}/${gameVersion}`;
section(`4. target: ${BUCKET}/${folder}/`);
const storage = supabaseUrl && serviceKey ? await storageClient() : null;
let existing = [];
if (!storage) {
  line(
    "not checked: needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (listing is not public)",
  );
} else {
  existing = await listRecursive(storage, folder);
  if (!existing.length) line("empty");
  else if (staging)
    line(
      `${existing.length} existing file(s): will be DELETED and re-uploaded (${STAGING} only)`,
    );
  else
    block(
      `${BUCKET}/${folder}/ already has ${existing.length} file(s); released versions are immutable`,
    );
}

// ---------- 5. upload plan ----------
section("5. upload");
const files = walk(dist).map((path) => {
  const name = relative(dist, path).split(sep).join("/");
  const type = CONTENT_TYPES[extname(path).toLowerCase()];
  if (!type)
    die(
      `no Content-Type for "${name}" (extension "${extname(path)}"); add it to CONTENT_TYPES`,
    );
  // Released versions are immutable, so cache for a year; only the manifest
  // stays short. _staging is re-uploaded to the same paths, so keep it all short.
  const cacheControl =
    name === MANIFEST_FILENAME || staging ? "60" : "31536000";
  return { path, name, type, cacheControl, bytes: statSync(path).size };
});
// The manifest goes last, so a build is never discoverable before all of its files are there.
files.sort(
  (a, b) =>
    (a.name === MANIFEST_FILENAME) - (b.name === MANIFEST_FILENAME) ||
    a.name.localeCompare(b.name),
);
const width = Math.max(...files.map((f) => f.name.length));
for (const f of files) {
  line(
    `${f.name.padEnd(width)}  ${f.type.padEnd(16)}  cache ${f.cacheControl.padStart(8)}  ${kb(f.bytes)}`,
  );
}
line(`${files.length} files, ${kb(files.reduce((n, f) => n + f.bytes, 0))}`);

// ---------- 6. vendor the core ----------
section("6. vendor core");
const coreTarget = join(
  backendDir,
  "supabase",
  "functions",
  "submit-run",
  "cores",
  `${gameId}@${gameVersion}.js`,
);
if (prefix) {
  line(
    `skipped (--prefix ${prefix}: the validator only replays released versions)`,
  );
} else if (
  !existsSync(join(backendDir, "supabase", "functions", "submit-run"))
) {
  block(
    `ARCADEPRO_SUPABASE_DIR does not look like arcadepro-supabase: ${backendDir}`,
  );
} else if (
  existsSync(coreTarget) &&
  !sameFile(coreTarget, join(distCore, "core.js"))
) {
  block(
    `${coreTarget} already exists with different content; released cores are immutable`,
  );
} else {
  line(
    `dist-core/core.js → ${coreTarget}${existsSync(coreTarget) ? " (identical file already there)" : ""}`,
  );
}

// ---------- dry run stops here ----------
if (!execute) {
  printChecklist();
  section("dry run finished: nothing was uploaded or copied");
  if (blockers.length) {
    line(
      `--execute would REFUSE:\n${blockers.map((b) => indent(`- ${b}`)).join("\n")}`,
    );
    process.exit(1);
  }
  line(
    `run again with --execute to do it${prefix ? "" : " (production paths: double-check first)"}`,
  );
  process.exit(0);
}

// ---------- execute ----------
section("executing");
if (existing.length) {
  line(`deleting ${existing.length} file(s) in ${folder}/`);
  const { error } = await storage.remove(existing);
  if (error) die(`delete failed: ${error.message}`);
}
for (const f of files) {
  const { error } = await storage.upload(
    `${folder}/${f.name}`,
    readFileSync(f.path),
    {
      contentType: f.type,
      cacheControl: f.cacheControl,
      upsert: false,
    },
  );
  if (error) die(`upload ${f.name} failed: ${error.message}`);
  line(`uploaded ${f.name}`);
}
if (!prefix) {
  copyFileSync(join(distCore, "core.js"), coreTarget);
  line(`copied core → ${coreTarget}`);
}
const publicBase = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${folder}/`;
line(`manifest: ${publicBase}${MANIFEST_FILENAME}`);
printChecklist();

// ---------- helpers ----------
function printChecklist() {
  section("follow-up (by hand: this script never touches the database)");
  if (prefix) {
    line(
      `Test it in the harness (npm run harness):\n  http://localhost:8081/?manifest=${supabaseUrl ?? "<SUPABASE_URL>"}/storage/v1/object/public/${BUCKET}/${folder}/${MANIFEST_FILENAME}`,
    );
    return;
  }
  const ident = `core_${gameId.replace(/-/g, "_")}_${gameVersion.replace(/\./g, "_")}`;
  line(`1. arcadepro-supabase: register the core in supabase/functions/submit-run/cores/index.ts:
     import ${ident} from "./${gameId}@${gameVersion}.js";
     "${gameId}@${gameVersion}": ${ident},
2. Redeploy submit-run, and check every registered game's golden test still passes.
3. SQL (add the games row first if this is a new game; set min_age):
     insert into public.game_versions (game_id, version, tick_rate, max_ticks, build_path, core_package)
     values ('${gameId}', '${gameVersion}', ${core.tickRate}, ${core.maxTicks}, '${gameId}/${gameVersion}/', 'vendored:submit-run/cores/${gameId}@${gameVersion}.js');
4. Set games.current_version and point the next competition at ${gameVersion}.
5. Keep older cores registered until their competitions are settled.`);
}

async function storageClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  }).storage.from(BUCKET);
}

async function listRecursive(bucket, dir) {
  const { data, error } = await bucket.list(dir, { limit: 1000 });
  if (error) die(`listing ${BUCKET}/${dir}/ failed: ${error.message}`);
  const out = [];
  for (const entry of data) {
    const path = `${dir}/${entry.name}`;
    // Folders come back without an id.
    if (entry.id === null) out.push(...(await listRecursive(bucket, path)));
    else out.push(path);
  }
  return out;
}

function walk(dir) {
  if (!existsSync(dir)) die(`${dir} does not exist`);
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function run(command, commandArgs, { capture = false } = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    shell: process.platform === "win32",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0)
    die(`${command} ${commandArgs.join(" ")} failed (exit ${result.status})`);
  return result.stdout ?? "";
}

function readJson(path) {
  if (!existsSync(path)) die(`${relative(root, path)} not found`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function sameFile(a, b) {
  return readFileSync(a).equals(readFileSync(b));
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function indent(text) {
  return text.replace(/^/gm, "    ");
}

function section(title) {
  console.log(`\n== ${title}`);
}

function line(text) {
  console.log(text);
}

function die(message) {
  console.error(`\nrelease: ${message}`);
  process.exit(1);
}
