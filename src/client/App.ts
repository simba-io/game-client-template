import * as PIXI from "pixi.js";
import type {
  MountContext,
  RunSession,
  RunSubmission,
  RunVerdict,
} from "@arcadepro/game-sdk";
import {
  GameBridge,
  RunDriver,
  postMessageTransport,
} from "@arcadepro/game-sdk/client";
import coreModule, { type StubTapperState } from "../core";
import { GAME } from "../game.config";
import { createSilentAudio } from "./audio";
import { attachInput } from "./input";
import { PlayScene } from "./scenes/PlayScene";
import { ResultScene } from "./scenes/ResultScene";
import { TitleScene } from "./scenes/TitleScene";
import { Viewport } from "./viewport";

/**
 * Standalone mode only: fired on the container when the player presses
 * "Play again". The dev host listens for it and starts a new run (the
 * platform protocol has no "request a run" message).
 */
export const PLAY_AGAIN_EVENT = "arcadepro:play-again";

/** Every scene renders from the core's state; it never computes outcomes itself. */
export interface GameScene extends PIXI.Container {
  render(state: StubTapperState | null): void;
}

const ASSETS = ["assets/logo.svg"] as const;

/**
 * Owns the Pixi application, the RunDriver and the GameBridge, and switches
 * scenes. Lifecycle: title → (start) play → (end) result → (start) play …
 */
export class App {
  private readonly app = new PIXI.Application();
  private readonly root = new PIXI.Container();
  private readonly driver = new RunDriver(coreModule.core);
  private readonly audio = createSilentAudio();
  private readonly cleanups: (() => void)[] = [];
  private readonly assetUrls: string[];
  private bridge: GameBridge | null = null;
  private viewport: Viewport | null = null;
  private title!: TitleScene;
  private play!: PlayScene;
  private result!: ResultScene;
  private current: GameScene | null = null;
  private session: RunSession | null = null;
  private lastProgressScore = -1;
  private hostPaused = false;
  private hostMuted = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly ctx: MountContext,
  ) {
    this.assetUrls = ASSETS.map((path) => ctx.assetBaseUrl + path);
  }

  async init(): Promise<void> {
    const bridge = new GameBridge({
      gameId: GAME.id,
      gameVersion: GAME.version,
      transport: this.ctx.transport ?? postMessageTransport(window.parent),
    });
    this.bridge = bridge;
    try {
      await this.setUp(bridge);
    } catch (err) {
      bridge.error(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  destroy(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.bridge?.dispose();
    this.viewport?.destroy();
    this.app.ticker.stop();
    this.app.destroy(true, { children: true });
    // Destroys the loaded textures and clears them from the cache, so a
    // later mount() loads them afresh.
    void PIXI.Assets.unload(this.assetUrls).catch(() => {});
  }

  private async setUp(bridge: GameBridge): Promise<void> {
    await this.app.init({
      resizeTo: this.container,
      background: GAME.background,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    const canvas = this.app.canvas;
    canvas.style.cssText =
      "display:block; touch-action:none; user-select:none; -webkit-tap-highlight-color:transparent";
    this.container.appendChild(canvas);
    this.app.stage.addChild(this.root);
    this.viewport = new Viewport(this.app, this.container, this.root);

    const [logoUrl] = this.assetUrls;
    const textures = await PIXI.Assets.load<PIXI.Texture>(this.assetUrls);
    const standalone = this.ctx.mode === "standalone";
    this.title = new TitleScene(textures[logoUrl!]!);
    this.play = new PlayScene();
    this.result = new ResultScene(standalone, () =>
      this.container.dispatchEvent(
        new CustomEvent(PLAY_AGAIN_EVENT, { bubbles: true }),
      ),
    );
    this.title.setStatus(
      standalone ? "Press Start run" : "Waiting for platform…",
    );
    this.show(this.title);

    this.cleanups.push(
      bridge.onStart((s) => this.startRun(s)),
      bridge.onResult((r) => this.showResult(r.runId, r.verdict)),
      bridge.onPause(() => {
        this.hostPaused = true;
        this.applyPause();
      }),
      bridge.onResume(() => {
        this.hostPaused = false;
        this.applyPause();
      }),
      bridge.onMute((muted) => {
        this.hostMuted = muted;
        this.applyPause();
      }),
      this.driver.onEnd((sub) => this.endRun(sub)),
      attachInput(canvas, this.driver, () => {
        this.play.pulse();
        this.audio.play("tap");
      }),
    );

    const onVisibility = (): void => this.applyPause();
    document.addEventListener("visibilitychange", onVisibility);
    this.cleanups.push(() =>
      document.removeEventListener("visibilitychange", onVisibility),
    );

    const onTick = (ticker: PIXI.Ticker): void => this.frame(ticker.deltaMS);
    this.app.ticker.add(onTick);
    this.cleanups.push(() => this.app.ticker.remove(onTick));

    bridge.ready();
  }

  private frame(deltaMs: number): void {
    this.driver.advance(deltaMs);
    const state = this.driver.state;
    if (this.driver.running && this.session && state) {
      const score = coreModule.core.score(state);
      if (score !== this.lastProgressScore) {
        this.lastProgressScore = score;
        this.bridge?.progress(this.session.runId, score); // throttled by the bridge
      }
    }
    this.current?.render(state);
  }

  private startRun(session: RunSession): void {
    const { gameId, gameVersion } = session.config;
    if (gameId !== GAME.id || gameVersion !== GAME.version) {
      this.bridge?.error("version_mismatch", session.runId);
      return;
    }
    this.session = session;
    this.lastProgressScore = -1;
    this.play.reset();
    this.show(this.play);
    try {
      this.driver.start(session);
    } catch (err) {
      this.bridge?.error(
        err instanceof Error ? err.message : String(err),
        session.runId,
      );
      this.title.setStatus("Could not start the run");
      this.show(this.title);
      return;
    }
    this.applyPause(); // the host may have paused, or the page be hidden, already
  }

  private endRun(submission: RunSubmission): void {
    this.bridge?.end(submission);
    this.result.showVerifying(submission.clientScore);
    this.show(this.result);
  }

  private showResult(runId: string, verdict: RunVerdict): void {
    if (runId !== this.session?.runId) return;
    this.result.showVerdict(verdict);
  }

  /** Paused by the host or because the page is hidden; resume only when neither. */
  private applyPause(): void {
    const paused = this.hostPaused || document.hidden;
    if (paused) this.driver.pause();
    else this.driver.resume();
    this.audio.setMuted(this.hostMuted || paused);
  }

  private show(scene: GameScene): void {
    if (this.current === scene) return;
    if (this.current) this.root.removeChild(this.current);
    this.current = scene;
    this.root.addChild(scene);
  }
}
