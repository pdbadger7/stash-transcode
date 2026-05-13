import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { promises as fs, existsSync, createReadStream } from 'fs';
import { FastifyRequest, FastifyReply } from 'fastify';

export interface HLSConfig {
  cacheDir: string;
  ffmpegPath: string;
  hwaccel: 'none' | 'vaapi' | 'qsv' | 'nvenc';
  segmentDuration: number;
  enableDebug?: boolean;
}

interface TranscodingProcess {
  process: ChildProcess;
  startTime: number;
  sceneId: string;
}

export class HLSStream {
  private cacheDir: string;
  private ffmpegPath: string;
  private hwaccel: HLSConfig['hwaccel'];
  private segmentDuration: number;
  private enableDebug: boolean;
  private activeTranscodes = new Map<string, TranscodingProcess>();

  constructor(config: HLSConfig) {
    this.cacheDir = config.cacheDir;
    this.ffmpegPath = config.ffmpegPath;
    this.hwaccel = config.hwaccel;
    this.segmentDuration = config.segmentDuration || 4;
    this.enableDebug = config.enableDebug || false;
  }

  async getMasterPlaylist(
    sceneId: string,
    inputPath: string
  ): Promise<string> {
    const sceneDir = path.join(this.cacheDir, sceneId);

    // Check if we already have a master.m3u8
    const masterPath = path.join(sceneDir, 'master.m3u8');
    if (existsSync(masterPath)) {
      if (this.enableDebug) {
        console.log(`[HLS] Found cached master.m3u8 for scene ${sceneId}`);
      }
      return await fs.readFile(masterPath, 'utf-8');
    }

    // Start transcoding if not already running
    if (!this.activeTranscodes.has(sceneId)) {
      if (this.enableDebug) {
        console.log(`[HLS] Starting transcode for scene ${sceneId}: ${inputPath}`);
      }
      await this.startTranscode(sceneId, inputPath, sceneDir);
    }

    // Return placeholder master.m3u8 while transcoding
    return this.generatePlaceholderPlaylist(sceneId);
  }

  async getSegment(
    sceneId: string,
    segmentName: string
  ): Promise<Buffer | null> {
    const segmentPath = path.join(this.cacheDir, sceneId, segmentName);

    // Security: ensure path is within cache directory using normalization
    const resolvedPath = path.resolve(segmentPath);
    const resolvedCacheDir = path.resolve(this.cacheDir);
    
    if (!resolvedPath.startsWith(resolvedCacheDir)) {
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
    inputPath: string,
    outputDir: string
  ): Promise<void> {
    try {
      // Create output directory
      await fs.mkdir(outputDir, { recursive: true });

      // Build ffmpeg command
      const args = this.buildFFmpegArgs(inputPath, outputDir);

      if (this.enableDebug) {
        console.log(`[HLS] FFmpeg args: ${args.join(' ')}`);
      }

      return new Promise((resolve, reject) => {
        const process = spawn(this.ffmpegPath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        this.activeTranscodes.set(sceneId, {
          process,
          startTime: Date.now(),
          sceneId,
        });

        process.on('error', (err) => {
          this.activeTranscodes.delete(sceneId);
          if (this.enableDebug) {
            console.error(`[HLS] FFmpeg error for scene ${sceneId}:`, err);
          }
          reject(err);
        });

        process.on('exit', (code, signal) => {
          if (code !== 0) {
            if (this.enableDebug) {
              console.warn(
                `[HLS] FFmpeg process exited with code ${code} for scene ${sceneId}`
              );
            }
          }
          this.activeTranscodes.delete(sceneId);
        });

        // Resolve immediately - transcoding happens in background
        resolve();
      });
    } catch (err) {
      if (this.enableDebug) {
        console.error(`[HLS] Failed to start transcode for scene ${sceneId}:`, err);
      }
      throw err;
    }
  }

  private buildFFmpegArgs(inputPath: string, outputDir: string): string[] {
    const args = ['-i', inputPath];

    // Add hardware acceleration if configured
    if (this.hwaccel !== 'none') {
      args.push(...this.getHWAccelArgs());
    }

    // Video codec
    if (this.hwaccel === 'nvenc') {
      args.push('-c:v', 'hevc_nvenc');
    } else if (this.hwaccel === 'qsv') {
      args.push('-c:v', 'hevc_qsv');
    } else if (this.hwaccel === 'vaapi') {
      args.push('-c:v', 'hevc_vaapi');
    } else {
      args.push('-c:v', 'libx264');
    }

    // Common encoding settings
    args.push('-preset', 'veryfast');

    // Audio codec
    args.push('-c:a', 'aac');

    // HLS format
    args.push('-f', 'hls');
    args.push('-hls_time', String(this.segmentDuration));
    args.push('-hls_list_size', '0');
    args.push('-hls_segment_filename', path.join(outputDir, 'segment_%03d.ts'));

    // Output master.m3u8
    args.push(path.join(outputDir, 'master.m3u8'));

    return args;
  }

  private getHWAccelArgs(): string[] {
    // Add hardware-specific initialization args
    // These will be placed before -i input
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

  private generatePlaceholderPlaylist(sceneId: string): string {
    // Return a simple m3u8 that will be updated as segments are written
    return `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:${this.segmentDuration}
#EXT-X-MEDIA-SEQUENCE:0
# Transcoding in progress...
`;
  }

  async cleanupOldTranscodes(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
    try {
      const entries = await fs.readdir(this.cacheDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirPath = path.join(this.cacheDir, entry.name);
          const stats = await fs.stat(dirPath);
          const ageMs = Date.now() - stats.mtimeMs;

          if (ageMs > maxAgeMs) {
            if (this.enableDebug) {
              console.log(`[HLS] Cleaning up old cache: ${entry.name}`);
            }
            await fs.rm(dirPath, { recursive: true, force: true });
          }
        }
      }
    } catch (err) {
      if (this.enableDebug) {
        console.error('[HLS] Cleanup failed:', err);
      }
    }
  }

  getActiveTranscodes(): { sceneId: string; uptime: number }[] {
    return Array.from(this.activeTranscodes.values()).map((t) => ({
      sceneId: t.sceneId,
      uptime: Date.now() - t.startTime,
    }));
  }
}
