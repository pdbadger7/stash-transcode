import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import { promises as fs } from 'fs';
import { loadConfig } from './config.js';
import { StashClient } from './stashClient.js';
import { PathMapper } from './pathMapper.js';
import { AuthValidator } from './auth.js';
import { HLSStream } from './hlsStream.js';
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
  hwaccel: config.hwaccel as 'none' | 'vaapi' | 'qsv' | 'nvenc',
  segmentDuration: 4,
  enableDebug: process.env.DEBUG === 'true',
});

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
app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
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
app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
  '/stash/scene/:id/master.m3u8',
  async (request, reply) => {
    const { id } = request.params;
    const { token } = request.query;

    if (!authValidator.validateQueryToken(token)) {
      return reply.code(403).send({ ok: false, error: 'Unauthorized' });
    }

    try {
      const scene = await stashClient.getScene(id);
      if (!scene) {
        return reply.code(404).send({ ok: false, error: 'Scene not found' });
      }

      if (!scene.files || scene.files.length === 0) {
        return reply
          .code(400)
          .send({ ok: false, error: 'Scene has no files' });
      }

      const filePath = scene.files[0].path;
      const mapResult = pathMapper.map(filePath);

      if (!mapResult.success || !mapResult.path) {
        return reply
          .code(400)
          .send({
            ok: false,
            error: mapResult.error || 'Path mapping failed',
          });
      }

      const playlist = await hlsStream.getMasterPlaylist(id, mapResult.path);

      reply
        .header('Content-Type', 'application/vnd.apple.mpegurl')
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

// HLS segment endpoint
app.get<{
  Params: { id: string; segmentName: string };
  Querystring: { token?: string };
}>(
  '/stash/scene/:id/segment/:segmentName',
  async (request, reply) => {
    const { id, segmentName } = request.params;
    const { token } = request.query;

    if (!authValidator.validateQueryToken(token)) {
      return reply.code(403).send({ ok: false, error: 'Unauthorized' });
    }

    // Security: prevent directory traversal
    if (segmentName.includes('..') || segmentName.startsWith('/')) {
      return reply.code(400).send({
        ok: false,
        error: 'Invalid segment name',
      });
    }

    try {
      const segment = await hlsStream.getSegment(id, segmentName);

      if (!segment) {
        return reply.code(404).send({ ok: false, error: 'Segment not found' });
      }

      const contentType = segmentName.endsWith('.ts')
        ? 'video/mp2t'
        : 'application/octet-stream';

      reply
        .header('Content-Type', contentType)
        .header('Cache-Control', 'public, max-age=3600')
        .send(segment);
    } catch (err) {
      console.error(
        `Failed to serve segment ${segmentName} for scene ${id}:`,
        err
      );
      return reply.code(500).send({
        ok: false,
        error: 'Failed to serve segment',
      });
    }
  }
);

// Cleanup old transcodes periodically (every 30 minutes)
setInterval(() => {
  hlsStream.cleanupOldTranscodes();
}, 30 * 60 * 1000);

// Start server
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Agent listening on port ${config.port}`);
