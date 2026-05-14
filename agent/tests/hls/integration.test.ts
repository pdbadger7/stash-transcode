import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import os from 'os';
import { HLSStream } from '../../src/hlsStream.js';

const ffmpegAvailable = spawnSync('ffmpeg', ['-version']).status === 0;
const maybeDescribe = ffmpegAvailable ? describe : describe.skip;

maybeDescribe('HLS integration', () => {
  let dir: string;
  let source: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hls-int-'));
    source = path.join(dir, 'src.mp4');
    const res = spawnSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc=duration=20:size=320x240:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
      source,
    ]);
    expect(res.status).toBe(0);
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('produces a valid MPEG-TS segment for an arbitrary middle index', async () => {
    const hls = new HLSStream({
      cacheDir: path.join(dir, 'cache'),
      ffmpegPath: 'ffmpeg',
      hwaccel: 'none',
      segmentDuration: 4,
    });
    try {
      const bytes = await hls.getSegment({
        sceneId: 'sc1',
        profileId: '480p',
        segmentName: 'segment_003.ts',
        inputPath: source,
        sourceMetadata: { durationSeconds: 20, width: 320, height: 240, fps: 30 },
      });
      expect(bytes).toBeTruthy();
      expect(bytes!.length).toBeGreaterThan(1000);
      expect(bytes!.readUInt8(0)).toBe(0x47);
    } finally {
      hls.shutdown();
    }
  }, 30_000);

  it('synthetic variant playlist segment count matches what is producible', async () => {
    const hls = new HLSStream({
      cacheDir: path.join(dir, 'cache2'),
      ffmpegPath: 'ffmpeg',
      hwaccel: 'none',
      segmentDuration: 4,
    });
    try {
      const playlist = await hls.getVariantPlaylist('sc1', '480p', source, undefined, {
        durationSeconds: 20,
      });
      const segLines = playlist.split('\n').filter((l) => l.endsWith('.ts'));
      expect(segLines).toHaveLength(5);
    } finally {
      hls.shutdown();
    }
  });
});
