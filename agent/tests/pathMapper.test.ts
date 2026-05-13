import { describe, it, expect } from 'vitest';
import { PathMapper } from '../src/pathMapper.js';

describe('PathMapper', () => {
  const mappings = [
    { from: '/data/', to: '/mnt/nas/media/' },
    { from: '/mnt/internal/', to: '/mnt/nas/media/internal/' },
  ];
  const mediaRoot = '/mnt/nas/media';

  it('should map basic paths', () => {
    const mapper = new PathMapper(mappings, mediaRoot);
    const result = mapper.map('/data/movies/example.mkv');
    expect(result.success).toBe(true);
    expect(result.path).toBe('/mnt/nas/media/movies/example.mkv');
  });

  it('should prevent path traversal with ..', () => {
    const mapper = new PathMapper(mappings, mediaRoot);
    const result = mapper.map('/data/../../../etc/passwd');
    // Even with .., it should still be mapped correctly and validated
    expect(result.success).toBe(false); // Should fail because normalized path escapes root
  });

  it('should allow mapping to media root itself', () => {
    const mapper = new PathMapper(mappings, mediaRoot);
    // This should work - mapping a file that results in exactly the media root directory
    const result = mapper.map('/data/');
    // /data/ maps to /mnt/nas/media/ which is the root itself
    // The mapper allows paths at root level
    expect(result.success).toBe(true);
  });

  it('should handle multiple mappings', () => {
    const mapper = new PathMapper(mappings, mediaRoot);
    const result1 = mapper.map('/data/test.mp4');
    const result2 = mapper.map('/mnt/internal/test.mp4');

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result2.path).toBe('/mnt/nas/media/internal/test.mp4');
  });

  it('should handle trailing slashes', () => {
    const mapper = new PathMapper(mappings, mediaRoot);
    const result = mapper.map('/data/movies/test.mkv');
    expect(result.success).toBe(true);
    expect(result.path).toMatch(/\/mnt\/nas\/media\/movies\/test\.mkv/);
  });

  it('should return error for unmapped paths', () => {
    const mapper = new PathMapper(mappings, mediaRoot);
    const result = mapper.map('/unmapped/path.mkv');
    expect(result.success).toBe(false);
    expect(result.error).toContain('No mapping found');
  });
});
