// npm run dev: mounts the game with StandaloneHost (a fake platform that
// replays each run locally and answers with the same verdicts as submit-run).
// Not part of the platform build.
import {
  StandaloneHost,
  createLinkedTransports,
} from "@arcadepro/game-sdk/client";
import coreModule from "../core";
import { PLAY_AGAIN_EVENT } from "../client/App";
import { mount } from "../client/entry";

const container = document.getElementById("game-container")!;
const [gameSide, hostSide] = createLinkedTransports();
const host = new StandaloneHost({
  coreModule,
  transport: hostSide,
  seed: Number(new URLSearchParams(location.search).get("seed")) || undefined,
  log: console.log,
});

// Debug overlay (plain DOM, not Pixi): Start run, the seed, the last verdict.
const overlay = document.createElement("div");
overlay.id = "dev-overlay";
overlay.innerHTML = `
  <button id="dev-start" disabled>Start run</button>
  <span>seed: <b id="dev-seed">–</b></span>
  <pre id="dev-verdict"></pre>`;
document.body.appendChild(overlay);
const startButton = overlay.querySelector<HTMLButtonElement>("#dev-start")!;
const seedLabel = overlay.querySelector<HTMLElement>("#dev-seed")!;
const verdictLabel = overlay.querySelector<HTMLElement>("#dev-verdict")!;

const startRun = (): void => {
  startButton.disabled = true;
  verdictLabel.textContent = "";
  seedLabel.textContent = String(host.startRun().config.seed);
};
startButton.addEventListener("click", startRun);
container.addEventListener(PLAY_AGAIN_EVENT, startRun);

// Watch both directions: "ready" goes game → host, "run:result" host → game.
hostSide.subscribe((msg) => {
  if (msg.type === "ready") startButton.disabled = false;
});
gameSide.subscribe((msg) => {
  if (msg.type !== "run:result") return;
  verdictLabel.textContent = JSON.stringify(msg.payload.verdict, null, 2);
  startButton.disabled = false;
});

mount(container, {
  assetBaseUrl: new URL("./", location.href).href,
  mode: "standalone",
  transport: gameSide,
}).catch((err: unknown) => {
  console.error(err);
  verdictLabel.textContent = `mount failed: ${String(err)}`;
});
