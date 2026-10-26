import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultAllowedOrigins, defineConfig, type Plugin } from "vite";

// `npm run harness`: the platform-mode harness on :8081 (docs/ARCHITECTURE.md
// §5.1). harness/index.html is the fake platform; harness/shell.html is a
// reference copy of the game shell, loaded in a sandboxed iframe.
const harnessDir = fileURLToPath(new URL("./harness", import.meta.url));
const distDir = fileURLToPath(new URL("./dist", import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
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
};

/**
 * Serves the built dist/ at /build/ exactly as Storage would: the real files
 * (not transformed by Vite), an explicit Content-Type, and
 * access-control-allow-origin: * because the sandboxed (opaque-origin) shell
 * needs CORS for module imports, fetch() and asset loads.
 */
function serveBuild(): Plugin {
  return {
    name: "arcadepro-serve-build",
    configureServer(server) {
      server.middlewares.use("/build", (req, res) => {
        const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
        const file = normalize(join(distDir, path));
        const inside = file.startsWith(distDir + sep);
        res.setHeader("access-control-allow-origin", "*");
        res.setHeader("cache-control", "no-store");
        if (!inside || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end(`not found in dist/: ${path}`);
          return;
        }
        res.setHeader(
          "content-type",
          CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
        );
        res.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  root: harnessDir,
  plugins: [serveBuild()],
  server: {
    port: 8081,
    strictPort: true,
    open: true,
    // The shell iframe has an opaque origin, so its own module requests
    // arrive with "Origin: null". Allow that on top of Vite's localhost default.
    cors: { origin: [defaultAllowedOrigins, "null"] },
  },
});
