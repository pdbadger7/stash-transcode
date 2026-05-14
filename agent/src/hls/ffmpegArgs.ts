import { existsSync } from 'fs';
import type { HLSProfile } from '../types.js';

export type RequestedHwAccel = 'none' | 'auto' | 'vaapi' | 'qsv' | 'nvenc';
export type HardwareAccelMode = Exclude<RequestedHwAccel, 'none' | 'auto'>;
export type ResolvedHwAccelMode = 'none' | HardwareAccelMode;

export const DEFAULT_HWACCEL_DEVICE = '/dev/dri/renderD128';

export interface HwAccelEnv {
  deviceExists: (path: string) => boolean;
  hwaccelDevice?: string;
  probe?: (mode: HardwareAccelMode) => boolean;
}

export interface HwAccelSelection {
  mode: ResolvedHwAccelMode;
  hwaccelDevice?: string;
}

export function defaultHwAccelEnv(hwaccelDevice?: string): HwAccelEnv {
  return { deviceExists: existsSync, hwaccelDevice };
}

export function selectHwAccelMode(
  requested: RequestedHwAccel,
  env: HwAccelEnv
): ResolvedHwAccelMode {
  return selectHwAccel(requested, env).mode;
}

export function selectHwAccel(
  requested: RequestedHwAccel,
  env: HwAccelEnv
): HwAccelSelection {
  if (requested === 'none') return { mode: 'none' };
  const candidates: HardwareAccelMode[] =
    requested === 'auto' ? ['vaapi', 'qsv', 'nvenc'] : [requested];
  for (const c of candidates) {
    if (env.probe) {
      if (env.probe(c)) return { mode: c, hwaccelDevice: driDeviceForMode(c, env) };
      continue;
    }
    if (c === 'nvenc' && hasNvidiaDevice(env)) return { mode: c };
    const driDevice = driDeviceForMode(c, env);
    if (driDevice) return { mode: c, hwaccelDevice: driDevice };
  }
  return { mode: 'none' };
}

function driDeviceForMode(mode: HardwareAccelMode, env: HwAccelEnv): string | undefined {
  if (mode !== 'vaapi' && mode !== 'qsv') return undefined;
  return findDriDevice(env) ?? undefined;
}

function findDriDevice(env: HwAccelEnv): string | null {
  if (env.hwaccelDevice) {
    return env.deviceExists(env.hwaccelDevice) ? env.hwaccelDevice : null;
  }
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

function hwAccelInputArgs(mode: ResolvedHwAccelMode, hwaccelDevice = DEFAULT_HWACCEL_DEVICE): string[] {
  switch (mode) {
    case 'vaapi':
      return [
        '-vaapi_device',
        hwaccelDevice,
        '-hwaccel',
        'vaapi',
        '-hwaccel_device',
        hwaccelDevice,
      ];
    case 'qsv':
      return ['-hwaccel', 'qsv', '-hwaccel_device', hwaccelDevice];
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

function presetArgs(mode: ResolvedHwAccelMode, preset: 'ultrafast' | 'veryfast' = 'veryfast'): string[] {
  if (mode === 'none') return ['-preset', preset];
  if (mode === 'nvenc') return ['-preset', 'p4'];
  return [];
}

function videoFilterArgs(mode: ResolvedHwAccelMode, profile: HLSProfile): string[] {
  if (mode === 'vaapi') {
    const filter =
      profile.height > 0
        ? `format=nv12,hwupload,scale_vaapi=-2:${profile.height}`
        : 'format=nv12,hwupload';
    return ['-vf', filter];
  }
  if (profile.height > 0) return ['-vf', `scale=-2:${profile.height}`];
  return [];
}

export interface SingleSegmentArgsInput {
  inputPath: string;
  profile: HLSProfile;
  startSeconds: number;
  durationSeconds: number;
  mode: ResolvedHwAccelMode;
  segmentDuration: number;
  hwaccelDevice?: string;
  sourceVideoCodec?: string;
}

export function buildSingleSegmentArgs(input: SingleSegmentArgsInput): string[] {
  const { inputPath, profile, startSeconds, durationSeconds, mode, sourceVideoCodec } = input;
  const streamCopy = sourceVideoCodec === 'h264' && profile.height === 0;
  const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin'];
  args.push(...hwAccelInputArgs(streamCopy ? 'none' : mode, input.hwaccelDevice));
  args.push('-ss', String(startSeconds));
  args.push('-i', inputPath);
  args.push('-t', String(durationSeconds));
  args.push('-output_ts_offset', String(startSeconds));
  args.push('-muxdelay', '0', '-muxpreload', '0');
  args.push('-map', '0:v:0');
  args.push('-map', '0:a:0?');
  if (streamCopy) {
    args.push('-c:v', 'copy');
  } else {
    args.push('-c:v', videoCodec(mode));
    args.push(...videoFilterArgs(mode, profile));
    args.push(...presetArgs(mode, 'ultrafast'));
    args.push('-force_key_frames', `expr:gte(t,${startSeconds})`);
    args.push('-sc_threshold', '0');
    args.push('-b:v', `${profile.videoBitrateKbps}k`);
    args.push('-maxrate', `${Math.round(profile.videoBitrateKbps * 1.2)}k`);
    args.push('-bufsize', `${Math.max(profile.videoBitrateKbps * 2, 1000)}k`);
  }
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
  hwaccelDevice?: string;
}

export function buildSessionArgs(input: SessionArgsInput): string[] {
  const { inputPath, profile, head, mode, segmentDuration, outputDir } = input;
  const startSeconds = head * segmentDuration;
  const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin'];
  args.push(...hwAccelInputArgs(mode, input.hwaccelDevice));
  args.push('-ss', String(startSeconds));
  args.push('-i', inputPath);
  args.push('-copyts', '-muxdelay', '0', '-muxpreload', '0');
  args.push('-map', '0:v:0', '-map', '0:a:0?');
  args.push('-c:v', videoCodec(mode));
  args.push(...videoFilterArgs(mode, profile));
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
