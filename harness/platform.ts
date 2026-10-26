// Fake platform for the harness (the real one is arcade-pro-client). Hosts the
// reference shell in <iframe sandbox="allow-scripts"> — no allow-same-origin —
// and plays the platform side of the SDK protocol over real postMessage.
// Runs are issued and judged locally by the SDK's StandaloneHost, i.e. with
// verifySubmission() and the core from ../src/core.
//
// Query params: ?manifest=<url of arcadepro.json> (default: this server's
// /build/arcadepro.json), ?seed=<uint32>, ?gameVersion=<x.y.z> (to test the
// shell's version-mismatch refusal).
import {
  message,
  type ProtocolMessage,
  type Transport,
} from "@arcadepro/game-sdk";
import {
  StandaloneHost,
  postMessageTransport,
} from "@arcadepro/game-sdk/client";
import coreModule from "../src/core";

type Of<T extends ProtocolMessage["type"]> = Extract<
  ProtocolMessage,
  { type: T }
>;

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const frame = $<HTMLIFrameElement>("game");
const status = $("status");
const logEl = $("log");
const playButton = $<HTMLButtonElement>("play");
const muteButton = $<HTMLButtonElement>("mute");

const params = new URLSearchParams(location.search);
const manifestUrl = new URL(
  params.get("manifest") ?? "/build/arcadepro.json",
  location.href,
).href;
const gameId = coreModule.core.gameId;
const gameVersion = params.get("gameVersion") ?? coreModule.core.version;
$("manifest").textContent = manifestUrl;
$("expects").textContent = `${gameId}@${gameVersion}`;

function log(direction: string, data: unknown): void {
  const time = new Date().toISOString().slice(11, 23);
  logEl.textContent += `${time} ${direction} ${JSON.stringify(data)}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

// Protocol transport to the iframe, logging both directions.
const raw = postMessageTransport(frame.contentWindow!);
raw.subscribe((msg) => log("game → platform", msg));
const transport: Transport = {
  send(msg) {
    log("platform → game", msg);
    if (msg.type === "run:result") {
      status.textContent = `verdict: ${JSON.stringify(msg.payload.verdict)}`;
      playButton.disabled = false;
    }
    raw.send(msg);
  },
  subscribe: (handler) => raw.subscribe(handler),
};

// Registered before the host: the host answers run:end synchronously, and its
// run:result status must not be overwritten by "verifying…".
raw.subscribe((msg) => {
  switch (msg.type) {
    case "ready":
      status.textContent = `ready: ${msg.payload.gameId}@${msg.payload.gameVersion}`;
      playButton.disabled = false;
      break;
    case "run:end":
      status.textContent = "verifying…";
      break;
    case "error":
      status.textContent = `game error: ${msg.payload.message}`;
      playButton.disabled = false;
      break;
  }
});

const host = new StandaloneHost({
  coreModule,
  transport,
  seed: Number(params.get("seed")) || undefined,
});

// Shell-internal messages (not SDK protocol).
window.addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow) return;
  const data = event.data as { type?: unknown; message?: unknown };
  if (data?.type === "shell:error") {
    log("shell → platform", data);
    status.textContent = `shell error: ${String(data.message)}`;
  }
});

frame.addEventListener("load", () => {
  const load = { type: "shell:load", manifestUrl, gameId, gameVersion };
  log("platform → shell", load);
  frame.contentWindow!.postMessage(load, "*");
});
frame.src = "shell.html";

playButton.addEventListener("click", () => {
  playButton.disabled = true;
  status.textContent = "playing…";
  host.startRun();
});
$("pause").addEventListener("click", () =>
  transport.send(message<Of<"pause">>("pause")),
);
$("resume").addEventListener("click", () =>
  transport.send(message<Of<"resume">>("resume")),
);
let muted = false;
muteButton.addEventListener("click", () => {
  muted = !muted;
  muteButton.textContent = muted ? "Unmute" : "Mute";
  transport.send(message<Of<"mute">>("mute", { muted }));
});
$<HTMLInputElement>("fill").addEventListener("change", (e) =>
  document.body.classList.toggle(
    "fill",
    (e.target as HTMLInputElement).checked,
  ),
);
