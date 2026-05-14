import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import { constants as fsConstants, promises as fs } from 'fs';
import { loadConfig } from './config.js';
import { StashClient } from './stashClient.js';
import { PathMapper } from './pathMapper.js';
import { AuthValidator } from './auth.js';
import { HLSStream } from './hlsStream.js';
import {
  RemuxHLSStream,
  RemuxNotEligibleError,
  RemuxNotReadyError,
} from './remuxHlsStream.js';
import { DEFAULT_HLS_PROFILES } from './hls/profiles.js';
import {
  parseRangeHeader,
  getFileSize,
  createFileReadStream,
  getMimeType,
} from './directStream.js';
import { SceneContextCache, type SceneInputContext } from './sceneContextCache.js';

const config = loadConfig();
const stashClient = new StashClient(
  config.stashGraphqlUrl,
  config.stashApiKey,
  config.stashInsecureTls
);
const pathMapper = new PathMapper(config.pathMappings, config.mediaRoot);
const authValidator = new AuthValidator(config.agentSharedToken);
const hlsStream = new HLSStream({
  cacheDir: config.hlsCacheDir,
  ffmpegPath: config.ffmpegPath,
  hwaccel: config.hwaccel,
  hwaccelDevice: config.hwaccelDevice,
  segmentDuration: config.hlsSegmentDuration,
  lookaheadSegments: config.hlsLookaheadSegments,
  maxSessions: config.hlsMaxSessions,
  singleSegmentTimeoutMs: config.hlsSegmentTimeoutMs,
  enableDebug: process.env.DEBUG === 'true',
});
const remuxHlsStream = new RemuxHLSStream({
  cacheDir: config.hlsCacheDir,
  ffmpegPath: config.ffmpegPath,
  segmentDuration: config.hlsSegmentDuration,
  allowedVideoCodecs: config.remuxHlsVideoCodecs,
  readRate: config.remuxHlsReadRate,
  startOffsetSeconds: config.remuxHlsStartOffsetSeconds,
  readyTimeoutMs: config.remuxHlsReadyTimeoutMs,
  enableDebug: process.env.DEBUG === 'true',
});

async function resolveSceneInputContext(sceneId: string): Promise<SceneInputContext | null> {
  const scene = await stashClient.getScene(sceneId);
  if (!scene || !scene.files || scene.files.length === 0) {
    return null;
  }

  const file = scene.files[0];
  const mappingResult = pathMapper.map(file.path);
  if (!mappingResult.success || !mappingResult.path) {
    return null;
  }

  try {
    await fs.access(mappingResult.path, fsConstants.R_OK);
  } catch {
    return null;
  }

  return {
    sceneId: scene.id,
    inputPath: mappingResult.path,
    sourceMetadata: {
      durationSeconds: file.duration,
      width: file.width,
      height: file.height,
      fps: file.frame_rate,
      videoCodec: file.video_codec,
    },
  };
}

const SCENE_CONTEXT_CACHE_TTL_MS = 10 * 60 * 1000;
const sceneContextCache = new SceneContextCache(SCENE_CONTEXT_CACHE_TTL_MS);

async function getSceneInputContextCached(sceneId: string): Promise<SceneInputContext | null> {
  return sceneContextCache.getOrResolve(sceneId, () => resolveSceneInputContext(sceneId));
}

const app = Fastify({
  logger: true,
});

// Register CORS
await app.register(fastifyCors, {
  origin: config.corsAllowedOrigins,
  credentials: true,
});

// Health check
app.get('/health', async () => {
  return { ok: true, timestamp: new Date().toISOString() };
});

// Probe endpoint - check if scene can be served
app.get<{ Params: { id: string }; Querystring: { token?: string; quality?: string } }>(
  '/stash/scene/:id/probe',
  async (request, reply) => {
    const { id } = request.params;
    const { token } = request.query;

    // Validate token
    if (!authValidator.validateQueryToken(token)) {
      return reply.code(403).send({ ok: false, error: 'Unauthorized' });
    }

    // Fetch scene from Stash
    const scene = await stashClient.getScene(id);
    if (!scene) {
      return reply
        .code(404)
        .send({ ok: false, error: 'Scene not found in Stash' });
    }

    // Get primary file
    const file = scene.files?.[0];
    if (!file) {
      return reply.code(404).send({
        ok: false,
        error: 'Scene has no files',
      });
    }

    // Map path
    const mappingResult = pathMapper.map(file.path);
    if (!mappingResult.success) {
      return reply.code(403).send({
        ok: false,
        error: mappingResult.error,
      });
    }

    // Check if file exists and is readable
    try {
      await fs.access(mappingResult.path!, fs.constants.R_OK);
    } catch {
      return reply.code(404).send({
        ok: false,
        error: 'File not accessible',
      });
    }

    return {
      ok: true,
      scene_id: scene.id,
      mode: [
        'direct',
        'hls',
        ...(remuxHlsStream.canRemux({
          durationSeconds: file.duration,
          width: file.width,
          height: file.height,
          fps: file.frame_rate,
          videoCodec: file.video_codec,
        })
          ? ['remux-hls']
          : []),
      ],
      path_mapped: true,
      duration_seconds: file.duration,
      width: file.width,
      height: file.height,
      fps: file.frame_rate,
    };
  }
);

// Direct playback endpoint - serves the file with Range request support
app.get<{
  Params: { id: string };
  Querystring: { token?: string };
}>(
  '/stash/scene/:id/direct',
  async (request, reply) => {
    const { id } = request.params;
    const { token } = request.query;

    // Validate token
    if (!authValidator.validateQueryToken(token)) {
      return reply.code(403).send({ ok: false, error: 'Unauthorized' });
    }

    // Fetch scene
    const scene = await stashClient.getScene(id);
    if (!scene) {
      return reply.code(404).send({
        ok: false,
        error: 'Scene not found',
      });
    }

    // Get primary file
    const file = scene.files?.[0];
    if (!file) {
      return reply.code(404).send({
        ok: false,
        error: 'No file found',
      });
    }

    // Map path
    const mappingResult = pathMapper.map(file.path);
    if (!mappingResult.success) {
      return reply.code(403).send({
        ok: false,
        error: 'Path mapping failed',
      });
    }

    const filePath = mappingResult.path!;

    // Check file exists
    try {
      await fs.access(filePath, fs.constants.R_OK);
    } catch {
      return reply.code(404).send({
        ok: false,
        error: 'File not found or not readable',
      });
    }

    // Get file size
    const fileSize = await getFileSize(filePath);
    const rangeHeader = request.headers.range;

    if (rangeHeader) {
      // Handle Range request
      const rangeResult = parseRangeHeader(rangeHeader, fileSize);
      if (!rangeResult.success) {
        if (rangeResult.statusCode === 416) {
          return reply
            .code(416)
            .header('Content-Range', `bytes */${fileSize}`)
            .header('Accept-Ranges', 'bytes')
            .send({
              ok: false,
              error: rangeResult.error,
            });
        }
        return reply.code(400).send({
          ok: false,
          error: rangeResult.error,
        });
      }

      const { start = 0, end = fileSize - 1 } = rangeResult;
      const stream = createFileReadStream(filePath, { start, end });
      request.raw.on('close', () => {
        if (!request.raw.complete) stream.destroy();
      });

      reply
        .code(206)
        .header('Content-Type', getMimeType(filePath))
        .header('Content-Length', String(end - start + 1))
        .header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
        .header('Accept-Ranges', 'bytes')
        .header('Cache-Control', 'public, max-age=3600')
        .send(stream);
    } else {
      // Full file response
      const stream = createFileReadStream(filePath);
      request.raw.on('close', () => {
        if (!request.raw.complete) stream.destroy();
      });
      reply
        .header('Content-Type', getMimeType(filePath))
        .header('Content-Length', String(fileSize))
        .header('Accept-Ranges', 'bytes')
        .header('Cache-Control', 'public, max-age=3600')
        .send(stream);
    }
  }
);

// HLS master.m3u8 endpoint
app.get<{ Params: { id: string }; Querystring: { token?: string; quality?: string } }>(
  '/stash/scene/:id/master.m3u8',
  async (request, reply) => {
    const { id } = request.params;
    const { token } = request.query;

    if (!authValidator.validateQueryToken(token)) {
      return reply.code(403).send({ ok: false, error: 'Unauthorized' });
    }

    try {
      const sceneContext = await getSceneInputContextCached(id);
      if (!sceneContext) {
        return reply.code(404).send({ ok: false, error: 'Scene not found' });
      }

      const playlist = await hlsStream.getMasterPlaylist(
        id,
        sceneContext.inputPath,
        request.query.quality,
        token,
        sceneContext.sourceMetadata
      );

      reply
        .header('Content-Type', hlsStream.getPlaylistMimeType())
        .header('Cache-Control', 'no-cache')
        .send(playlist);
    } catch (err) {
      console.error(`Failed to generate HLS playlist for scene ${id}:`, err);
      return reply.code(500).send({
        ok: false,
        error: 'Failed to generate HLS stream',
      });
    }
  }
);

app.get<{
  Params: { id: string; profile: string };
  Querystring: { token?: string };
}>('/stash/scene/:id/variant/:profile/master.m3u8', async (request, reply) => {
  const { id, profile } = request.params;
  const { token } = request.query;

  if (!authValidator.validateQueryToken(token)) {
    return reply.code(403).send({ ok: false, error: 'Unauthorized' });
  }

  try {
    const sceneContext = await getSceneInputContextCached(id);
    if (!sceneContext) {
      return reply.code(404).send({ ok: false, error: 'Scene not found' });
    }

    const playlist = await hlsStream.getVariantPlaylist(
      id,
      profile,
      sceneContext.inputPath,
      token,
      sceneContext.sourceMetadata
    );
    reply
      .header('Content-Type', hlsStream.getPlaylistMimeType())
      .header('Cache-Control', 'no-cache')
      .send(playlist);
  } catch (err) {
    console.error(`Failed to generate variant playlist for scene ${id}:`, err);
    return reply.code(500).send({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to generate variant',
    });
  }
});

// HLS segment endpoint
app.get<{
  Params: { id: string; profile: string; segmentName: string };
  Querystring: { token?: string };
}>(
  '/stash/scene/:id/variant/:profile/:segmentName',
  async (request, reply) => {
    const { id, profile, segmentName } = request.params;
    const { token } = request.query;

    if (!authValidator.validateQueryToken(token)) {
      return reply.code(403).send({ ok: false, error: 'Unauthorized' });
    }

    if (segmentName.includes('..') || segmentName.startsWith('/')) {
      return reply.code(400).send({
        ok: false,
        error: 'Invalid segment name',
      });
    }

    const sceneContext = await getSceneInputContextCached(id);
    if (!sceneContext) {
      return reply.code(404).send({ ok: false, error: 'Scene not found' });
    }

    const ac = new AbortController();
    request.raw.on('close', () => {
      if (!request.raw.complete) ac.abort();
    });

    try {
      const asset = await hlsStream.getSegmentAsset({
        sceneId: id,
        profileId: profile,
        segmentName,
        inputPath: sceneContext.inputPath,
        sourceMetadata: sceneContext.sourceMetadata,
        abortSignal: ac.signal,
      });
      if (!asset) {
        return reply.code(404).send({ ok: false, error: 'Segment not found' });
      }
      request.raw.on('close', () => {
        if (!request.raw.complete) asset.stream.destroy();
      });
      reply
        .header('Content-Type', hlsStream.getSegmentMimeType(segmentName))
        .header('Cache-Control', 'public, max-age=3600')
        .header('Content-Length', String(asset.size))
        .send(asset.stream);
    } catch (err) {
      if (ac.signal.aborted) return;
      console.error(`Segment ${segmentName} for ${id}/${profile} failed:`, err);
      return reply.code(500).send({
        ok: false,
        error: err instanceof Error ? err.message : 'Segment production failed',
      });
    }
  }
);

app.get<{
  Params: { id: string; segmentName: string };
  Querystring: { token?: string };
}>('/stash/scene/:id/segment/:segmentName', async (request, reply) => {
  const { id, segmentName } = request.params;
  const { token } = request.query;

  if (!authValidator.validateQueryToken(token)) {
    return reply.code(403).send({ ok: false, error: 'Unauthorized' });
  }

  if (segmentName.includes('..') || segmentName.startsWith('/')) {
    return reply.code(400).send({
      ok: false,
      error: 'Invalid segment name',
    });
  }

  const sceneContext = await getSceneInputContextCached(id);
  if (!sceneContext) {
    return reply.code(404).send({ ok: false, error: 'Scene not found' });
  }

  const ac = new AbortController();
  request.raw.on('close', () => {
    if (!request.raw.complete) ac.abort();
  });

  try {
    const fallbackProfile =
      DEFAULT_HLS_PROFILES.find((profile) => profile.id === '720p')?.id ??
      DEFAULT_HLS_PROFILES[0].id;
    const asset = await hlsStream.getSegmentAsset({
      sceneId: id,
      profileId: fallbackProfile,
      segmentName,
      inputPath: sceneContext.inputPath,
      sourceMetadata: sceneContext.sourceMetadata,
      abortSignal: ac.signal,
    });

    if (!asset) {
      return reply.code(404).send({ ok: false, error: 'Segment not found' });
    }

    request.raw.on('close', () => {
      if (!request.raw.complete) asset.stream.destroy();
    });
    reply
      .header('Content-Type', hlsStream.getSegmentMimeType(segmentName))
      .header('Cache-Control', 'public, max-age=3600')
      .header('Content-Length', String(asset.size))
      .send(asset.stream);
  } catch (err) {
    if (ac.signal.aborted) return;
    console.error(`Failed to serve segment ${segmentName} for scene ${id}:`, err);
    return reply.code(500).send({
      ok: false,
      error: 'Failed to serve segment',
    });
  }
});

app.get<{
  Params: { id: string };
  Querystring: { token?: string };
}>('/stash/scene/:id/remux/master.m3u8', async (request, reply) => {
  const { id } = request.params;
  const { token } = request.query;

  // Explicitly set CORS headers for this endpoint
  const origin = request.headers.origin;
  if (origin) {
    const isOriginAllowed =
      config.corsAllowedOrigins === true ||
      (Array.isArray(config.corsAllowedOrigins) && config.corsAllowedOrigins.includes(origin));

    if (isOriginAllowed) {
      reply
        .header('Access-Control-Allow-Origin', origin)
        .header('Access-Control-Allow-Credentials', 'true');
    }
  }

  if (!authValidator.validateQueryToken(token)) {
    return reply.code(403).send({ ok: false, error: 'Unauthorized' });
  }

  try {
    const sceneContext = await getSceneInputContextCached(id);
    if (!sceneContext) {
      return reply.code(404).send({ ok: false, error: 'Scene not found' });
    }

    const playlist = await remuxHlsStream.getPlaylist({
      sceneId: id,
      inputPath: sceneContext.inputPath,
      sourceMetadata: sceneContext.sourceMetadata,
      token,
    });

    reply
      .header('Content-Type', remuxHlsStream.getPlaylistMimeType())
      .header('Cache-Control', 'no-cache')
      .send(playlist);
  } catch (err) {
    if (err instanceof RemuxNotEligibleError) {
      return reply.code(422).send({ ok: false, error: err.message });
    }
    if (err instanceof RemuxNotReadyError) {
      return reply
        .code(503)
        .header('Retry-After', String(err.retryAfterSeconds))
        .send({ ok: false, error: err.message });
    }
    console.error(`Failed to generate remux HLS playlist for scene ${id}:`, err);
    return reply.code(500).send({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to generate remux HLS',
    });
  }
});

app.get<{
  Params: { id: string; assetName: string };
  Querystring: { token?: string };
}>('/stash/scene/:id/remux/:assetName', async (request, reply) => {
  const { id, assetName } = request.params;
  const { token } = request.query;

  // Explicitly set CORS headers for this endpoint
  const origin = request.headers.origin;
  if (origin) {
    const isOriginAllowed =
      config.corsAllowedOrigins === true ||
      (Array.isArray(config.corsAllowedOrigins) && config.corsAllowedOrigins.includes(origin));

    if (isOriginAllowed) {
      reply
        .header('Access-Control-Allow-Origin', origin)
        .header('Access-Control-Allow-Credentials', 'true');
    }
  }

  if (!authValidator.validateQueryToken(token)) {
    return reply.code(403).send({ ok: false, error: 'Unauthorized' });
  }

  try {
    const asset = await remuxHlsStream.getAsset({ sceneId: id, assetName });
    if (!asset) {
      return reply.code(404).send({ ok: false, error: 'Remux asset not found' });
    }

    reply
      .header('Content-Type', remuxHlsStream.getAssetMimeType(assetName))
      .header('Cache-Control', 'public, max-age=3600')
      .header('Content-Length', String(asset.size))
      .send(asset.stream);
  } catch (err) {
    if (err instanceof RemuxNotReadyError) {
      return reply
        .code(503)
        .header('Retry-After', String(err.retryAfterSeconds))
        .send({ ok: false, error: err.message });
    }
    if (err instanceof Error && /invalid remux asset/i.test(err.message)) {
      return reply.code(400).send({ ok: false, error: 'Invalid remux asset name' });
    }
    console.error(`Failed to serve remux asset ${assetName} for scene ${id}:`, err);
    return reply.code(500).send({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to serve remux asset',
    });
  }
});

// Cleanup old transcodes periodically (every 30 minutes)
setInterval(() => {
  hlsStream.cleanupOldTranscodes();
}, 30 * 60 * 1000);

app.addHook('onClose', async () => {
  hlsStream.shutdown();
  remuxHlsStream.shutdown();
});

// Start server
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Agent listening on port ${config.port}`);
