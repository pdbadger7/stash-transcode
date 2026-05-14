import { z } from 'zod';
import type { PathMapping, Config } from './types.js';

const pathMappingSchema = z
  .string()
  .transform((s) => {
    const parts = s.split('=');
    if (parts.length !== 2) throw new Error('Invalid path mapping format');
    return { from: parts[0], to: parts[1] };
  });

const configSchema = z.object({
  stashGraphqlUrl: z.string().url(),
  stashApiKey: z.string(),
  stashInsecureTls: z.boolean().default(false),
  pathMappings: z
    .string()
    .transform((s) => s.split(',').map((m) => pathMappingSchema.parse(m.trim())))
    .default(''),
  mediaRoot: z.string(),
  agentBaseUrl: z.string().url(),
  hlsCacheDir: z.string(),
  ffmpegPath: z.string().default('/usr/bin/ffmpeg'),
  hwaccel: z.enum(['none', 'auto', 'vaapi', 'qsv', 'nvenc']).default('auto'),
  hwaccelDevice: z.string().optional(),
  hlsSegmentDuration: z.coerce.number().int().positive().default(4),
  hlsLookaheadSegments: z.coerce.number().int().positive().default(15),
  hlsMaxSessions: z.coerce.number().int().positive().default(4),
  hlsSegmentTimeoutMs: z.coerce.number().int().positive().default(45000),
  port: z.coerce.number().default(8080),
  agentSharedToken: z.string().optional(),
  corsAllowedOrigins: z
    .string()
    .optional()
    .transform((s) => {
      if (!s || s.trim() === '' || s.trim() === '*') {
        return true;
      }

      const origins = s
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o.length > 0);

      return origins.length > 0 ? origins : true;
    }),
});

export function loadConfig(): Config {
  const env = process.env;

  // Validate required environment variables
  if (!env.STASH_GRAPHQL_URL) throw new Error('STASH_GRAPHQL_URL not set');
  if (!env.STASH_API_KEY) throw new Error('STASH_API_KEY not set');
  if (!env.MEDIA_ROOT) throw new Error('MEDIA_ROOT not set');
  if (!env.AGENT_BASE_URL) throw new Error('AGENT_BASE_URL not set');
  if (!env.HLS_CACHE_DIR) throw new Error('HLS_CACHE_DIR not set');

  const config = configSchema.parse({
    stashGraphqlUrl: env.STASH_GRAPHQL_URL,
    stashApiKey: env.STASH_API_KEY,
    stashInsecureTls: env.STASH_INSECURE_TLS === 'true',
    pathMappings: env.PATH_MAPPINGS || '',
    mediaRoot: env.MEDIA_ROOT,
    agentBaseUrl: env.AGENT_BASE_URL,
    hlsCacheDir: env.HLS_CACHE_DIR,
    ffmpegPath: env.FFMPEG_PATH,
    hwaccel: env.HWACCEL || 'auto',
    hwaccelDevice: env.HWACCEL_DEVICE,
    hlsSegmentDuration: env.HLS_SEGMENT_DURATION,
    hlsLookaheadSegments: env.HLS_LOOKAHEAD_SEGMENTS,
    hlsMaxSessions: env.HLS_MAX_SESSIONS,
    hlsSegmentTimeoutMs: env.HLS_SEGMENT_TIMEOUT_MS,
    port: env.PORT || '8080',
    agentSharedToken: env.AGENT_SHARED_TOKEN,
    corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS,
  });

  return config as Config;
}
