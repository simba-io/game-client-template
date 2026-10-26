import type { RunDriver } from "@arcadepro/game-sdk/client";

/**
 * Pointer and keyboard → recorder.record("tap"). Input handlers ONLY record;
 * they never call core functions. Returns a function that removes the listeners.
 *
 * - Every pointerdown is a tap, so multi-touch gives multiple taps.
 * - Space is a desktop testing convenience; key auto-repeat is ignored.
 * - `onTap` is for cosmetic feedback only, called when a tap was recorded.
 */
export function attachInput<S>(
  playArea: HTMLElement,
  driver: RunDriver<S>,
  onTap: () => void,
): () => void {
  const tap = (): void => {
    if (!driver.running || driver.paused) return;
    if (driver.recorder.record("tap")) onTap();
  };
  const onPointerDown = (): void => tap();
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== "Space") return;
    e.preventDefault();
    if (!e.repeat) tap();
  };

  playArea.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("keydown", onKeyDown);
  return () => {
    playArea.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("keydown", onKeyDown);
  };
}
