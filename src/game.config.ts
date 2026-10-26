// Single source of game identity. Keep this a plain constant module: the
// headless core may import it, so it must never pull in anything non-pure.
export const GAME = {
  id: "stub-tapper",
  version: "0.0.1",
  title: "Stub Tapper",
  orientation: "portrait",
  designWidth: 1920,
  designHeight: 3000,
  background: 0x1099bb,
} as const;
