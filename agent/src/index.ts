import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import { constants as fsConstants, promises as fs } from 'fs';
import { loadConfig } from './config.js';
import { StashClient } from './stashClient.js';
import { PathMapper } from './pathMapper.js';
import { AuthValidator } from './auth.js';
import { HLSStream, type SourceVideoMetadata } from './hlsStream.js';
import { DEFAULT_HLS_PROFILES } from './hls/profiles.js';
import {
  parseRangeHeader,
  getFileSize,
  readFileRange,
  createRangeHeaders,
  getMimeType,
} from './directStream.js';

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
  segmentDuration: config.hlsSegmentDuration,
  lookaheadSegments: config.hlsLookaheadSegments,
  maxSessions: config.hlsMaxSessions,
  singleSegmentTimeoutMs: config.hlsSegmentTimeoutMs,
  enableDebug: process.env.DEBUG === 'true',
});

type SceneInputContext = {
  sceneId: string;
  inputPath: string;
  sourceMetadata: SourceVideoMetadata;
};

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
      mode: ['direct', 'hls'],
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
        return reply.code(400).send({
          ok: false,
          error: rangeResult.error,
        });
      }

      const { start = 0, end = fileSize - 1 } = rangeResult;
      const buffer = await readFileRange(filePath, start, end);

      reply
        .code(206)
        .header('Content-Type', getMimeType(filePath))
        .header('Content-Length', String(end - start + 1))
        .header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
        .header('Accept-Ranges', 'bytes')
        .send(buffer);
    } else {
      // Full file response
      const buffer = await fs.readFile(filePath);
      reply
        .header('Content-Type', getMimeType(filePath))
        .header('Content-Length', String(fileSize))
        .header('Accept-Ranges', 'bytes')
        .send(buffer);
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
      const sceneContext = await resolveSceneInputContext(id);
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
    const sceneContext = await resolveSceneInputContext(id);
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

    const sceneContext = await resolveSceneInputContext(id);
    if (!sceneContext) {
      return reply.code(404).send({ ok: false, error: 'Scene not found' });
    }

    const ac = new AbortController();
    request.raw.on('close', () => {
      if (!request.raw.complete) ac.abort();
    });

    try {
      const segment = await hlsStream.getSegment({
        sceneId: id,
        profileId: profile,
        segmentName,
        inputPath: sceneContext.inputPath,
        sourceMetadata: sceneContext.sourceMetadata,
        abortSignal: ac.signal,
      });
      if (!segment) {
        return reply.code(404).send({ ok: false, error: 'Segment not found' });
      }
      reply
        .header('Content-Type', hlsStream.getSegmentMimeType(segmentName))
        .header('Cache-Control', 'public, max-age=3600')
        .header('Content-Length', String(segment.length))
        .send(segment);
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

  const sceneContext = await resolveSceneInputContext(id);
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
    const segment = await hlsStream.getSegment({
      sceneId: id,
      profileId: fallbackProfile,
      segmentName,
      inputPath: sceneContext.inputPath,
      sourceMetadata: sceneContext.sourceMetadata,
      abortSignal: ac.signal,
    });

    if (!segment) {
      return reply.code(404).send({ ok: false, error: 'Segment not found' });
    }

    reply
      .header('Content-Type', hlsStream.getSegmentMimeType(segmentName))
      .header('Cache-Control', 'public, max-age=3600')
      .send(segment);
  } catch (err) {
    if (ac.signal.aborted) return;
    console.error(`Failed to serve segment ${segmentName} for scene ${id}:`, err);
    return reply.code(500).send({
      ok: false,
      error: 'Failed to serve segment',
    });
  }
});

// Cleanup old transcodes periodically (every 30 minutes)
setInterval(() => {
  hlsStream.cleanupOldTranscodes();
}, 30 * 60 * 1000);

app.addHook('onClose', async () => {
  hlsStream.shutdown();
});

// Start server
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Agent listening on port ${config.port}`);
