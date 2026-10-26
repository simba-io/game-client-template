// Audio goes through this interface. No-op for now: simple-sound-editor is not
// ready to be imported into the build yet (see CLAUDE.md).
export interface GameAudio {
  play(event: string): void;
  setMuted(muted: boolean): void;
}

export function createSilentAudio(): GameAudio {
  return {
    play() {},
    setMuted() {},
  };
}
