export interface RemuxHlsArgsInput {
  inputPath: string;
  outputDir: string;
  segmentDuration: number;
  readRate?: number;
  videoCodec?: string;
}

export function buildRemuxHlsArgs(input: RemuxHlsArgsInput): string[] {
  const args = [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-nostdin',
    '-y',
  ];

  if (input.readRate !== undefined && input.readRate > 0) {
    args.push('-readrate', String(input.readRate));
  }

  args.push(
    '-i',
    input.inputPath,
    '-copyts',
    '-start_at_zero',
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-c:v',
    'copy',
    '-c:a',
    'copy'
  );

  if (normalizeVideoCodec(input.videoCodec) === 'hevc') {
    args.push('-tag:v', 'hvc1');
  }

  args.push(
    '-f',
    'hls',
    '-hls_segment_type',
    'fmp4',
    '-hls_time',
    String(input.segmentDuration),
    '-muxdelay',
    '0',
    '-muxpreload',
    '0',
    '-hls_list_size',
    '0',
    '-hls_playlist_type',
    'event',
    '-hls_flags',
    'independent_segments+temp_file',
    '-hls_fmp4_init_filename',
    'init.mp4',
    '-hls_segment_filename',
    `${input.outputDir}/segment_%03d.m4s`,
    `${input.outputDir}/master.m3u8`
  );

  return args;
}

export function normalizeVideoCodec(codec?: string): string | undefined {
  const normalized = codec?.trim().toLowerCase().replace(/[._\s-]/g, '');
  if (!normalized) return undefined;
  if (normalized === 'h264' || normalized === 'avc' || normalized === 'avc1') return 'h264';
  if (normalized === 'h265' || normalized === 'hevc' || normalized === 'hev1' || normalized === 'hvc1') {
    return 'hevc';
  }
  return normalized;
}
