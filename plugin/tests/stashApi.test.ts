import { describe, it, expect } from 'vitest';
import { buildPlaybackUrl } from '../src/stashApi.js';

describe('Stash API Utilities', () => {
  it('should build direct playback URL', () => {
    const url = buildPlaybackUrl(
      'https://video.home',
      '/stash/scene/{id}/direct',
      '123'
    );
    expect(url).toBe('https://video.home/stash/scene/123/direct');
  });

  it('should build HLS playback URL', () => {
    const url = buildPlaybackUrl(
      'https://video.home',
      '/stash/scene/{id}/master.m3u8',
      '456'
    );
    expect(url).toBe('https://video.home/stash/scene/456/master.m3u8');
  });

  it('should include token in query string', () => {
    const url = buildPlaybackUrl(
      'https://video.home',
      '/stash/scene/{id}/direct',
      '789',
      'secret-token'
    );
    expect(url).toContain('token=secret-token');
  });

  it('should include quality preference in query string', () => {
    const url = buildPlaybackUrl(
      'https://video.home',
      '/stash/scene/{id}/master.m3u8',
      '321',
      undefined,
      '720p'
    );
    expect(url).toContain('quality=720p');
  });
});
