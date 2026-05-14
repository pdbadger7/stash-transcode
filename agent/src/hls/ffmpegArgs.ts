import { existsSync } from 'fs';
import type { HLSProfile } from '../types.js';

export type RequestedHwAccel = 'none' | 'auto' | 'vaapi' | 'qsv' | 'nvenc';
export type HardwareAccelMode = Exclude<RequestedHwAccel, 'none' | 'auto'>;
export type ResolvedHwAccelMode = 'none' | HardwareAccelMode;

export interface HwAccelEnv {
  deviceExists: (path: string) => boolean;
  unavailable: Set<HardwareAccelMode>;
  probe?: (mode: HardwareAccelMode) => boolean;
}

export function defaultHwAccelEnv(unavailable: Set<HardwareAccelMode>): HwAccelEnv {
  return { deviceExists: existsSync, unavailable };
}

export function selectHwAccelMode(
  requested: RequestedHwAccel,
  env: HwAccelEnv
): ResolvedHwAccelMode {
  if (requested === 'none') return 'none';
  const candidates: HardwareAccelMode[] =
    requested === 'auto' ? ['vaapi', 'qsv', 'nvenc'] : [requested];
  for (const c of candidates) {
    if (env.unavailable.has(c)) continue;
    if (env.probe) {
      if (env.probe(c)) return c;
      continue;
    }
    if (c === 'nvenc' && hasNvidiaDevice(env)) return c;
    if ((c === 'vaapi' || c === 'qsv') && findDriDevice(env)) return c;
  }
  return 'none';
}

function findDriDevice(env: HwAccelEnv): string | null {
  for (let i = 128; i < 192; i += 1) {
    const p = `/dev/dri/renderD${i}`;
    if (env.deviceExists(p)) return p;
  }
  for (let i = 0; i < 16; i += 1) {
    const p = `/dev/dri/card${i}`;
    if (env.deviceExists(p)) return p;
  }
  return null;
}

function hasNvidiaDevice(env: HwAccelEnv): boolean {
  return (
    env.deviceExists('/dev/nvidia0') ||
    env.deviceExists('/dev/nvidiactl') ||
    env.deviceExists('/dev/nvidia-uvm')
  );
}

function hwAccelInputArgs(mode: ResolvedHwAccelMode): string[] {
  switch (mode) {
    case 'vaapi':
      return ['-hwaccel', 'vaapi', '-hwaccel_device', '/dev/dri/renderD128'];
    case 'qsv':
      return ['-hwaccel', 'qsv', '-hwaccel_device', '/dev/dri/renderD128'];
    case 'nvenc':
      return ['-hwaccel', 'cuda'];
    default:
      return [];
  }
}

function videoCodec(mode: ResolvedHwAccelMode): string {
  switch (mode) {
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

function presetArgs(mode: ResolvedHwAccelMode): string[] {
  if (mode === 'none') return ['-preset', 'veryfast'];
  if (mode === 'nvenc') return ['-preset', 'p4'];
  return [];
}

export interface SingleSegmentArgsInput {
  inputPath: string;
  profile: HLSProfile;
  startSeconds: number;
  durationSeconds: number;
  mode: ResolvedHwAccelMode;
  segmentDuration: number;
}

export function buildSingleSegmentArgs(input: SingleSegmentArgsInput): string[] {
  const { inputPath, profile, startSeconds, durationSeconds, mode } = input;
  const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin'];
  args.push(...hwAccelInputArgs(mode));
  args.push('-ss', String(startSeconds));
  args.push('-i', inputPath);
  args.push('-t', String(durationSeconds));
  args.push('-output_ts_offset', String(startSeconds));
  args.push('-muxdelay', '0', '-muxpreload', '0');
  args.push('-map', '0:v:0');
  args.push('-map', '0:a:0?');
  args.push('-c:v', videoCodec(mode));
  if (profile.height > 0) args.push('-vf', `scale=-2:${profile.height}`);
  args.push(...presetArgs(mode));
  args.push('-force_key_frames', `expr:gte(t,${startSeconds})`);
  args.push('-sc_threshold', '0');
  args.push('-b:v', `${profile.videoBitrateKbps}k`);
  args.push('-maxrate', `${Math.round(profile.videoBitrateKbps * 1.2)}k`);
  args.push('-bufsize', `${Math.max(profile.videoBitrateKbps * 2, 1000)}k`);
  args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2');
  args.push('-f', 'mpegts');
  args.push('pipe:1');
  return args;
}

export interface SessionArgsInput {
  inputPath: string;
  profile: HLSProfile;
  head: number;
  mode: ResolvedHwAccelMode;
  segmentDuration: number;
  outputDir: string;
}

export function buildSessionArgs(input: SessionArgsInput): string[] {
  const { inputPath, profile, head, mode, segmentDuration, outputDir } = input;
  const startSeconds = head * segmentDuration;
  const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin'];
  args.push(...hwAccelInputArgs(mode));
  args.push('-ss', String(startSeconds));
  args.push('-i', inputPath);
  args.push('-copyts', '-muxdelay', '0', '-muxpreload', '0');
  args.push('-map', '0:v:0', '-map', '0:a:0?');
  args.push('-c:v', videoCodec(mode));
  if (profile.height > 0) args.push('-vf', `scale=-2:${profile.height}`);
  args.push(...presetArgs(mode));
  args.push(
    '-force_key_frames',
    `expr:gte(t,n_forced*${segmentDuration}+${startSeconds})`
  );
  args.push('-sc_threshold', '0');
  args.push('-b:v', `${profile.videoBitrateKbps}k`);
  args.push('-maxrate', `${Math.round(profile.videoBitrateKbps * 1.2)}k`);
  args.push('-bufsize', `${Math.max(profile.videoBitrateKbps * 2, 1000)}k`);
  args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2');
  args.push('-f', 'hls');
  args.push('-hls_playlist_type', 'vod');
  args.push('-hls_time', String(segmentDuration));
  args.push('-hls_list_size', '0');
  args.push('-hls_flags', 'independent_segments+temp_file');
  args.push('-start_number', String(head));
  args.push('-hls_segment_filename', `${outputDir}/segment_%03d.ts`);
  args.push(`${outputDir}/.session-${head}.m3u8`);
  return args;
}
