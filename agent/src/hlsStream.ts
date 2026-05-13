import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { existsSync, promises as fs } from 'fs';
import { getMimeType } from './directStream.js';
import type { HLSProfile } from './types.js';

export interface HLSConfig {
  cacheDir: string;
  ffmpegPath: string;
  hwaccel: 'none' | 'vaapi' | 'qsv' | 'nvenc';
  segmentDuration: number;
  enableDebug?: boolean;
  profiles?: HLSProfile[];
}

interface TranscodingProcess {
  process: ChildProcess;
  startTime: number;
  sceneId: string;
  profileId: string;
}

export const DEFAULT_HLS_PROFILES: HLSProfile[] = [
  {
    id: '1080p',
    label: '1080p',
    width: 1920,
    height: 1080,
    videoBitrateKbps: 6000,
    bandwidthKbps: 6800,
  },
  {
    id: '720p',
    label: '720p',
    width: 1280,
    height: 720,
    videoBitrateKbps: 3500,
    bandwidthKbps: 4200,
  },
  {
    id: '480p',
    label: '480p',
    width: 854,
    height: 480,
    videoBitrateKbps: 1800,
    bandwidthKbps: 2200,
  },
];

export class HLSStream {
  private cacheDir: string;
  private ffmpegPath: string;
  private hwaccel: HLSConfig['hwaccel'];
  private segmentDuration: number;
  private enableDebug: boolean;
  private profiles: HLSProfile[];
  private activeTranscodes = new Map<string, TranscodingProcess>();
  private launchingTranscodes = new Set<string>();

  constructor(config: HLSConfig) {
    this.cacheDir = config.cacheDir;
    this.ffmpegPath = config.ffmpegPath;
    this.hwaccel = config.hwaccel;
    this.segmentDuration = config.segmentDuration || 4;
    this.enableDebug = config.enableDebug || false;
    this.profiles = config.profiles ?? DEFAULT_HLS_PROFILES;
  }

  async getMasterPlaylist(
    sceneId: string,
    inputPath: string,
    preferredQuality?: string,
    token?: string
  ): Promise<string> {
    const profiles = this.orderProfiles(preferredQuality);
    return this.generateMasterPlaylist(sceneId, profiles, token);
  }

  async getVariantPlaylist(
    sceneId: string,
    profileId: string,
    inputPath: string,
    token?: string
  ): Promise<string> {
    const profile = this.resolveProfile(profileId);
    const sceneDir = this.getSceneProfileDir(sceneId, profile.id);
    const playlistPath = path.join(sceneDir, 'master.m3u8');
    const key = this.getTranscodeKey(sceneId, profile.id);

    if (existsSync(playlistPath)) {
      const playlist = await fs.readFile(playlistPath, 'utf-8');
      return this.rewritePlaylistUris(playlist, token);
    }

    if (!this.activeTranscodes.has(key) && !this.launchingTranscodes.has(key)) {
      this.launchingTranscodes.add(key);
      void this.startTranscode(sceneId, profile, inputPath, sceneDir, key);
    }

    return this.generatePlaceholderPlaylist(profile);
  }

  async getSegment(
    sceneId: string,
    profileId: string,
    segmentName: string
  ): Promise<Buffer | null> {
    const profile = this.resolveProfile(profileId);
    const profileDir = path.resolve(this.getSceneProfileDir(sceneId, profile.id));
    const segmentPath = path.resolve(path.join(profileDir, segmentName));

    if (!segmentPath.startsWith(profileDir + path.sep)) {
      if (this.enableDebug) {
        console.warn(`[HLS] Path traversal attempt: ${segmentName}`);
      }
      return null;
    }

    try {
      if (existsSync(segmentPath)) {
        return await fs.readFile(segmentPath);
      }
    } catch (err) {
      if (this.enableDebug) {
        console.error(`[HLS] Failed to read segment ${segmentName}:`, err);
      }
    }

    return null;
  }

  private async startTranscode(
    sceneId: string,
    profile: HLSProfile,
    inputPath: string,
    outputDir: string,
    key: string
  ): Promise<void> {
    try {
      await fs.mkdir(outputDir, { recursive: true });
      const args = this.buildFFmpegArgs(inputPath, outputDir, profile);

      if (this.enableDebug) {
        console.log(`[HLS] FFmpeg args for ${sceneId}/${profile.id}: ${args.join(' ')}`);
      }

      const process = spawn(this.ffmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.activeTranscodes.set(key, {
        process,
        startTime: Date.now(),
        sceneId,
        profileId: profile.id,
      });

      process.on('error', (err) => {
        this.activeTranscodes.delete(key);
        this.launchingTranscodes.delete(key);
        if (this.enableDebug) {
          console.error(`[HLS] FFmpeg error for ${sceneId}/${profile.id}:`, err);
        }
      });

      process.on('exit', (code, signal) => {
        if (this.enableDebug && code !== 0) {
          console.warn(
            `[HLS] FFmpeg exited for ${sceneId}/${profile.id} with code ${code ?? 'unknown'} signal ${signal ?? 'none'}`
          );
        }
        this.activeTranscodes.delete(key);
        this.launchingTranscodes.delete(key);
      });
    } catch (err) {
      this.activeTranscodes.delete(key);
      this.launchingTranscodes.delete(key);
      throw err;
    }
  }

  private buildFFmpegArgs(
    inputPath: string,
    outputDir: string,
    profile: HLSProfile
  ): string[] {
    const args = this.getHWAccelArgs();
    args.push('-i', inputPath);
    args.push('-c:v', this.getVideoCodec());

    if (profile.height > 0) {
      args.push('-vf', `scale=-2:${profile.height}`);
    }

    args.push('-preset', 'veryfast');
    args.push('-b:v', `${profile.videoBitrateKbps}k`);
    args.push('-maxrate', `${Math.round(profile.videoBitrateKbps * 1.2)}k`);
    args.push('-bufsize', `${Math.max(profile.videoBitrateKbps * 2, 1000)}k`);
    args.push('-c:a', 'aac');
    args.push('-b:a', '128k');
    args.push('-f', 'hls');
    args.push('-hls_time', String(this.segmentDuration));
    args.push('-hls_list_size', '0');
    args.push('-hls_flags', 'independent_segments');
    args.push('-hls_segment_filename', path.join(outputDir, 'segment_%03d.ts'));
    args.push(path.join(outputDir, 'master.m3u8'));

    return args;
  }

  private getVideoCodec(): string {
    switch (this.hwaccel) {
      case 'vaapi':
        return 'h264_vaapi';
      case 'qsv':
        return 'h264_qsv';
      case 'nvenc':
        return 'h264_nvenc';
      default:
        return 'libx264';
    }
  }

  private getHWAccelArgs(): string[] {
    switch (this.hwaccel) {
      case 'vaapi':
        return ['-hwaccel', 'vaapi', '-hwaccel_device', '/dev/dri/renderD128'];
      case 'qsv':
        return ['-hwaccel', 'qsv'];
      case 'nvenc':
        return ['-hwaccel', 'cuda'];
      default:
        return [];
    }
  }

  private generateMasterPlaylist(
    sceneId: string,
    profiles: HLSProfile[],
    token?: string
  ): string {
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-INDEPENDENT-SEGMENTS',
    ];

    for (const profile of profiles) {
      lines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${profile.bandwidthKbps * 1000},RESOLUTION=${profile.width}x${profile.height},NAME="${profile.label}",CODECS="avc1.640028,mp4a.40.2"`
      );
      lines.push(
        this.withToken(
          `/stash/scene/${sceneId}/variant/${profile.id}/master.m3u8`,
          token
        )
      );
    }

    return `${lines.join('\n')}\n`;
  }

  private rewritePlaylistUris(playlist: string, token?: string): string {
    return playlist
      .split('\n')
      .map((line) => {
        if (!line || line.startsWith('#')) {
          return line;
        }

        return this.withToken(line, token);
      })
      .join('\n');
  }

  private withToken(uri: string, token?: string): string {
    if (!token) {
      return uri;
    }

    const separator = uri.includes('?') ? '&' : '?';
    return `${uri}${separator}token=${encodeURIComponent(token)}`;
  }

  private generatePlaceholderPlaylist(profile: HLSProfile): string {
    return [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${this.segmentDuration}`,
      '#EXT-X-MEDIA-SEQUENCE:0',
      `# ${profile.label} transcoding in progress`,
      '',
    ].join('\n');
  }

  private getSceneProfileDir(sceneId: string, profileId: string): string {
    return path.join(this.cacheDir, sceneId, profileId);
  }

  private getTranscodeKey(sceneId: string, profileId: string): string {
    return `${sceneId}:${profileId}`;
  }

  private resolveProfile(profileId: string): HLSProfile {
    const profile = this.profiles.find((item) => item.id === profileId);
    if (!profile) {
      throw new Error(`Unknown quality profile: ${profileId}`);
    }

    return profile;
  }

  private orderProfiles(preferredQuality?: string): HLSProfile[] {
    const ordered = [...this.profiles].sort(
      (a, b) => b.bandwidthKbps - a.bandwidthKbps
    );

    if (!preferredQuality || preferredQuality === 'auto') {
      return ordered;
    }

    const preferredIndex = ordered.findIndex(
      (profile) => profile.id === preferredQuality
    );

    if (preferredIndex < 0) {
      return ordered;
    }

    const [preferred] = ordered.splice(preferredIndex, 1);
    return [preferred, ...ordered];
  }

  async cleanupOldTranscodes(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
    try {
      const sceneEntries = await fs.readdir(this.cacheDir, { withFileTypes: true });

      for (const sceneEntry of sceneEntries) {
        if (!sceneEntry.isDirectory()) continue;

        const sceneDir = path.join(this.cacheDir, sceneEntry.name);
        const profileEntries = await fs.readdir(sceneDir, { withFileTypes: true });

        for (const profileEntry of profileEntries) {
          if (!profileEntry.isDirectory()) continue;

          const profileDir = path.join(sceneDir, profileEntry.name);
          const key = this.getTranscodeKey(sceneEntry.name, profileEntry.name);
          const stats = await fs.stat(profileDir);
          const ageMs = Date.now() - stats.mtimeMs;

          if (!this.activeTranscodes.has(key) && ageMs > maxAgeMs) {
            if (this.enableDebug) {
              console.log(`[HLS] Cleaning up old cache: ${sceneEntry.name}/${profileEntry.name}`);
            }
            await fs.rm(profileDir, { recursive: true, force: true });
          }
        }
      }
    } catch (err) {
      if (this.enableDebug) {
        console.error('[HLS] Cleanup failed:', err);
      }
    }
  }

  getActiveTranscodes(): { sceneId: string; profileId: string; uptime: number }[] {
    return Array.from(this.activeTranscodes.values()).map((transcode) => ({
      sceneId: transcode.sceneId,
      profileId: transcode.profileId,
      uptime: Date.now() - transcode.startTime,
    }));
  }

  getPlaylistMimeType(): string {
    return getMimeType('master.m3u8');
  }

  getSegmentMimeType(segmentName: string): string {
    return getMimeType(segmentName);
  }
}
