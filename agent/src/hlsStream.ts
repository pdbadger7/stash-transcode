import path from 'path';
import { SegmentCache } from './hls/segmentCache.js';
import { SessionManager, type SpawnFn } from './hls/sessionManager.js';
import { produceSegment as defaultProduceSegment, type ProduceSegmentInput } from './hls/segmentProducer.js';
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

const SEGMENT_RE = /^segment_(\d{3,})\.ts$/;

export class HLSStream {
  private readonly profiles: HLSProfile[];
  private readonly cache: SegmentCache;
  private readonly sessions: SessionManager;
  private readonly produceSegmentFn: (input: ProduceSegmentInput) => Promise<Buffer>;
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

    if (await this.cache.has(input.sceneId, input.profileId, index)) {
      return this.cache.read(input.sceneId, input.profileId, index);
    }

    const startSeconds = index * this.cfg.segmentDuration;
    const segDuration = plan.durations[index];

    const sessionHit = await this.waitForSessionSegment(
      input.sceneId,
      input.profileId,
      index
    );
    if (sessionHit) return sessionHit;

    const selection = this.selectHwAccel();
    const mode = selection.mode;
    if (this.enableDebug) {
      console.debug(
        `[HLS] selected hw mode=${mode}${selection.hwaccelDevice ? ` device=${selection.hwaccelDevice}` : ''} scene=${input.sceneId} profile=${input.profileId} segment=${index}`
      );
    }
    const args = buildSingleSegmentArgs({
      inputPath: input.inputPath,
      profile,
      startSeconds,
      durationSeconds: segDuration,
      mode,
      segmentDuration: this.cfg.segmentDuration,
      hwaccelDevice: selection.hwaccelDevice,
      sourceVideoCodec: input.sourceMetadata.videoCodec,
    });

    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => timeoutCtrl.abort(), this.cfg.singleSegmentTimeoutMs);
    const composite = anyAbort([timeoutCtrl.signal, input.abortSignal]);
    let bytes: Buffer;
    let sessionMode: ResolvedHwAccelMode = mode;
    try {
      try {
        bytes = await this.produceSegmentFn({
          ffmpegPath: this.cfg.ffmpegPath,
          args,
          signal: composite,
        });
      } catch (err) {
        if (mode !== 'none' && !timeoutCtrl.signal.aborted) {
          console.warn(
            `[HLS] hw mode ${mode} failed for scene=${input.sceneId} profile=${input.profileId} segment=${index}; falling back to software: ${formatErrorReason(err)}`
          );
          sessionMode = 'none';
          bytes = await this.produceSegmentFn({
            ffmpegPath: this.cfg.ffmpegPath,
            args: buildSingleSegmentArgs({
              inputPath: input.inputPath,
              profile,
              startSeconds,
              durationSeconds: segDuration,
              mode: 'none',
              segmentDuration: this.cfg.segmentDuration,
              hwaccelDevice: selection.hwaccelDevice,
              sourceVideoCodec: input.sourceMetadata.videoCodec,
            }),
            signal: composite,
          });
        } else {
          throw err;
        }
      }
    } finally {
      clearTimeout(timer);
    }

    await this.cache.write(input.sceneId, input.profileId, index, bytes);

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

    return bytes;
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
    index: number
  ): Promise<Buffer | null> {
    if (!this.sessions.canProduce(sceneId, profileId, index)) return null;
    const deadline = Date.now() + this.cfg.sessionWaitMs;
    while (Date.now() < deadline) {
      if (await this.cache.has(sceneId, profileId, index)) {
        return this.cache.read(sceneId, profileId, index);
      }
      await sleep(75);
    }
    return null;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
