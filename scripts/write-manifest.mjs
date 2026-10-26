// Writes dist/arcadepro.json (GameManifest, docs/ARCHITECTURE.md §5.2) after
// `vite build`, validates it with the SDK's isGameManifest, and fails the
// build on any mismatch.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isGameManifest, MANIFEST_FILENAME } from "@arcadepro/game-sdk";

const root = fileURLToPath(new URL("..", import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(root + path, "utf8"));

const pkg = readJson("package.json");
const game = readJson("src/game.config.json");
const sdk = readJson("node_modules/@arcadepro/game-sdk/package.json");
const entry = "game.js";

const fail = (message) => {
  console.error(`write-manifest: ${message}`);
  process.exit(1);
};

if (game.version !== pkg.version) {
  fail(`game.config.json version ${game.version} != package.json version ${pkg.version}`);
}
if (!existsSync(root + "dist/" + entry)) fail(`dist/${entry} not found; run vite build first`);

const manifest = {
  manifestVersion: 1,
  gameId: game.id,
  gameVersion: game.version,
  sdkVersion: sdk.version,
  entry,
  orientation: game.orientation,
  designWidth: game.designWidth,
  designHeight: game.designHeight,
  builtAt: new Date().toISOString(),
};
if (!isGameManifest(manifest)) fail(`invalid manifest: ${JSON.stringify(manifest)}`);

writeFileSync(root + "dist/" + MANIFEST_FILENAME, JSON.stringify(manifest, null, 2) + "\n");
console.log(`write-manifest: dist/${MANIFEST_FILENAME} → ${manifest.gameId}@${manifest.gameVersion} (sdk ${manifest.sdkVersion})`);
