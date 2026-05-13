import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULT_HLS_PROFILES, HLSStream } from '../src/hlsStream';
import * as fs from 'fs';
import path from 'path';
import os from 'os';

describe('HLSStream', () => {
  let tmpDir: string;
  let hlsStream: HLSStream;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hls-test-'));
    hlsStream = new HLSStream({
      cacheDir: tmpDir,
      ffmpegPath: '/usr/bin/ffmpeg',
      hwaccel: 'auto',
      segmentDuration: 4,
      enableDebug: false,
      hardwareAccelProbe: () => false,
    });
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    vi.restoreAllMocks();
  });

  it('should generate a master playlist with quality variants', async () => {
    const playlist = await hlsStream.getMasterPlaylist(
      'scene-123',
      '/input/video.mkv'
    );
    expect(playlist).toContain('#EXTM3U');
    expect(playlist).toContain('#EXT-X-STREAM-INF');
    expect(playlist).toContain('/stash/scene/scene-123/variant/1080p/master.m3u8');
    expect(playlist).toContain('/stash/scene/scene-123/variant/720p/master.m3u8');
  });

  it('should generate a placeholder variant playlist', async () => {
    const playlist = await hlsStream.getVariantPlaylist(
      'scene-123',
      '720p',
      '/input/video.mkv'
    );
    expect(playlist).toContain('#EXTM3U');
    expect(playlist).toContain('#EXT-X-TARGETDURATION:4');
    expect(playlist).toContain('720p transcoding in progress');
  });

  it('should prevent path traversal in segment names', async () => {
    const result = await hlsStream.getSegment(
      'scene-123',
      '720p',
      '../../../etc/passwd'
    );
    expect(result).toBeNull();
  });

  it('should prevent absolute paths in segment names', async () => {
    const result = await hlsStream.getSegment('scene-123', '720p', '/etc/passwd');
    expect(result).toBeNull();
  });

  it('should return null for non-existent segments', async () => {
    const result = await hlsStream.getSegment(
      'scene-123',
      '720p',
      'segment_000.ts'
    );
    expect(result).toBeNull();
  });

  it('should read existing segments', async () => {
    const sceneDir = path.join(tmpDir, 'scene-123', '720p');
    await fs.promises.mkdir(sceneDir, { recursive: true });

    const segmentData = Buffer.from('fake segment data');
    const segmentPath = path.join(sceneDir, 'segment_000.ts');
    await fs.promises.writeFile(segmentPath, segmentData);

    const result = await hlsStream.getSegment(
      'scene-123',
      '720p',
      'segment_000.ts'
    );
    expect(result).toEqual(segmentData);
  });

  it('should build ffmpeg args for no hardware acceleration', () => {
    const args = hlsStream['buildFFmpegArgs']('/input/video.mkv', tmpDir, DEFAULT_HLS_PROFILES[1], 'none');
    expect(args).toContain('-i');
    expect(args).toContain('/input/video.mkv');
    expect(args).toContain('-c:v');
    expect(args).toContain('libx264');
    expect(args).toContain('-vf');
    expect(args).toContain('scale=-2:720');
    expect(args).toContain('-b:v');
    expect(args).toContain('3500k');
    expect(args).toContain('-f');
    expect(args).toContain('hls');
  });

  it('should place hardware args before the input and use h264 encoders', () => {
    const args = hlsStream['buildFFmpegArgs']('/input/video.mkv', tmpDir, DEFAULT_HLS_PROFILES[0], 'vaapi');
    const hwIndex = args.indexOf('-hwaccel');
    const inputIndex = args.indexOf('-i');

    expect(hwIndex).toBeGreaterThanOrEqual(0);
    expect(inputIndex).toBeGreaterThan(hwIndex);
    expect(args).toContain('h264_vaapi');
  });

  it('should fall back to software when no hardware device is available', () => {
    expect(hlsStream['selectHwAccelMode']()).toBe('none');
  });

  it('should get active transcodes', () => {
    expect(Array.isArray(hlsStream.getActiveTranscodes())).toBe(true);
  });

  it('should expose playlist and segment mime types', () => {
    expect(hlsStream.getPlaylistMimeType()).toBe('application/vnd.apple.mpegurl');
    expect(hlsStream.getSegmentMimeType('segment_000.ts')).toBe('video/mp2t');
  });

  it('should handle cleanup of old caches', async () => {
    const oldDir = path.join(tmpDir, 'old-scene', '720p');
    const newDir = path.join(tmpDir, 'new-scene', '720p');

    await fs.promises.mkdir(oldDir, { recursive: true });
    await fs.promises.mkdir(newDir, { recursive: true });

    await expect(hlsStream.cleanupOldTranscodes(0)).resolves.not.toThrow();
  });
});
