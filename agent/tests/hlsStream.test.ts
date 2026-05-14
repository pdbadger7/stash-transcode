import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { HLSStream } from '../src/hlsStream.js';
import { DEFAULT_HLS_PROFILES } from '../src/hls/profiles.js';

let cacheDir: string;
let hls: HLSStream;

beforeEach(async () => {
  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hls-'));
  hls = new HLSStream({
    cacheDir,
    ffmpegPath: 'ffmpeg',
    hwaccel: 'none',
    segmentDuration: 4,
    produceSegment: async () => Buffer.from('FAKE_TS_BYTES'),
    sessionSpawn: () => {
      const p: any = new EventEmitter();
      p.kill = vi.fn();
      p.stdout = new EventEmitter();
      p.stderr = new EventEmitter();
      return p;
    },
  });
});

afterEach(async () => {
  hls.shutdown();
  await fs.rm(cacheDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('HLSStream.getMasterPlaylist', () => {
  it('returns a synthetic master playlist with EXT-X-STREAM-INF lines', async () => {
    const m = await hls.getMasterPlaylist('sc1', '/m/v.mp4', undefined, undefined, {
      durationSeconds: 100,
      width: 1920,
      height: 1080,
      fps: 24,
    });
    expect(m).toMatch(/#EXT-X-STREAM-INF/);
    expect(m).toMatch(/\/stash\/scene\/sc1\/variant\/1080p\/master\.m3u8/);
  });
});

describe('HLSStream.getVariantPlaylist', () => {
  it('returns a synthetic VOD playlist immediately without launching ffmpeg', async () => {
    const v = await hls.getVariantPlaylist('sc1', '720p', '/m/v.mp4', undefined, {
      durationSeconds: 10,
    });
    expect(v).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(v).toContain('#EXTINF:4.000,');
    expect(v).toContain('#EXTINF:2.000,');
    expect(v).toContain('segment_002.ts');
    expect(v).toContain('#EXT-X-ENDLIST');
  });

  it('throws a clear error when duration metadata is missing', async () => {
    await expect(
      hls.getVariantPlaylist('sc1', '720p', '/m/v.mp4', undefined, {})
    ).rejects.toThrow(/duration/i);
  });
});

describe('HLSStream.getSegment', () => {
  async function readAsset(asset: { stream: NodeJS.ReadableStream } | null | undefined): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of asset!.stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  it('returns cached bytes when the segment already exists on disk', async () => {
    const target = path.join(cacheDir, 'sc1', '720p', 'segment_005.ts');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from('CACHED'));
    const out = await hls.getSegment({
      sceneId: 'sc1',
      profileId: '720p',
      segmentName: 'segment_005.ts',
      inputPath: '/m/v.mp4',
      sourceMetadata: { durationSeconds: 60 },
    });
    expect(out?.toString()).toBe('CACHED');
  });

  it('returns cached segment assets as streams with content length metadata', async () => {
    const target = path.join(cacheDir, 'sc1', '720p', 'segment_006.ts');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from('CACHED_STREAM'));
    const asset = await hls.getSegmentAsset({
      sceneId: 'sc1',
      profileId: '720p',
      segmentName: 'segment_006.ts',
      inputPath: '/m/v.mp4',
      sourceMetadata: { durationSeconds: 60 },
    });
    expect(asset?.size).toBe('CACHED_STREAM'.length);
    expect((await readAsset(asset)).toString()).toBe('CACHED_STREAM');
  });

  it('produces a missing segment on demand and caches it', async () => {
    const out = await hls.getSegment({
      sceneId: 'sc1',
      profileId: '720p',
      segmentName: 'segment_002.ts',
      inputPath: '/m/v.mp4',
      sourceMetadata: { durationSeconds: 60 },
    });
    expect(out?.toString()).toBe('FAKE_TS_BYTES');
    const onDisk = await fs.readFile(path.join(cacheDir, 'sc1', '720p', 'segment_002.ts'));
    expect(onDisk.toString()).toBe('FAKE_TS_BYTES');
  });

  it('deduplicates concurrent production for the same missing segment', async () => {
    hls.shutdown();
    let release: (() => void) | undefined;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const produceSegment = vi.fn(async () => {
      await blocker;
      return Buffer.from('ONE_JOB');
    });
    hls = new HLSStream({
      cacheDir,
      ffmpegPath: 'ffmpeg',
      hwaccel: 'none',
      segmentDuration: 4,
      sessionWaitMs: 1,
      produceSegment,
      sessionSpawn: () => {
        const p: any = new EventEmitter();
        p.kill = vi.fn();
        p.stdout = new EventEmitter();
        p.stderr = new EventEmitter();
        return p;
      },
    });

    const input = {
      sceneId: 'sc-dedupe',
      profileId: '720p',
      segmentName: 'segment_002.ts',
      inputPath: '/m/v.mp4',
      sourceMetadata: { durationSeconds: 60 },
    };
    const first = hls.getSegmentAsset(input);
    const second = hls.getSegmentAsset(input);
    await Promise.resolve();
    release!();
    const [firstAsset, secondAsset] = await Promise.all([first, second]);

    expect(produceSegment).toHaveBeenCalledTimes(1);
    expect((await readAsset(firstAsset)).toString()).toBe('ONE_JOB');
    expect((await readAsset(secondAsset)).toString()).toBe('ONE_JOB');
  });

  it('produces on-demand segments with the playlist-advertised duration', async () => {
    hls.shutdown();
    const produceSegment = vi.fn(async () => Buffer.from('FULL_SEGMENT'));
    hls = new HLSStream({
      cacheDir,
      ffmpegPath: 'ffmpeg',
      hwaccel: 'none',
      segmentDuration: 4,
      produceSegment,
      sessionSpawn: () => {
        const p: any = new EventEmitter();
        p.kill = vi.fn();
        p.stdout = new EventEmitter();
        p.stderr = new EventEmitter();
        return p;
      },
    });

    await hls.getSegment({
      sceneId: 'sc-full',
      profileId: '720p',
      segmentName: 'segment_001.ts',
      inputPath: '/m/v.mp4',
      sourceMetadata: { durationSeconds: 9 },
    });

    const args = produceSegment.mock.calls[0][0].args;
    expect(args[args.indexOf('-t') + 1]).toBe('4');
  });

  it('rejects out-of-range segment indices', async () => {
    await expect(
      hls.getSegment({
        sceneId: 'sc1',
        profileId: '720p',
        segmentName: 'segment_999.ts',
        inputPath: '/m/v.mp4',
        sourceMetadata: { durationSeconds: 10 },
      })
    ).rejects.toThrow(/out of range/i);
  });

  it('rejects malformed segment names', async () => {
    await expect(
      hls.getSegment({
        sceneId: 'sc1',
        profileId: '720p',
        segmentName: '../etc/passwd',
        inputPath: '/m/v.mp4',
        sourceMetadata: { durationSeconds: 10 },
      })
    ).rejects.toThrow();
  });

  it('falls back after one VAAPI failure without disabling future VAAPI attempts', async () => {
    hls.shutdown();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const produceSegment = vi
      .fn()
      .mockImplementationOnce(async ({ args }) => {
        expect(args).toContain('h264_vaapi');
        throw new Error('vaapi filtergraph failed');
      })
      .mockImplementationOnce(async ({ args }) => {
        expect(args).toContain('libx264');
        return Buffer.from('SOFTWARE_FALLBACK');
      })
      .mockImplementationOnce(async ({ args }) => {
        expect(args).toContain('h264_vaapi');
        return Buffer.from('VAAPI_AGAIN');
      });

    hls = new HLSStream({
      cacheDir,
      ffmpegPath: 'ffmpeg',
      hwaccel: 'vaapi',
      hwaccelDevice: '/dev/dri/renderD129',
      hwaccelDeviceExists: (p) => p === '/dev/dri/renderD129',
      segmentDuration: 4,
      sessionWaitMs: 1,
      produceSegment,
      sessionSpawn: () => {
        const p: any = new EventEmitter();
        p.kill = vi.fn();
        p.stdout = new EventEmitter();
        p.stderr = new EventEmitter();
        setImmediate(() => p.emit('exit', 0));
        return p;
      },
    });

    const first = await hls.getSegment({
      sceneId: 'sc-vaapi-a',
      profileId: '720p',
      segmentName: 'segment_000.ts',
      inputPath: '/m/v.mp4',
      sourceMetadata: { durationSeconds: 12 },
    });
    const second = await hls.getSegment({
      sceneId: 'sc-vaapi-b',
      profileId: '720p',
      segmentName: 'segment_000.ts',
      inputPath: '/m/v.mp4',
      sourceMetadata: { durationSeconds: 12 },
    });

    expect(first?.toString()).toBe('SOFTWARE_FALLBACK');
    expect(second?.toString()).toBe('VAAPI_AGAIN');
    expect(produceSegment).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('falling back to software'));
  });
});
