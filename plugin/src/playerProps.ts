import type { StashScene } from './types.js';

export function buildOriginalPlayerProps(
  scene: StashScene | undefined,
  playerProps: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...playerProps,
    scene,
  };
}
