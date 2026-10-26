// Reference copy of the platform's game shell (docs/ARCHITECTURE.md §5.1).
// The real one lives in arcade-pro-client (built self-contained, with its script
// inlined and a strict CSP: ARCHITECTURE §5.5). Runs inside <iframe sandbox="allow-scripts">,
// so it has an opaque origin and can't touch the app's storage or session.
//
//   parent → shell  { type: "shell:load", manifestUrl, gameId, gameVersion }
//   shell → parent  { type: "shell:error", message }   (on any failure)
//
// After mount() the game talks to the parent directly with the SDK protocol.
import { isGameManifest, type GameModule } from "@arcadepro/game-sdk";

interface ShellLoad {
  type: "shell:load";
  manifestUrl: string;
  gameId: string;
  gameVersion: string;
}

const isShellLoad = (x: unknown): x is ShellLoad => {
  const m = x as ShellLoad;
  return (
    !!m &&
    m.type === "shell:load" &&
    typeof m.manifestUrl === "string" &&
    typeof m.gameId === "string" &&
    typeof m.gameVersion === "string"
  );
};

// Make CSP violations visible: some are caught by libraries and never reach
// the console on their own (e.g. Pixi's eval probe).
document.addEventListener("securitypolicyviolation", (e) => {
  console.warn(
    `[csp] blocked ${e.effectiveDirective}: ${e.blockedURI || "(inline/eval)"} at ${e.sourceFile}:${e.lineNumber}`,
  );
});

let loading = false;

window.addEventListener("message", (event) => {
  if (event.source !== window.parent || !isShellLoad(event.data)) return;
  if (loading) return; // one game per shell
  loading = true;
  load(event.data).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    document.getElementById("shell-error")!.textContent = message;
    window.parent.postMessage({ type: "shell:error", message }, "*");
  });
});

async function load(req: ShellLoad): Promise<void> {
  const res = await fetch(req.manifestUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
  const manifest: unknown = await res.json();
  if (!isGameManifest(manifest)) throw new Error("manifest: invalid");
  if (
    manifest.gameId !== req.gameId ||
    manifest.gameVersion !== req.gameVersion
  ) {
    throw new Error(
      `manifest is ${manifest.gameId}@${manifest.gameVersion}, ` +
        `competition expects ${req.gameId}@${req.gameVersion}`,
    );
  }

  const entryUrl = new URL(manifest.entry, req.manifestUrl).href;
  const module = (await import(/* @vite-ignore */ entryUrl)) as {
    default?: GameModule;
  };
  if (typeof module.default?.mount !== "function") {
    throw new Error(`${manifest.entry}: no default export with mount()`);
  }
  await module.default.mount(document.getElementById("root")!, {
    assetBaseUrl: new URL("./", req.manifestUrl).href,
    mode: "platform",
  });
}
