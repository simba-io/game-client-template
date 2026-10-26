import type * as PIXI from "pixi.js";
import { GAME } from "../game.config";

/**
 * Letterboxed design-resolution scaling. `root` holds every scene in design
 * coordinates (GAME.designWidth × GAME.designHeight); it is scaled to fit the
 * container and centred. Driven by the container's size, not the window's, so
 * it also works inside the platform's iframe.
 */
export class Viewport {
  private readonly observer: ResizeObserver;

  constructor(
    private readonly app: PIXI.Application,
    private readonly container: HTMLElement,
    private readonly root: PIXI.Container,
  ) {
    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(container);
    this.layout();
  }

  layout(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.app.renderer.resize(width, height);
    const scale = Math.min(
      width / GAME.designWidth,
      height / GAME.designHeight,
    );
    this.root.scale.set(scale);
    this.root.position.set(
      (width - GAME.designWidth * scale) / 2,
      (height - GAME.designHeight * scale) / 2,
    );
  }

  destroy(): void {
    this.observer.disconnect();
  }
}
