import { describe, expect, it } from 'vitest';
import { resolveSettings } from '../src/settings.js';

describe('resolveSettings', () => {
  it('uses persisted plugin settings over defaults', () => {
    const resolved = resolveSettings({
      configuration: {
        plugins: {
          'external-transcode-player': {
            externalTranscodeBaseUrl: 'https://video.example',
            playbackPriority: 'hls,direct,stash',
            directPathPattern: '/custom/direct/{id}',
            hlsPathPattern: '/custom/hls/{id}/master.m3u8',
            remuxHlsPathPattern: '/custom/remux/{id}/master.m3u8',
            fallbackToStashPlayer: false,
            externalPlayerUrlTemplate: 'iina://weblink?url={encodedURL}',
            sharedToken: 'abc123',
            debug: true,
          },
        },
      },
    });

    expect(resolved.externalTranscodeBaseUrl).toBe('https://video.example');
    expect(resolved.playbackPriority).toEqual(['hls', 'direct', 'stash']);
    expect(resolved.directPathPattern).toBe('/custom/direct/{id}');
    expect(resolved.hlsPathPattern).toBe('/custom/hls/{id}/master.m3u8');
    expect(resolved.remuxHlsPathPattern).toBe('/custom/remux/{id}/master.m3u8');
    expect(resolved.fallbackToStashPlayer).toBe(false);
    expect(resolved.externalPlayerUrlTemplate).toBe('iina://weblink?url={encodedURL}');
    expect(resolved.sharedToken).toBe('abc123');
    expect(resolved.debug).toBe(true);
  });

  it('migrates an old remux hlsPathPattern into the dedicated remux setting', () => {
    const resolved = resolveSettings(undefined, {
      playbackMode: 'hls',
      hlsPathPattern: '/stash/scene/{id}/remux/master.m3u8',
    });

    expect(resolved.playbackPriority).toEqual(['remux-hls', 'hls', 'direct', 'stash']);
    expect(resolved.remuxHlsPathPattern).toBe('/stash/scene/{id}/remux/master.m3u8');
    expect(resolved.hlsPathPattern).toBe('/stash/scene/{id}/master.m3u8');
  });
});
