import { describe, it, expect } from 'vitest';
import {
  buildExternalPlayerUrl,
  buildInjectedStreams,
  buildPlaybackUrl,
  isRemuxPathPattern,
  resolvePlaybackPlan,
  shouldUseStashPlayback,
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

  it('skips failed strategies when resolving the next fallback plan', () => {
    const settings = normalizeSettings({
      playbackPriority: ['remux-hls', 'hls', 'direct', 'stash'],
    });

    expect(
      resolvePlaybackPlan(
        settings,
        { ok: true, mode: ['direct', 'hls', 'remux-hls'] },
        new Set(['remux-hls', 'hls'])
      )
    ).toEqual({
      id: 'direct',
      playerMode: 'direct',
      pathPattern: '/stash/scene/{id}/direct',
      supportsQuality: false,
    });
  });
});

describe('shouldUseStashPlayback', () => {
  it('uses Stash when all advertised external priorities have failed', () => {
    const settings = normalizeSettings({
      playbackPriority: ['direct', 'hls', 'stash'],
      fallbackToStashPlayer: false,
    });

    expect(
      shouldUseStashPlayback(
        settings,
        { ok: true, mode: ['direct', 'hls'] },
        new Set(['direct', 'hls'])
      )
    ).toBe(true);
  });

  it('does not use Stash while an advertised external priority remains available', () => {
    const settings = normalizeSettings({
      playbackPriority: ['direct', 'hls', 'stash'],
    });

    expect(
      shouldUseStashPlayback(settings, { ok: true, mode: ['direct', 'hls'] }, new Set(['direct']))
    ).toBe(false);
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

describe('buildInjectedStreams', () => {
  it('prepends External Remux HLS and External HLS streams when both are advertised', () => {
    const settings = normalizeSettings({
      playbackPriority: ['remux-hls', 'hls', 'direct', 'stash'],
    });
    const streams = buildInjectedStreams(
      settings,
      { ok: true, mode: ['remux-hls', 'hls', 'direct'] },
      '42'
    );
    expect(streams).toHaveLength(2);
    expect(streams[0]).toMatchObject({
      mime_type: 'application/vnd.apple.mpegurl',
      label: 'External Remux HLS',
    });
    expect(streams[0].url).toContain('/stash/scene/42/remux/master.m3u8');
    expect(streams[1]).toMatchObject({
      mime_type: 'application/vnd.apple.mpegurl',
      label: 'External HLS',
    });
    expect(streams[1].url).toContain('/stash/scene/42/master.m3u8');
  });

  it('returns only External HLS when remux-hls is not advertised', () => {
    const settings = normalizeSettings({
      playbackPriority: ['remux-hls', 'hls', 'direct', 'stash'],
    });
    const streams = buildInjectedStreams(
      settings,
      { ok: true, mode: ['hls', 'direct'] },
      '7'
    );
    expect(streams).toHaveLength(1);
    expect(streams[0].label).toBe('External HLS');
  });

  it('returns no streams when probe advertises only direct (direct is excluded in integrated mode)', () => {
    const settings = normalizeSettings({
      playbackPriority: ['remux-hls', 'hls', 'direct', 'stash'],
    });
    const streams = buildInjectedStreams(settings, { ok: true, mode: ['direct'] }, '99');
    expect(streams).toHaveLength(0);
  });

  it('returns no streams when probe mode is empty', () => {
    const settings = normalizeSettings({
      playbackPriority: ['remux-hls', 'hls', 'stash'],
    });
    const streams = buildInjectedStreams(settings, { ok: true, mode: [] }, '1');
    expect(streams).toHaveLength(0);
  });

  it('respects playbackPriority order — hls before remux-hls when configured that way', () => {
    const settings = normalizeSettings({
      playbackPriority: ['hls', 'remux-hls', 'stash'],
    });
    const streams = buildInjectedStreams(
      settings,
      { ok: true, mode: ['remux-hls', 'hls'] },
      '5'
    );
    expect(streams[0].label).toBe('External HLS');
    expect(streams[1].label).toBe('External Remux HLS');
  });

  it('includes the shared token in stream URLs', () => {
    const settings = normalizeSettings({
      playbackPriority: ['hls', 'stash'],
      sharedToken: 'secret',
    });
    const streams = buildInjectedStreams(settings, { ok: true, mode: ['hls'] }, '3');
    expect(streams[0].url).toContain('token=secret');
  });
});
