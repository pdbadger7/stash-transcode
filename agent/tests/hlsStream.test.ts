import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HLSStream } from '../src/hlsStream';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('HLSStream', () => {
  let tmpDir: string;
  let hlsStream: HLSStream;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hls-test-'));
    hlsStream = new HLSStream({
      cacheDir: tmpDir,
      ffmpegPath: '/usr/bin/ffmpeg',
      hwaccel: 'none',
      segmentDuration: 4,
      enableDebug: false,
    });
  });

  afterEach(async () => {
    // Cleanup
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  it('should generate an abr master playlist with quality variants', async () => {
    const playlist = await hlsStream.getMasterPlaylist(
      'scene-123',
      '/input/video.mkv'
    );
    expect(playlist).toContain('#EXTM3U');
    expect(playlist).toContain('#EXT-X-STREAM-INF');
    expect(playlist).toContain('/stash/scene/scene-123/variant/1080p/master.m3u8');
    expect(playlist).toContain('/stash/scene/scene-123/variant/720p/master.m3u8');
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
    await fs.mkdir(sceneDir, { recursive: true });

    const segmentData = Buffer.from('fake segment data');
    const segmentPath = path.join(sceneDir, 'segment_000.ts');
    await fs.writeFile(segmentPath, segmentData);

    const result = await hlsStream.getSegment(
      'scene-123',
      '720p',
      'segment_000.ts'
    );
    expect(result).toEqual(segmentData);
  });

  it('should build ffmpeg args for no hardware acceleration', () => {
    const args = hlsStream['buildFFmpegArgs']('/input/video.mkv', tmpDir, {
      id: '720p',
      label: '720p',
      width: 1280,
      height: 720,
      videoBitrateKbps: 2500,
      bandwidthKbps: 3000,
    });
    expect(args).toContain('-i');
    expect(args).toContain('/input/video.mkv');
    expect(args).toContain('-c:v');
    expect(args).toContain('libx264');
    expect(args).toContain('-vf');
    expect(args).toContain('scale=-2:720');
    expect(args).toContain('-b:v');
    expect(args).toContain('2500k');
    expect(args).toContain('-f');
    expect(args).toContain('hls');
  });

  it('should build ffmpeg args for hardware acceleration', () => {
    const accelerated = new HLSStream({
      cacheDir: tmpDir,
      ffmpegPath: '/usr/bin/ffmpeg',
      hwaccel: 'nvenc',
      segmentDuration: 4,
      enableDebug: false,
    });

    const args = accelerated['buildFFmpegArgs']('/input/video.mkv', tmpDir, {
      id: '1080p',
      label: '1080p',
      width: 1920,
      height: 1080,
      videoBitrateKbps: 6000,
      bandwidthKbps: 6800,
    });
    expect(args).toContain('-c:v');
    expect(args).toContain('h264_nvenc');
  });

  it('should get active transcodes', () => {
    const transcodes = hlsStream.getActiveTranscodes();
    expect(Array.isArray(transcodes)).toBe(true);
  });

  it('should handle cleanup of old caches', async () => {
    // Create some test directories
    const oldDir = path.join(tmpDir, 'old-scene', '720p');
    const newDir = path.join(tmpDir, 'new-scene', '720p');

    await fs.mkdir(oldDir, { recursive: true });
    await fs.mkdir(newDir, { recursive: true });

    // This should not throw
    await expect(hlsStream.cleanupOldTranscodes(0)).resolves.not.toThrow();
  });
});
