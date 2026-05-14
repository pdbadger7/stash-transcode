import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { SegmentCache } from '../../src/hls/segmentCache.js';

describe('SegmentCache', () => {
  let dir: string;
  let cache: SegmentCache;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'segcache-'));
    cache = new SegmentCache(dir);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns false from has() when segment is missing', async () => {
    expect(await cache.has('scene1', '720p', 0)).toBe(false);
  });

  it('writes a segment and reads it back', async () => {
    const buf = Buffer.from('hello-ts');
    await cache.write('scene1', '720p', 5, buf);
    expect(await cache.has('scene1', '720p', 5)).toBe(true);
    expect(await cache.read('scene1', '720p', 5)).toEqual(buf);
  });

  it('rejects path traversal attempts', async () => {
    await expect(cache.read('scene1', '../evil', 0)).rejects.toThrow();
    await expect(cache.read('../etc/passwd', '720p', 0)).rejects.toThrow();
  });

  it('returns the segment file path with zero-padded index', () => {
    const p = cache.pathFor('scene1', '720p', 7);
    expect(p.endsWith(path.join('scene1', '720p', 'segment_007.ts'))).toBe(true);
  });

  it('cleans up scene/profile directories older than maxAgeMs', async () => {
    await cache.write('old', '720p', 0, Buffer.from('x'));
    const oldFile = cache.pathFor('old', '720p', 0);
    const ancient = Date.now() / 1000 - 3600;
    await fs.utimes(path.dirname(oldFile), ancient, ancient);
    await cache.cleanup(1000, () => false);
    expect(await cache.has('old', '720p', 0)).toBe(false);
  });

  it('does not clean up directories whose key is still in use', async () => {
    await cache.write('active', '720p', 0, Buffer.from('x'));
    const file = cache.pathFor('active', '720p', 0);
    const ancient = Date.now() / 1000 - 3600;
    await fs.utimes(path.dirname(file), ancient, ancient);
    await cache.cleanup(1000, (sceneId, profileId) => sceneId === 'active' && profileId === '720p');
    expect(await cache.has('active', '720p', 0)).toBe(true);
  });
});
