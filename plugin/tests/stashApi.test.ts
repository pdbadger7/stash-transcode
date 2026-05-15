import { describe, it, expect } from 'vitest';
import { buildPlaybackUrl, resolvePlaybackPlan } from '../src/stashApi.js';
import { normalizeSettings } from '../src/settings.js';

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

describe('resolvePlaybackPlan', () => {
  it('uses configured remux HLS when the agent advertises remux support', () => {
    const settings = normalizeSettings({
      playbackMode: 'hls',
      hlsPathPattern: '/stash/scene/{id}/remux/master.m3u8',
    });

    expect(resolvePlaybackPlan(settings, { ok: true, mode: ['direct', 'hls', 'remux-hls'] })).toEqual({
      mode: 'hls',
      pathPattern: '/stash/scene/{id}/remux/master.m3u8',
    });
  });

  it('falls back from configured remux HLS to standard HLS when remux is not advertised', () => {
    const settings = normalizeSettings({
      playbackMode: 'hls',
      hlsPathPattern: '/stash/scene/{id}/remux/master.m3u8',
    });

    expect(resolvePlaybackPlan(settings, { ok: true, mode: ['direct', 'hls'] })).toEqual({
      mode: 'hls',
      pathPattern: '/stash/scene/{id}/master.m3u8',
    });
  });

  it('does not replace the player when the requested mode is not advertised', () => {
    const settings = normalizeSettings({
      playbackMode: 'hls',
      hlsPathPattern: '/stash/scene/{id}/remux/master.m3u8',
    });

    expect(resolvePlaybackPlan(settings, { ok: true, mode: ['direct'] })).toBeNull();
  });
});
