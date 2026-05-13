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

  it('should generate placeholder playlist', async () => {
    const playlist = hlsStream['generatePlaceholderPlaylist']('scene-123');
    expect(playlist).toContain('#EXTM3U');
    expect(playlist).toContain('#EXT-X-VERSION:3');
    expect(playlist).toContain('#EXT-X-TARGETDURATION:4');
  });

  it('should prevent path traversal in segment names', async () => {
    const result = await hlsStream.getSegment('scene-123', '../../../etc/passwd');
    expect(result).toBeNull();
  });

  it('should prevent absolute paths in segment names', async () => {
    const result = await hlsStream.getSegment('scene-123', '/etc/passwd');
    expect(result).toBeNull();
  });

  it('should return null for non-existent segments', async () => {
    const result = await hlsStream.getSegment('scene-123', 'segment_000.ts');
    expect(result).toBeNull();
  });

  it('should read existing segments', async () => {
    const sceneDir = path.join(tmpDir, 'scene-123');
    await fs.mkdir(sceneDir, { recursive: true });

    const segmentData = Buffer.from('fake segment data');
    const segmentPath = path.join(sceneDir, 'segment_000.ts');
    await fs.writeFile(segmentPath, segmentData);

    const result = await hlsStream.getSegment('scene-123', 'segment_000.ts');
    expect(result).toEqual(segmentData);
  });

  it('should build ffmpeg args for no hardware acceleration', () => {
    const args = hlsStream['buildFFmpegArgs']('/input/video.mkv', tmpDir);
    expect(args).toContain('-i');
    expect(args).toContain('/input/video.mkv');
    expect(args).toContain('-c:v');
    expect(args).toContain('libx264');
    expect(args).toContain('-f');
    expect(args).toContain('hls');
  });

  it('should get active transcodes', () => {
    const transcodes = hlsStream.getActiveTranscodes();
    expect(Array.isArray(transcodes)).toBe(true);
  });

  it('should handle cleanup of old caches', async () => {
    // Create some test directories
    const oldDir = path.join(tmpDir, 'old-scene');
    const newDir = path.join(tmpDir, 'new-scene');

    await fs.mkdir(oldDir, { recursive: true });
    await fs.mkdir(newDir, { recursive: true });

    // This should not throw
    await expect(hlsStream.cleanupOldTranscodes(0)).resolves.not.toThrow();
  });
});
