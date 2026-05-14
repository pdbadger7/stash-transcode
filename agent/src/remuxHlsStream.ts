import { spawn as nodeSpawn, type ChildProcess } from 'child_process';
import { constants as fsConstants, promises as fs } from 'fs';
import path from 'path';
import { getMimeType } from './directStream.js';
import type { SourceVideoMetadata } from './hlsStream.js';
import {
  buildRemuxHlsArgs,
  normalizeVideoCodec,
} from './hls/remuxArgs.js';

type SpawnFn = (cmd: string, args: string[], opts?: object) => ChildProcess;

export interface RemuxHLSConfig {
  cacheDir: string;
  ffmpegPath: string;
  segmentDuration: number;
  allowedVideoCodecs: string[];
  readyTimeoutMs?: number;
  spawn?: SpawnFn;
  enableDebug?: boolean;
}

export interface RemuxPlaylistInput {
  sceneId: string;
  inputPath: string;
  sourceMetadata: SourceVideoMetadata;
  token?: string;
}

export interface RemuxAssetInput {
  sceneId: string;
  assetName: string;
}

export class RemuxNotReadyError extends Error {
  retryAfterSeconds = 2;

  constructor(message = 'Remux HLS is still preparing') {
    super(message);
    this.name = 'RemuxNotReadyError';
  }
}

export class RemuxNotEligibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemuxNotEligibleError';
  }
}

const ASSET_RE = /^(init\.mp4|segment_\d{3,}\.m4s)$/;

export class RemuxHLSStream {
  private readonly spawn: SpawnFn;
  private readonly jobs = new Map<string, Promise<void>>();
  private readonly processes = new Map<string, ChildProcess>();
  private readonly allowedVideoCodecs: Set<string>;
  private readonly readyTimeoutMs: number;

  constructor(private readonly cfg: RemuxHLSConfig) {
    this.spawn = cfg.spawn ?? (nodeSpawn as unknown as SpawnFn);
    this.allowedVideoCodecs = new Set(
      cfg.allowedVideoCodecs.map((codec) => normalizeVideoCodec(codec)).filter(Boolean) as string[]
    );
    this.readyTimeoutMs = cfg.readyTimeoutMs ?? 30_000;
  }

  canRemux(source: SourceVideoMetadata): boolean {
    const codec = normalizeVideoCodec(source.videoCodec);
    return codec !== undefined && this.allowedVideoCodecs.has(codec);
  }

  async getPlaylist(input: RemuxPlaylistInput): Promise<string> {
    this.assertEligible(input.sourceMetadata);
    const outputDir = this.outputDir(input.sceneId);
    const playlistPath = path.join(outputDir, 'master.m3u8');

    const { job } = await this.ensureRemux(input.sceneId, input.inputPath, input.sourceMetadata);
    if (!(await waitForFileOrJob(playlistPath, this.readyTimeoutMs, job))) {
      throw new RemuxNotReadyError();
    }

    const playlist = await fs.readFile(playlistPath, 'utf8');
    return rewritePlaylistUris(playlist, input.sceneId, input.token);
  }

  async getAsset(input: RemuxAssetInput): Promise<Buffer | null> {
    if (!ASSET_RE.test(input.assetName)) {
      throw new Error(`Invalid remux asset name: ${input.assetName}`);
    }

    const assetPath = path.join(this.outputDir(input.sceneId), input.assetName);
    if (!(await waitForFile(assetPath, this.readyTimeoutMs))) {
      if (this.jobs.has(input.sceneId)) throw new RemuxNotReadyError();
      return null;
    }

    return fs.readFile(assetPath);
  }

  getPlaylistMimeType(): string {
    return getMimeType('master.m3u8');
  }

  getAssetMimeType(assetName: string): string {
    return getMimeType(assetName);
  }

  shutdown(): void {
    for (const proc of this.processes.values()) {
      try {
        proc.kill('SIGTERM');
      } catch {}
    }
    this.processes.clear();
    this.jobs.clear();
  }

  private assertEligible(source: SourceVideoMetadata): void {
    const codec = normalizeVideoCodec(source.videoCodec);
    if (!codec) {
      throw new RemuxNotEligibleError('Cannot remux HLS: source video codec is unknown');
    }
    if (!this.allowedVideoCodecs.has(codec)) {
      throw new RemuxNotEligibleError(`Cannot remux HLS: source video codec ${codec} is not allowed`);
    }
  }

  private async ensureRemux(
    sceneId: string,
    inputPath: string,
    sourceMetadata: SourceVideoMetadata
  ): Promise<{ job?: Promise<void> }> {
    if (await this.isComplete(sceneId)) return {};

    const existing = this.jobs.get(sceneId);
    if (existing) return { job: existing };

    const job = this.startRemux(sceneId, inputPath, sourceMetadata);
    this.jobs.set(sceneId, job);
    job.finally(() => this.jobs.delete(sceneId)).catch(() => undefined);
    return { job };
  }

  private async startRemux(
    sceneId: string,
    inputPath: string,
    sourceMetadata: SourceVideoMetadata
  ): Promise<void> {
    const outputDir = this.outputDir(sceneId);
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.mkdir(outputDir, { recursive: true });

    const args = buildRemuxHlsArgs({
      inputPath,
      outputDir,
      segmentDuration: this.cfg.segmentDuration,
      videoCodec: sourceMetadata.videoCodec,
    });

    if (this.cfg.enableDebug) {
      console.debug(`[HLS] starting remux scene=${sceneId} codec=${sourceMetadata.videoCodec ?? 'unknown'}`);
    }

    try {
      await runFfmpeg(this.spawn, this.cfg.ffmpegPath, args, (proc) => {
        this.processes.set(sceneId, proc);
      });
    } finally {
      this.processes.delete(sceneId);
    }
  }

  private async isComplete(sceneId: string): Promise<boolean> {
    const playlistPath = path.join(this.outputDir(sceneId), 'master.m3u8');
    try {
      const playlist = await fs.readFile(playlistPath, 'utf8');
      return playlist.includes('#EXT-X-ENDLIST');
    } catch {
      return false;
    }
  }

  private outputDir(sceneId: string): string {
    return path.join(this.cfg.cacheDir, 'remux', Buffer.from(sceneId).toString('base64url'));
  }
}

function rewritePlaylistUris(playlist: string, sceneId: string, token?: string): string {
  return playlist
    .split('\n')
    .map((line) => {
      if (line.startsWith('#EXT-X-MAP:')) {
        return line.replace(/URI="([^"]+)"/, (_match, assetName: string) => {
          return `URI="${withToken(`/stash/scene/${sceneId}/remux/${assetName}`, token)}"`;
        });
      }
      if (line && !line.startsWith('#')) {
        return withToken(`/stash/scene/${sceneId}/remux/${line}`, token);
      }
      return line;
    })
    .join('\n');
}

function withToken(uri: string, token?: string): string {
  if (!token) return uri;
  const sep = uri.includes('?') ? '&' : '?';
  return `${uri}${sep}token=${encodeURIComponent(token)}`;
}

async function waitForFile(filePath: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      await fs.access(filePath, fsConstants.R_OK);
      return true;
    } catch {
      if (Date.now() >= deadline) return false;
      await sleep(75);
    }
  }
  return false;
}

async function waitForFileOrJob(
  filePath: string,
  timeoutMs: number,
  job?: Promise<void>
): Promise<boolean> {
  if (!job) return waitForFile(filePath, timeoutMs);
  const ready = waitForFile(filePath, timeoutMs);
  const result = await Promise.race([
    ready,
    job.then(
      async () => waitForFile(filePath, 0),
      (err) => {
        throw err;
      }
    ),
  ]);
  return result;
}

function runFfmpeg(
  spawn: SpawnFn,
  ffmpegPath: string,
  args: string[],
  onProcess?: (proc: ChildProcess) => void
): Promise<void> {
  const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  onProcess?.(proc);
  return new Promise((resolve, reject) => {
    const errChunks: Buffer[] = [];
    proc.stderr?.on('data', (chunk: Buffer) => errChunks.push(chunk));
    proc.on('error', reject);
    proc.on('exit', (code, sig) => {
      if (code === 0) {
        resolve();
        return;
      }
      const stderr = Buffer.concat(errChunks).toString('utf-8').slice(0, 4_000);
      reject(new Error(`ffmpeg remux exit code ${code} signal ${sig}: ${stderr}`));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
