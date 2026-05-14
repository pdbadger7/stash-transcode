import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { SceneContextCache } from '../src/sceneContextCache.js';

describe('SceneContextCache', () => {
  it('returns cached values until the TTL expires', async () => {
    vi.useFakeTimers();
    const cache = new SceneContextCache(1_000, 100, 10_000);
    const resolver = vi
      .fn()
      .mockResolvedValueOnce({
        sceneId: 'sc1',
        inputPath: '/media/a.mp4',
        sourceMetadata: { durationSeconds: 10 },
      })
      .mockResolvedValueOnce({
        sceneId: 'sc1',
        inputPath: '/media/b.mp4',
        sourceMetadata: { durationSeconds: 20 },
      });

    await expect(cache.getOrResolve('sc1', resolver)).resolves.toMatchObject({
      inputPath: '/media/a.mp4',
    });
    await expect(cache.getOrResolve('sc1', resolver)).resolves.toMatchObject({
      inputPath: '/media/a.mp4',
    });
    expect(resolver).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_001);
    await expect(cache.getOrResolve('sc1', resolver)).resolves.toMatchObject({
      inputPath: '/media/b.mp4',
    });
    expect(resolver).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('revalidates file readability after the revalidation interval', async () => {
    vi.useFakeTimers();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-cache-'));
    const file = path.join(dir, 'video.mp4');
    await fs.writeFile(file, 'x');
    const cache = new SceneContextCache(10_000, 100, 100);
    const resolver = vi.fn().mockResolvedValue({
      sceneId: 'sc1',
      inputPath: file,
      sourceMetadata: { durationSeconds: 10 },
    });

    await cache.getOrResolve('sc1', resolver);
    await fs.rm(file);
    await vi.advanceTimersByTimeAsync(101);
    await cache.getOrResolve('sc1', resolver);

    expect(resolver).toHaveBeenCalledTimes(2);
    await fs.rm(dir, { recursive: true, force: true });
    vi.useRealTimers();
  });
});
