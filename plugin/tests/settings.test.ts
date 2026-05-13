import { describe, expect, it } from 'vitest';
import { resolveSettings } from '../src/settings.js';

describe('resolveSettings', () => {
  it('uses persisted plugin settings over defaults', () => {
    const resolved = resolveSettings({
      configuration: {
        plugins: {
          'external-transcode-player': {
            externalTranscodeBaseUrl: 'https://video.example',
            playbackMode: 'hls',
            directPathPattern: '/custom/direct/{id}',
            hlsPathPattern: '/custom/hls/{id}/master.m3u8',
            probeBeforeReplace: false,
            fallbackToStashPlayer: false,
            sharedToken: 'abc123',
            debug: true,
          },
        },
      },
    });

    expect(resolved.externalTranscodeBaseUrl).toBe('https://video.example');
    expect(resolved.playbackMode).toBe('hls');
    expect(resolved.directPathPattern).toBe('/custom/direct/{id}');
    expect(resolved.hlsPathPattern).toBe('/custom/hls/{id}/master.m3u8');
    expect(resolved.probeBeforeReplace).toBe(false);
    expect(resolved.fallbackToStashPlayer).toBe(false);
    expect(resolved.sharedToken).toBe('abc123');
    expect(resolved.debug).toBe(true);
  });
});
