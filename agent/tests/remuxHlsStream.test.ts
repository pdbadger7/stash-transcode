import { describe, expect, it, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  RemuxHLSStream,
  RemuxNotEligibleError,
} from '../src/remuxHlsStream.js';

function makeProc() {
  const p: any = new EventEmitter();
  p.stderr = new EventEmitter();
  p.kill = vi.fn();
  return p;
}

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'remux-hls-'));
}

describe('RemuxHLSStream', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('starts a copy-only remux and rewrites playlist asset URLs with token', async () => {
    const cacheDir = await makeTempDir();
    dirs.push(cacheDir);
    const spawn = vi.fn((_: string, args: string[]) => {
      const proc = makeProc();
      const segmentPattern = args[args.indexOf('-hls_segment_filename') + 1];
      const outputDir = path.dirname(segmentPattern);
      setImmediate(async () => {
        await fs.mkdir(outputDir, { recursive: true });
        await fs.writeFile(path.join(outputDir, 'init.mp4'), Buffer.from('INIT'));
        await fs.writeFile(path.join(outputDir, 'segment_000.m4s'), Buffer.from('SEG0'));
        await fs.writeFile(
          path.join(outputDir, 'master.m3u8'),
          [
            '#EXTM3U',
            '#EXT-X-VERSION:7',
            '#EXT-X-MAP:URI="init.mp4"',
            '#EXTINF:4.000,',
            'segment_000.m4s',
            '#EXT-X-ENDLIST',
            '',
          ].join('\n')
        );
        proc.emit('exit', 0, null);
      });
      return proc;
    });

    const remux = new RemuxHLSStream({
      cacheDir,
      ffmpegPath: 'ffmpeg',
      segmentDuration: 4,
      allowedVideoCodecs: ['h264', 'hevc'],
      readyTimeoutMs: 1000,
      spawn,
    });

    const playlist = await remux.getPlaylist({
      sceneId: 'sc1',
      inputPath: '/m/v.mp4',
      sourceMetadata: { durationSeconds: 10, videoCodec: 'hevc' },
      token: 'tok',
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    const args = spawn.mock.calls[0][1];
    expect(args).toContain('-c:v');
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
    expect(args).toContain('-tag:v');
    expect(args[args.indexOf('-tag:v') + 1]).toBe('hvc1');
    expect(playlist).toContain('/stash/scene/sc1/remux/init.mp4?token=tok');
    expect(playlist).toContain('/stash/scene/sc1/remux/segment_000.m4s?token=tok');

    const asset = await remux.getAsset({ sceneId: 'sc1', assetName: 'segment_000.m4s' });
    expect(asset?.toString()).toBe('SEG0');
  });

  it('rejects sources whose video codec is not allowlisted', async () => {
    const cacheDir = await makeTempDir();
    dirs.push(cacheDir);
    const remux = new RemuxHLSStream({
      cacheDir,
      ffmpegPath: 'ffmpeg',
      segmentDuration: 4,
      allowedVideoCodecs: ['h264'],
      readyTimeoutMs: 1,
      spawn: vi.fn(),
    });

    await expect(
      remux.getPlaylist({
        sceneId: 'sc1',
        inputPath: '/m/v.mp4',
        sourceMetadata: { durationSeconds: 10, videoCodec: 'hevc' },
      })
    ).rejects.toBeInstanceOf(RemuxNotEligibleError);
  });

  it('rejects invalid asset names', async () => {
    const cacheDir = await makeTempDir();
    dirs.push(cacheDir);
    const remux = new RemuxHLSStream({
      cacheDir,
      ffmpegPath: 'ffmpeg',
      segmentDuration: 4,
      allowedVideoCodecs: ['h264'],
      readyTimeoutMs: 1,
      spawn: vi.fn(),
    });

    await expect(
      remux.getAsset({ sceneId: 'sc1', assetName: '../segment_000.m4s' })
    ).rejects.toThrow(/invalid remux asset/i);
  });
});
