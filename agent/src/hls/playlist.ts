import type { HLSProfile } from '../types.js';

export interface SegmentPlan {
  count: number;
  durations: number[];
  totalDuration: number;
}

export interface ComputeSegmentPlanInput {
  durationSeconds: number;
  segmentDuration: number;
}

export function computeSegmentPlan(input: ComputeSegmentPlanInput): SegmentPlan {
  const { durationSeconds, segmentDuration } = input;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`Invalid durationSeconds: ${durationSeconds}`);
  }
  if (!Number.isFinite(segmentDuration) || segmentDuration <= 0) {
    throw new Error(`Invalid segmentDuration: ${segmentDuration}`);
  }
  const fullCount = Math.floor(durationSeconds / segmentDuration);
  const remainder = durationSeconds - fullCount * segmentDuration;
  const durations: number[] = [];
  for (let i = 0; i < fullCount; i += 1) durations.push(segmentDuration);
  if (remainder > 1e-3) durations.push(round3(remainder));
  if (durations.length === 0) durations.push(round3(durationSeconds));
  return {
    count: durations.length,
    durations,
    totalDuration: durationSeconds,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface BuildVariantInput {
  sceneId: string;
  profileId: string;
  durationSeconds: number;
  segmentDuration: number;
  token?: string;
}

export function buildVariantPlaylist(input: BuildVariantInput): string {
  const plan = computeSegmentPlan({
    durationSeconds: input.durationSeconds,
    segmentDuration: input.segmentDuration,
  });
  const target = Math.ceil(input.segmentDuration);
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${target}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
  ];
  for (let i = 0; i < plan.count; i += 1) {
    lines.push(`#EXTINF:${plan.durations[i].toFixed(3)},`);
    const name = `segment_${String(i).padStart(3, '0')}.ts`;
    lines.push(
      withToken(`/stash/scene/${input.sceneId}/variant/${input.profileId}/${name}`, input.token)
    );
  }
  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n');
}

export interface BuildMasterInput {
  sceneId: string;
  profiles: HLSProfile[];
  source?: { width?: number; height?: number; fps?: number };
  token?: string;
  preferredProfileId?: string;
}

export function buildMasterPlaylist(input: BuildMasterInput): string {
  const usable = filterProfilesForSource(input.profiles, input.source);
  const ordered = orderProfiles(usable, input.preferredProfileId);
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-INDEPENDENT-SEGMENTS'];
  for (const profile of ordered) {
    const rendition = renditionMetadata(profile, input.source);
    const streamInf = [
      `BANDWIDTH=${profile.bandwidthKbps * 1000}`,
      `RESOLUTION=${rendition.width}x${rendition.height}`,
      `NAME="${profile.label}"`,
      'CODECS="avc1.640028,mp4a.40.2"',
    ];
    if (rendition.fps !== undefined) {
      streamInf.push(`FRAME-RATE=${rendition.fps.toFixed(3)}`);
    }
    lines.push(`#EXT-X-STREAM-INF:${streamInf.join(',')}`);
    lines.push(
      withToken(`/stash/scene/${input.sceneId}/variant/${profile.id}/master.m3u8`, input.token)
    );
  }
  return `${lines.join('\n')}\n`;
}

function filterProfilesForSource(
  profiles: HLSProfile[],
  source?: { width?: number; height?: number }
): HLSProfile[] {
  const sw = positive(source?.width);
  const sh = positive(source?.height);
  if (!sw && !sh) return profiles;
  const filtered = profiles.filter((p) => {
    if (sh && p.height > sh) return false;
    if (sw && p.width > sw) return false;
    return true;
  });
  return filtered.length > 0 ? filtered : [profiles[profiles.length - 1]];
}

function orderProfiles(profiles: HLSProfile[], preferredId?: string): HLSProfile[] {
  const sorted = [...profiles].sort((a, b) => b.bandwidthKbps - a.bandwidthKbps);
  if (!preferredId || preferredId === 'auto') return sorted;
  const idx = sorted.findIndex((p) => p.id === preferredId);
  if (idx < 0) return sorted;
  const [pref] = sorted.splice(idx, 1);
  return [pref, ...sorted];
}

function renditionMetadata(
  profile: HLSProfile,
  source?: { width?: number; height?: number; fps?: number }
): { width: number; height: number; fps?: number } {
  let { width, height } = profile;
  const sw = positive(source?.width);
  const sh = positive(source?.height);
  if (sw && sh) {
    height = Math.min(profile.height, sh);
    const ar = sw / sh;
    width = Math.max(2, Math.min(profile.width, sw, Math.floor((height * ar) / 2) * 2));
  }
  const fps = positive(source?.fps);
  return { width, height, fps: fps ? Math.min(fps, 120) : undefined };
}

function positive(n: number | undefined): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function withToken(uri: string, token?: string): string {
  if (!token) return uri;
  const sep = uri.includes('?') ? '&' : '?';
  return `${uri}${sep}token=${encodeURIComponent(token)}`;
}
