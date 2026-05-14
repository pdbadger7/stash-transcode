import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_HLS_PROFILES,
  HLSStream,
  VariantPlaylistNotReadyError,
} from '../src/hlsStream';
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
      variantPlaylistWaitMs: 50,
      variantPlaylistPollMs: 10,
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
    expect(playlist).toContain('/stash/scene/scene-123/variant/4320p/master.m3u8');
    expect(playlist).toContain('/stash/scene/scene-123/variant/2160p/master.m3u8');
    expect(playlist).toContain('/stash/scene/scene-123/variant/1440p/master.m3u8');
    expect(playlist).toContain('/stash/scene/scene-123/variant/1080p/master.m3u8');
    expect(playlist).toContain('/stash/scene/scene-123/variant/720p/master.m3u8');
  });

  it('should only advertise variants that do not exceed source resolution', async () => {
    const playlist = await hlsStream.getMasterPlaylist(
      'scene-123',
      '/input/video.mkv',
      undefined,
      undefined,
      { width: 2560, height: 1440 }
    );

    expect(playlist).toContain('/stash/scene/scene-123/variant/1440p/master.m3u8');
    expect(playlist).toContain('/stash/scene/scene-123/variant/1080p/master.m3u8');
    expect(playlist).not.toContain('/stash/scene/scene-123/variant/2160p/master.m3u8');
    expect(playlist).not.toContain('/stash/scene/scene-123/variant/4320p/master.m3u8');
  });

  it('should clamp variant resolution and expose source fps in master playlist', async () => {
    const playlist = await hlsStream.getMasterPlaylist(
      'scene-123',
      '/input/video.mkv',
      undefined,
      undefined,
      {
        width: 1280,
        height: 720,
        fps: 23.976,
      }
    );

    expect(playlist).not.toContain('RESOLUTION=1920x1080');
    expect(playlist).toContain('RESOLUTION=1280x720');
    expect(playlist).toContain('FRAME-RATE=23.976');
  });

  it('should throw while variant playlist has no segments yet', async () => {
    await expect(
      hlsStream.getVariantPlaylist(
        'scene-123',
        '720p',
        '/input/video.mkv'
      )
    ).rejects.toBeInstanceOf(VariantPlaylistNotReadyError);
  });

  it('should generate a synthetic VOD playlist from duration metadata while transcoding starts', async () => {
    const playlist = await hlsStream.getVariantPlaylist(
      'scene-123',
      '720p',
      '/input/video.mkv',
      undefined,
      { durationSeconds: 10 }
    );

    expect(playlist).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(playlist).toContain('#EXT-X-ENDLIST');
    expect(playlist).toContain('/stash/scene/scene-123/variant/720p/segment_000.ts');
    expect(playlist).toContain('/stash/scene/scene-123/variant/720p/segment_002.ts');
    expect(playlist.match(/#EXTINF:/g)?.length).toBe(3);
  });

  it('should rewrite variant playlist segment URIs to absolute variant paths', async () => {
    const sceneDir = path.join(tmpDir, 'scene-123', '720p');
    await fs.promises.mkdir(sceneDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(sceneDir, 'master.m3u8'),
      ['#EXTM3U', '#EXTINF:4.000,', 'segment_000.ts'].join('\n')
    );

    const playlist = await hlsStream.getVariantPlaylist(
      'scene-123',
      '720p',
      '/input/video.mkv'
    );

    expect(playlist).toContain(
      '/stash/scene/scene-123/variant/720p/segment_000.ts'
    );
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
    const profile720 = DEFAULT_HLS_PROFILES.find((profile) => profile.id === '720p');
    if (!profile720) {
      throw new Error('720p profile missing');
    }
    const args = hlsStream['buildFFmpegArgs']('/input/video.mkv', tmpDir, profile720, 'none');
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
    expect(args).toContain('-hls_playlist_type');
    expect(args).toContain('vod');
    expect(args).toContain('-hls_init_time');
    expect(args).toContain('1');
    expect(args).toContain('-force_key_frames');
    expect(args).toContain('expr:gte(t,n_forced*4)');
  });

  it('should place hardware args before the input and use h264 encoders', () => {
    const profile1080 = DEFAULT_HLS_PROFILES.find((profile) => profile.id === '1080p');
    if (!profile1080) {
      throw new Error('1080p profile missing');
    }
    const args = hlsStream['buildFFmpegArgs']('/input/video.mkv', tmpDir, profile1080, 'vaapi');
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
