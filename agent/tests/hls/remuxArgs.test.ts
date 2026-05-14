import { describe, expect, it } from 'vitest';
import { buildRemuxHlsArgs, normalizeVideoCodec } from '../../src/hls/remuxArgs.js';

describe('buildRemuxHlsArgs', () => {
  it('builds fMP4 HLS remux args without video filters or encoders', () => {
    const args = buildRemuxHlsArgs({
      inputPath: '/m/video.mp4',
      outputDir: '/tmp/remux/sc1',
      segmentDuration: 4,
      videoCodec: 'h264',
    });

    expect(args).toContain('-c:v');
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
    expect(args).toContain('-c:a');
    expect(args[args.indexOf('-c:a') + 1]).toBe('copy');
    expect(args).not.toContain('-vf');
    expect(args).not.toContain('libx264');
    expect(args).not.toContain('h264_vaapi');
    expect(args).toContain('-hls_segment_type');
    expect(args[args.indexOf('-hls_segment_type') + 1]).toBe('fmp4');
    expect(args).toContain('-hls_fmp4_init_filename');
    expect(args[args.indexOf('-hls_fmp4_init_filename') + 1]).toBe('init.mp4');
    expect(args).toContain('-hls_segment_filename');
    expect(args[args.indexOf('-hls_segment_filename') + 1]).toBe('/tmp/remux/sc1/segment_%03d.m4s');
  });

  it('tags HEVC remux output as hvc1 for client compatibility', () => {
    const args = buildRemuxHlsArgs({
      inputPath: '/m/video.mp4',
      outputDir: '/tmp/remux/sc1',
      segmentDuration: 6,
      videoCodec: 'h265',
    });

    expect(args).toContain('-tag:v');
    expect(args[args.indexOf('-tag:v') + 1]).toBe('hvc1');
  });
});

describe('normalizeVideoCodec', () => {
  it('normalizes common H.264 and HEVC codec names', () => {
    expect(normalizeVideoCodec('avc1')).toBe('h264');
    expect(normalizeVideoCodec('H.264')).toBe('h264');
    expect(normalizeVideoCodec('hvc1')).toBe('hevc');
    expect(normalizeVideoCodec('H.265')).toBe('hevc');
  });
});
