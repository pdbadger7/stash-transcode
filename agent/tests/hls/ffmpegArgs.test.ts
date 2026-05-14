import { describe, it, expect } from 'vitest';
import {
  buildSingleSegmentArgs,
  buildSessionArgs,
  selectHwAccelMode,
  type HwAccelEnv,
} from '../../src/hls/ffmpegArgs.js';

const PROFILE = {
  id: '720p',
  label: '720p',
  width: 1280,
  height: 720,
  videoBitrateKbps: 3500,
  bandwidthKbps: 4200,
};

describe('buildSingleSegmentArgs', () => {
  it('includes input-seek before -i, output_ts_offset, and writes mpegts to stdout', () => {
    const args = buildSingleSegmentArgs({
      inputPath: '/m/video.mp4',
      profile: PROFILE,
      startSeconds: 40,
      durationSeconds: 4,
      mode: 'none',
      segmentDuration: 4,
    });
    const ssIdx = args.indexOf('-ss');
    const iIdx = args.indexOf('-i');
    expect(ssIdx).toBeGreaterThanOrEqual(0);
    expect(ssIdx).toBeLessThan(iIdx);
    expect(args[ssIdx + 1]).toBe('40');
    expect(args).toContain('-output_ts_offset');
    expect(args[args.indexOf('-output_ts_offset') + 1]).toBe('40');
    expect(args).toContain('-fflags');
    expect(args[args.indexOf('-fflags') + 1]).toBe('+genpts');
    expect(args).toContain('-avoid_negative_ts');
    expect(args[args.indexOf('-avoid_negative_ts') + 1]).toBe('make_zero');
    expect(args).not.toContain('-copyts');
    expect(args).toContain('-t');
    expect(args).toContain('4');
    expect(args).toContain('-f');
    expect(args).toContain('mpegts');
    expect(args[args.length - 1]).toBe('pipe:1');
    expect(args).toContain('-force_key_frames');
    expect(args[args.indexOf('-force_key_frames') + 1]).toBe('expr:gte(t,40)');
  });

  it('uses ultrafast preset for software encoding', () => {
    const args = buildSingleSegmentArgs({
      inputPath: '/m/video.mp4',
      profile: PROFILE,
      startSeconds: 0,
      durationSeconds: 4,
      mode: 'none',
      segmentDuration: 4,
    });
    const presetIdx = args.indexOf('-preset');
    expect(presetIdx).toBeGreaterThanOrEqual(0);
    expect(args[presetIdx + 1]).toBe('ultrafast');
  });

  it('uses VAAPI device init and hardware-safe filter chain when mode is vaapi', () => {
    const args = buildSingleSegmentArgs({
      inputPath: '/m/video.mp4',
      profile: PROFILE,
      startSeconds: 0,
      durationSeconds: 4,
      mode: 'vaapi',
      segmentDuration: 4,
      hwaccelDevice: '/dev/dri/renderD129',
    });
    expect(args).toContain('h264_vaapi');
    expect(args).toContain('-vaapi_device');
    expect(args[args.indexOf('-vaapi_device') + 1]).toBe('/dev/dri/renderD129');
    expect(args).toContain('-hwaccel');
    expect(args[args.indexOf('-hwaccel') + 1]).toBe('vaapi');
    expect(args).toContain('-hwaccel_device');
    expect(args[args.indexOf('-hwaccel_device') + 1]).toBe('/dev/dri/renderD129');
    expect(args).toContain('-vf');
    expect(args[args.indexOf('-vf') + 1]).toBe('format=nv12,hwupload,scale_vaapi=-2:720');
    expect(args).not.toContain('scale=-2:720');
  });

  it('uploads frames for VAAPI even when no scale is needed', () => {
    const nativeProfile = { ...PROFILE, height: 0 };
    const args = buildSingleSegmentArgs({
      inputPath: '/m/video.mp4',
      profile: nativeProfile,
      startSeconds: 0,
      durationSeconds: 4,
      mode: 'vaapi',
      segmentDuration: 4,
      sourceVideoCodec: 'hevc',
    });
    expect(args).toContain('h264_vaapi');
    expect(args).toContain('-vf');
    expect(args[args.indexOf('-vf') + 1]).toBe('format=nv12,hwupload');
  });

  it('uses stream copy and skips scale/preset/bitrate when source is h264 with no-scale profile', () => {
    const nativeProfile = { ...PROFILE, height: 0 };
    const args = buildSingleSegmentArgs({
      inputPath: '/m/video.mp4',
      profile: nativeProfile,
      startSeconds: 10,
      durationSeconds: 2,
      mode: 'none',
      segmentDuration: 4,
      sourceVideoCodec: 'h264',
    });
    expect(args).toContain('copy');
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
    expect(args).not.toContain('-preset');
    expect(args).not.toContain('-vf');
    expect(args).not.toContain('-b:v');
    expect(args).toContain('-c:a');
    expect(args[args.length - 1]).toBe('pipe:1');
  });

  it('does not use stream copy when source codec is not h264', () => {
    const nativeProfile = { ...PROFILE, height: 0 };
    const args = buildSingleSegmentArgs({
      inputPath: '/m/video.mp4',
      profile: nativeProfile,
      startSeconds: 0,
      durationSeconds: 2,
      mode: 'none',
      segmentDuration: 4,
      sourceVideoCodec: 'hevc',
    });
    expect(args).not.toContain('copy');
    expect(args).toContain('libx264');
  });
});

describe('buildSessionArgs', () => {
  it('uses veryfast preset for software encoding', () => {
    const args = buildSessionArgs({
      inputPath: '/m/v.mp4',
      profile: PROFILE,
      head: 0,
      mode: 'none',
      segmentDuration: 4,
      outputDir: '/tmp/cache/sc1/720p',
    });
    const presetIdx = args.indexOf('-preset');
    expect(presetIdx).toBeGreaterThanOrEqual(0);
    expect(args[presetIdx + 1]).toBe('veryfast');
  });

  it('starts at head*segmentDuration with -start_number=head and discards playlist', () => {
    const args = buildSessionArgs({
      inputPath: '/m/v.mp4',
      profile: PROFILE,
      head: 100,
      mode: 'none',
      segmentDuration: 4,
      segmentCount: 15,
      outputDir: '/tmp/cache/sc1/720p',
    });
    const ssIdx = args.indexOf('-ss');
    expect(args[ssIdx + 1]).toBe('400');
    expect(args).toContain('-t');
    expect(args[args.indexOf('-t') + 1]).toBe('60');
    expect(args).toContain('-fflags');
    expect(args[args.indexOf('-fflags') + 1]).toBe('+genpts');
    expect(args).toContain('-avoid_negative_ts');
    expect(args[args.indexOf('-avoid_negative_ts') + 1]).toBe('make_zero');
    expect(args).toContain('-start_number');
    expect(args[args.indexOf('-start_number') + 1]).toBe('100');
    expect(args).toContain('-hls_segment_filename');
    expect(args[args.indexOf('-hls_segment_filename') + 1]).toBe(
      '/tmp/cache/sc1/720p/segment_%03d.ts'
    );
    expect(args).not.toContain('-hls_init_time');
  });

  it('uses VAAPI device init and scale_vaapi for lookahead sessions', () => {
    const args = buildSessionArgs({
      inputPath: '/m/v.mp4',
      profile: PROFILE,
      head: 0,
      mode: 'vaapi',
      segmentDuration: 4,
      outputDir: '/tmp/cache/sc1/720p',
      hwaccelDevice: '/dev/dri/renderD130',
    });
    expect(args).toContain('-vaapi_device');
    expect(args[args.indexOf('-vaapi_device') + 1]).toBe('/dev/dri/renderD130');
    expect(args).toContain('h264_vaapi');
    expect(args).toContain('-vf');
    expect(args[args.indexOf('-vf') + 1]).toBe('format=nv12,hwupload,scale_vaapi=-2:720');
  });
});

describe('selectHwAccelMode', () => {
  it('returns none when requested mode is none', () => {
    const env: HwAccelEnv = { deviceExists: () => true };
    expect(selectHwAccelMode('none', env)).toBe('none');
  });

  it('falls back to none when no device exists in auto mode', () => {
    const env: HwAccelEnv = { deviceExists: () => false };
    expect(selectHwAccelMode('auto', env)).toBe('none');
  });

  it('uses configured DRI device path for VAAPI detection', () => {
    const env: HwAccelEnv = {
      hwaccelDevice: '/dev/dri/renderD129',
      deviceExists: (p) => p === '/dev/dri/renderD129',
    };
    expect(selectHwAccelMode('vaapi', env)).toBe('vaapi');
  });
});
