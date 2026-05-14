import { promises as fs, type ReadStream } from 'fs';
import { SegmentCache } from './hls/segmentCache.js';
import { SessionManager, type SpawnFn } from './hls/sessionManager.js';
import {
  produceSegment as defaultProduceSegment,
  produceSegmentToFile as defaultProduceSegmentToFile,
  type ProduceSegmentInput,
  type ProduceSegmentToFileInput,
} from './hls/segmentProducer.js';
import {
  buildMasterPlaylist,
  buildVariantPlaylist,
  computeSegmentPlan,
} from './hls/playlist.js';
import {
  buildSessionArgs,
  buildSingleSegmentArgs,
  defaultHwAccelEnv,
  selectHwAccel,
  type HwAccelSelection,
  type RequestedHwAccel,
  type ResolvedHwAccelMode,
} from './hls/ffmpegArgs.js';
import { DEFAULT_HLS_PROFILES } from './hls/profiles.js';
import { getMimeType } from './directStream.js';
import type { HLSProfile } from './types.js';

export { DEFAULT_HLS_PROFILES };

export interface SourceVideoMetadata {
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
}

export interface HLSConfig {
  cacheDir: string;
  ffmpegPath: string;
  hwaccel: RequestedHwAccel;
  segmentDuration: number;
  enableDebug?: boolean;
  profiles?: HLSProfile[];
  lookaheadSegments?: number;
  maxSessions?: number;
  singleSegmentTimeoutMs?: number;
  hwaccelDevice?: string;
  hwaccelDeviceExists?: (path: string) => boolean;
  sessionWaitMs?: number;
  produceSegment?: (input: ProduceSegmentInput) => Promise<Buffer>;
  produceSegmentToFile?: (input: ProduceSegmentToFileInput) => Promise<void>;
  sessionSpawn?: SpawnFn;
}

export interface GetSegmentInput {
  sceneId: string;
  profileId: string;
  segmentName: string;
  inputPath: string;
  sourceMetadata: SourceVideoMetadata;
  abortSignal?: AbortSignal;
}

export interface SegmentAsset {
  stream: ReadStream;
  size: number;
}

const SEGMENT_RE = /^segment_(\d{3,})\.ts$/;

export class HLSStream {
  private readonly profiles: HLSProfile[];
  private readonly cache: SegmentCache;
  private readonly sessions: SessionManager;
  private readonly produceSegmentFn: (input: ProduceSegmentInput) => Promise<Buffer>;
  private readonly produceSegmentToFileFn: (input: ProduceSegmentToFileInput) => Promise<void>;
  private readonly inFlightSegments = new Map<string, Promise<void>>();
  private readonly enableDebug: boolean;
  private readonly cfg: {
    segmentDuration: number;
    lookaheadSegments: number;
    maxSessions: number;
    singleSegmentTimeoutMs: number;
    sessionWaitMs: number;
    ffmpegPath: string;
    hwaccel: RequestedHwAccel;
    hwaccelDevice?: string;
    hwaccelDeviceExists?: (path: string) => boolean;
    cacheDir: string;
  };

  constructor(config: HLSConfig) {
    this.profiles = config.profiles ?? DEFAULT_HLS_PROFILES;
    this.cache = new SegmentCache(config.cacheDir);
    this.enableDebug = config.enableDebug ?? false;
    this.produceSegmentFn = config.produceSegment ?? defaultProduceSegment;
    this.produceSegmentToFileFn = config.produceSegmentToFile ?? defaultProduceSegmentToFile;
    this.cfg = {
      segmentDuration: config.segmentDuration || 4,
      lookaheadSegments: config.lookaheadSegments ?? 15,
      maxSessions: config.maxSessions ?? 4,
      singleSegmentTimeoutMs: config.singleSegmentTimeoutMs ?? 45_000,
      sessionWaitMs: config.sessionWaitMs ?? 1_500,
      ffmpegPath: config.ffmpegPath,
      hwaccel: config.hwaccel,
      hwaccelDevice: config.hwaccelDevice,
      hwaccelDeviceExists: config.hwaccelDeviceExists,
      cacheDir: config.cacheDir,
    };
    this.sessions = new SessionManager({
      ffmpegPath: config.ffmpegPath,
      segmentDuration: this.cfg.segmentDuration,
      lookaheadSegments: this.cfg.lookaheadSegments,
      maxSessions: this.cfg.maxSessions,
      spawn: config.sessionSpawn,
      buildArgs: buildSessionArgs,
      outputDirFor: (sceneId, profileId) => this.cache.profileDir(sceneId, profileId),
      enableDebug: this.enableDebug,
      hwaccelDevice: config.hwaccelDevice,
    });
  }

  async getMasterPlaylist(
    sceneId: string,
    _inputPath: string,
    preferredQuality?: string,
    token?: string,
    source?: SourceVideoMetadata
  ): Promise<string> {
    return buildMasterPlaylist({
      sceneId,
      profiles: this.profiles,
      source,
      preferredProfileId: preferredQuality,
      token,
    });
  }

  async getVariantPlaylist(
    sceneId: string,
    profileId: string,
    _inputPath: string,
    token?: string,
    source?: SourceVideoMetadata
  ): Promise<string> {
    this.resolveProfile(profileId);
    const duration = source?.durationSeconds;
    if (!duration || duration <= 0) {
      throw new Error(`Cannot build variant playlist: missing duration for scene ${sceneId}`);
    }
    return buildVariantPlaylist({
      sceneId,
      profileId,
      durationSeconds: duration,
      segmentDuration: this.cfg.segmentDuration,
      token,
    });
  }

  async getSegment(input: GetSegmentInput): Promise<Buffer | null> {
    const asset = await this.getSegmentAsset(input);
    if (!asset) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of asset.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async getSegmentAsset(input: GetSegmentInput): Promise<SegmentAsset | null> {
    const profile = this.resolveProfile(input.profileId);
    const index = this.parseSegmentName(input.segmentName);
    const duration = input.sourceMetadata.durationSeconds;
    if (!duration || duration <= 0) {
      throw new Error('Cannot serve segment: source duration unknown');
    }
    const plan = computeSegmentPlan({
      durationSeconds: duration,
      segmentDuration: this.cfg.segmentDuration,
    });
    if (index >= plan.count) {
      throw new Error(`segment ${index} out of range (count=${plan.count})`);
    }

    const cached = await this.cache.openAsset(input.sceneId, input.profileId, index);
    if (cached) {
      return cached;
    }

    const startSeconds = index * this.cfg.segmentDuration;
    const segDuration = plan.durations[index];

    const sessionHit = await this.waitForSessionSegment(
      input.sceneId,
      input.profileId,
      index,
      input.abortSignal
    );
    if (sessionHit) return sessionHit;

    const selection = this.selectHwAccel();
    const mode = selection.mode;
    if (this.enableDebug) {
      console.debug(
        `[HLS] selected hw mode=${mode}${selection.hwaccelDevice ? ` device=${selection.hwaccelDevice}` : ''} scene=${input.sceneId} profile=${input.profileId} segment=${index}`
      );
    }
    let sessionMode: ResolvedHwAccelMode = mode;
    const key = `${input.sceneId}:${input.profileId}:${index}`;
    let job = this.inFlightSegments.get(key);
    if (!job) {
      job = this.produceSegmentToCache({
        input,
        profile,
        index,
        startSeconds,
        durationSeconds: segDuration,
        mode,
        selection,
        onFallback: () => {
          sessionMode = 'none';
        },
      });
      this.inFlightSegments.set(key, job);
      job.finally(() => this.inFlightSegments.delete(key)).catch(() => undefined);
    }
    await job;

    if (index + 1 < plan.count) {
      this.sessions.noteRequest({
        sceneId: input.sceneId,
        profileId: input.profileId,
        index,
        inputPath: input.inputPath,
        profile,
        mode: sessionMode,
        hwaccelDevice: selection.hwaccelDevice,
      });
    }

    return this.cache.openAsset(input.sceneId, input.profileId, index);
  }

  getActiveTranscodes() {
    return this.sessions.activeSessions();
  }

  getPlaylistMimeType(): string {
    return getMimeType('master.m3u8');
  }

  getSegmentMimeType(segmentName: string): string {
    return getMimeType(segmentName);
  }

  async cleanupOldTranscodes(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
    await this.cache.cleanup(maxAgeMs, (sceneId, profileId) =>
      this.sessions.isInUse(sceneId, profileId)
    );
  }

  shutdown(): void {
    this.sessions.shutdown();
  }

  private async waitForSessionSegment(
    sceneId: string,
    profileId: string,
    index: number,
    signal?: AbortSignal
  ): Promise<SegmentAsset | null> {
    if (!this.sessions.canProduce(sceneId, profileId, index)) {
      this.sessions.killStaleForSceneProfile(sceneId, profileId, index);
      return null;
    }
    return this.cache.waitForAsset(sceneId, profileId, index, this.cfg.sessionWaitMs, signal);
  }

  private async produceSegmentToCache(input: {
    input: GetSegmentInput;
    profile: HLSProfile;
    index: number;
    startSeconds: number;
    durationSeconds: number;
    mode: ResolvedHwAccelMode;
    selection: HwAccelSelection;
    onFallback: () => void;
  }): Promise<void> {
    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => timeoutCtrl.abort(), this.cfg.singleSegmentTimeoutMs);
    const composite = anyAbort([timeoutCtrl.signal, input.input.abortSignal]);
    try {
      try {
        await this.produceSingleSegmentFile(input, input.mode, composite);
      } catch (err) {
        if (input.mode !== 'none' && !timeoutCtrl.signal.aborted) {
          console.warn(
            `[HLS] hw mode ${input.mode} failed for scene=${input.input.sceneId} profile=${input.input.profileId} segment=${input.index}; falling back to software: ${formatErrorReason(err)}`
          );
          input.onFallback();
          await this.produceSingleSegmentFile(input, 'none', composite);
        } else {
          throw err;
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async produceSingleSegmentFile(
    input: {
      input: GetSegmentInput;
      profile: HLSProfile;
      index: number;
      startSeconds: number;
      durationSeconds: number;
      selection: HwAccelSelection;
    },
    mode: ResolvedHwAccelMode,
    signal: AbortSignal
  ): Promise<void> {
    const args = buildSingleSegmentArgs({
      inputPath: input.input.inputPath,
      profile: input.profile,
      startSeconds: input.startSeconds,
      durationSeconds: input.durationSeconds,
      mode,
      segmentDuration: this.cfg.segmentDuration,
      hwaccelDevice: input.selection.hwaccelDevice,
      sourceVideoCodec: input.input.sourceMetadata.videoCodec,
    });

    await this.cache.produceAtomic(
      input.input.sceneId,
      input.input.profileId,
      input.index,
      async (tmpPath) => {
        if (this.produceSegmentFn !== defaultProduceSegment) {
          const bytes = await this.produceSegmentFn({
            ffmpegPath: this.cfg.ffmpegPath,
            args,
            signal,
          });
          await fs.writeFile(tmpPath, bytes);
          return;
        }
        await this.produceSegmentToFileFn({
          ffmpegPath: this.cfg.ffmpegPath,
          args,
          outputPath: tmpPath,
          signal,
        });
      }
    );
  }

  private parseSegmentName(name: string): number {
    if (name.includes('/') || name.includes('..')) {
      throw new Error(`Invalid segment name: ${name}`);
    }
    const m = SEGMENT_RE.exec(name);
    if (!m) throw new Error(`Invalid segment name: ${name}`);
    return parseInt(m[1], 10);
  }

  private resolveProfile(profileId: string): HLSProfile {
    const found = this.profiles.find((p) => p.id === profileId);
    if (!found) throw new Error(`Unknown quality profile: ${profileId}`);
    return found;
  }

  private selectHwAccel(): HwAccelSelection {
    const env = defaultHwAccelEnv(this.cfg.hwaccelDevice);
    if (this.cfg.hwaccelDeviceExists) env.deviceExists = this.cfg.hwaccelDeviceExists;
    return selectHwAccel(this.cfg.hwaccel, env);
  }
}

function formatErrorReason(err: unknown): string {
  if (err instanceof Error) return err.message.split('\n')[0] || err.name;
  return String(err);
}

function anyAbort(signals: (AbortSignal | undefined)[]): AbortSignal {
  const ac = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      ac.abort();
      return ac.signal;
    }
    s.addEventListener('abort', () => ac.abort(), { once: true });
  }
  return ac.signal;
}
