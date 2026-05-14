import { spawn as nodeSpawn, type ChildProcess } from 'child_process';
import type { HLSProfile } from '../types.js';
import type { ResolvedHwAccelMode } from './ffmpegArgs.js';

export type SpawnFn = (cmd: string, args: string[], opts?: object) => ChildProcess;

export interface BuildSessionArgsFn {
  (input: {
    inputPath: string;
    profile: HLSProfile;
    head: number;
    mode: ResolvedHwAccelMode;
    segmentDuration: number;
    outputDir: string;
  }): string[];
}

export interface SessionManagerConfig {
  ffmpegPath: string;
  segmentDuration: number;
  lookaheadSegments: number;
  maxSessions: number;
  spawn?: SpawnFn;
  buildArgs: BuildSessionArgsFn;
  outputDirFor?: (sceneId: string, profileId: string) => string;
  onSessionExit?: (key: string, code: number | null) => void;
  enableDebug?: boolean;
}

export interface NoteRequestInput {
  sceneId: string;
  profileId: string;
  index: number;
  inputPath: string;
  profile: HLSProfile;
  mode: ResolvedHwAccelMode;
}

interface Session {
  key: string;
  sceneId: string;
  profileId: string;
  head: number;
  startedAt: number;
  process: ChildProcess;
  lastActivity: number;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private spawn: SpawnFn;

  constructor(private readonly cfg: SessionManagerConfig) {
    this.spawn = cfg.spawn ?? nodeSpawn;
  }

  noteRequest(input: NoteRequestInput): void {
    const key = `${input.sceneId}:${input.profileId}`;
    const existing = this.sessions.get(key);
    const horizonEnd = existing ? existing.head + this.cfg.lookaheadSegments : -1;

    if (existing && input.index >= existing.head && input.index <= horizonEnd) {
      existing.lastActivity = Date.now();
      return;
    }

    if (existing) {
      this.killSession(existing);
    }

    this.evictIfNeeded();

    const head = input.index + 1;
    const outputDir =
      this.cfg.outputDirFor?.(input.sceneId, input.profileId) ?? `/tmp/hls/${input.sceneId}/${input.profileId}`;
    const args = this.cfg.buildArgs({
      inputPath: input.inputPath,
      profile: input.profile,
      head,
      mode: input.mode,
      segmentDuration: this.cfg.segmentDuration,
      outputDir,
    });
    const proc = this.spawn(this.cfg.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const session: Session = {
      key,
      sceneId: input.sceneId,
      profileId: input.profileId,
      head,
      startedAt: Date.now(),
      process: proc,
      lastActivity: Date.now(),
    };
    proc.on('exit', (code) => {
      const current = this.sessions.get(key);
      if (current === session) this.sessions.delete(key);
      this.cfg.onSessionExit?.(key, code);
    });
    proc.on('error', () => {
      const current = this.sessions.get(key);
      if (current === session) this.sessions.delete(key);
    });
    this.sessions.set(key, session);
  }

  activeSessions(): { sceneId: string; profileId: string; head: number }[] {
    return Array.from(this.sessions.values()).map((s) => ({
      sceneId: s.sceneId,
      profileId: s.profileId,
      head: s.head,
    }));
  }

  isInUse(sceneId: string, profileId: string): boolean {
    return this.sessions.has(`${sceneId}:${profileId}`);
  }

  shutdown(): void {
    for (const session of this.sessions.values()) this.killSession(session);
    this.sessions.clear();
  }

  private evictIfNeeded(): void {
    while (this.sessions.size >= this.cfg.maxSessions) {
      const oldest = [...this.sessions.values()].sort((a, b) => a.startedAt - b.startedAt)[0];
      if (!oldest) return;
      this.killSession(oldest);
      this.sessions.delete(oldest.key);
    }
  }

  private killSession(session: Session): void {
    try {
      session.process.kill('SIGTERM');
    } catch {}
  }
}
