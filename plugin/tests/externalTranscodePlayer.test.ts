import { describe, expect, it } from 'vitest';
import { buildOriginalPlayerProps } from '../src/playerProps.js';
import type { StashScene } from '../src/types.js';

describe('buildOriginalPlayerProps', () => {
  it('preserves the scene object when falling back to the original player', () => {
    const scene: StashScene = {
      id: 'scene-1',
      title: 'Example',
      files: [{ id: 'file-1', path: '/media/example.mp4' }],
    };

    const props = buildOriginalPlayerProps(scene, {
      foo: 'bar',
    });

    expect(props.scene).toBe(scene);
    expect(props.foo).toBe('bar');
  });
});
