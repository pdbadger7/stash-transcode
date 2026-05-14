import { describe, it, expect } from 'vitest';
import {
  buildMasterPlaylist,
  buildVariantPlaylist,
  computeSegmentPlan,
} from '../../src/hls/playlist.js';
import type { HLSProfile } from '../../src/types.js';

const P720: HLSProfile = { id: '720p', label: '720p', width: 1280, height: 720, videoBitrateKbps: 3500, bandwidthKbps: 4200 };
const P1080: HLSProfile = { id: '1080p', label: '1080p', width: 1920, height: 1080, videoBitrateKbps: 6000, bandwidthKbps: 6800 };

describe('computeSegmentPlan', () => {
  it('produces a final short segment for non-divisible durations', () => {
    const plan = computeSegmentPlan({ durationSeconds: 10, segmentDuration: 4 });
    expect(plan.count).toBe(3);
    expect(plan.durations).toEqual([4, 4, 2]);
  });

  it('handles a duration shorter than one segment', () => {
    const plan = computeSegmentPlan({ durationSeconds: 1.5, segmentDuration: 4 });
    expect(plan.count).toBe(1);
    expect(plan.durations).toEqual([1.5]);
  });

  it('handles exact multiples without a remainder segment', () => {
    const plan = computeSegmentPlan({ durationSeconds: 12, segmentDuration: 4 });
    expect(plan.count).toBe(3);
    expect(plan.durations).toEqual([4, 4, 4]);
  });

  it('throws if duration is missing or non-positive', () => {
    expect(() => computeSegmentPlan({ durationSeconds: 0, segmentDuration: 4 })).toThrow();
    expect(() => computeSegmentPlan({ durationSeconds: -1, segmentDuration: 4 })).toThrow();
  });
});

describe('buildVariantPlaylist', () => {
  it('emits VOD playlist with one EXTINF per segment ending in EXT-X-ENDLIST', () => {
    const out = buildVariantPlaylist({
      sceneId: 'sc1',
      profileId: '720p',
      durationSeconds: 10,
      segmentDuration: 4,
      token: 't',
    });
    expect(out).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(out).toContain('#EXT-X-TARGETDURATION:4');
    expect(out).toContain('#EXTINF:4.000,');
    expect(out).toContain('#EXTINF:2.000,');
    expect(out).toContain('/stash/scene/sc1/variant/720p/segment_000.ts?token=t');
    expect(out).toContain('/stash/scene/sc1/variant/720p/segment_002.ts?token=t');
    expect(out.trim().endsWith('#EXT-X-ENDLIST')).toBe(true);
  });
});

describe('buildMasterPlaylist', () => {
  it('emits one EXT-X-STREAM-INF per profile with downscaled resolution', () => {
    const out = buildMasterPlaylist({
      sceneId: 'sc1',
      profiles: [P1080, P720],
      source: { width: 1920, height: 1080, fps: 24 },
      token: 't',
    });
    expect(out).toMatch(/RESOLUTION=1920x1080/);
    expect(out).toMatch(/RESOLUTION=1280x720/);
    expect(out).toMatch(/FRAME-RATE=24\.000/);
    expect(out).toMatch(/\/stash\/scene\/sc1\/variant\/1080p\/master\.m3u8\?token=t/);
  });

  it('drops profiles taller than the source', () => {
    const out = buildMasterPlaylist({
      sceneId: 'sc1',
      profiles: [P1080, P720],
      source: { width: 1280, height: 720, fps: 30 },
      token: undefined,
    });
    expect(out).not.toMatch(/1080p/);
    expect(out).toMatch(/720p/);
  });
});
