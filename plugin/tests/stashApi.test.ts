import { describe, it, expect } from 'vitest';
import {
  buildExternalPlayerUrl,
  buildPlaybackUrl,
  isRemuxPathPattern,
  resolvePlaybackPlan,
} from '../src/stashApi.js';
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
      playbackPriority: ['remux-hls', 'hls', 'direct', 'stash'],
    });

    expect(resolvePlaybackPlan(settings, { ok: true, mode: ['direct', 'hls', 'remux-hls'] })).toEqual({
      id: 'remux-hls',
      playerMode: 'hls',
      pathPattern: '/stash/scene/{id}/remux/master.m3u8',
      supportsQuality: false,
    });
  });

  it('falls back from configured remux HLS to standard HLS when remux is not advertised', () => {
    const settings = normalizeSettings({
      playbackPriority: ['remux-hls', 'hls', 'direct', 'stash'],
    });

    expect(resolvePlaybackPlan(settings, { ok: true, mode: ['direct', 'hls'] })).toEqual({
      id: 'hls',
      playerMode: 'hls',
      pathPattern: '/stash/scene/{id}/master.m3u8',
      supportsQuality: true,
    });
  });

  it('uses direct when it is next in priority and HLS is not advertised', () => {
    const settings = normalizeSettings({
      playbackPriority: ['remux-hls', 'hls', 'direct', 'stash'],
    });

    expect(resolvePlaybackPlan(settings, { ok: true, mode: ['direct'] })).toEqual({
      id: 'direct',
      playerMode: 'direct',
      pathPattern: '/stash/scene/{id}/direct',
      supportsQuality: false,
    });
  });

  it('falls back to Stash when no external priority is advertised', () => {
    const settings = normalizeSettings({
      playbackPriority: ['remux-hls', 'hls', 'stash'],
    });

    expect(resolvePlaybackPlan(settings, { ok: true, mode: ['direct'] })).toBeNull();
  });
});

describe('isRemuxPathPattern', () => {
  it('detects remux route patterns', () => {
    expect(isRemuxPathPattern('/stash/scene/{id}/remux/master.m3u8')).toBe(true);
    expect(isRemuxPathPattern('/stash/scene/{id}/master.m3u8')).toBe(false);
  });
});

describe('buildExternalPlayerUrl', () => {
  it('injects URL-encoded stream URLs into external player templates', () => {
    expect(
      buildExternalPlayerUrl(
        'iina://weblink?url={encodedURL}',
        'https://video.home/stash/scene/1/master.m3u8?quality=720p'
      )
    ).toBe(
      'iina://weblink?url=https%3A%2F%2Fvideo.home%2Fstash%2Fscene%2F1%2Fmaster.m3u8%3Fquality%3D720p'
    );
  });
});
