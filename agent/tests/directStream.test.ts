import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { ReadStream } from 'fs';
import { createFileReadStream, getMimeType, parseRangeHeader } from '../src/directStream.js';

describe('DirectStream Range Parsing', () => {
  const fileSize = 10000;

  it('should parse bytes=0-1023', () => {
    const result = parseRangeHeader('bytes=0-1023', fileSize);
    expect(result.success).toBe(true);
    expect(result.start).toBe(0);
    expect(result.end).toBe(1023);
  });

  it('should parse bytes=1024-', () => {
    const result = parseRangeHeader('bytes=1024-', fileSize);
    expect(result.success).toBe(true);
    expect(result.start).toBe(1024);
    expect(result.end).toBe(9999);
  });

  it('should parse suffix range bytes=-1024', () => {
    const result = parseRangeHeader('bytes=-1024', fileSize);
    expect(result.success).toBe(true);
    expect(result.start).toBe(8976); // fileSize - 1024
    expect(result.end).toBe(9999);
  });

  it('should reject invalid range format', () => {
    const result = parseRangeHeader('invalid', fileSize);
    expect(result.success).toBe(false);
  });

  it('should reject out of bounds ranges', () => {
    const result = parseRangeHeader('bytes=15000-16000', fileSize);
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(416);
  });

  it('should reject malformed ranges as bad requests', () => {
    const result = parseRangeHeader('bytes=abc-def', fileSize);
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  it('should clamp end to file size', () => {
    const result = parseRangeHeader('bytes=5000-999999', fileSize);
    expect(result.success).toBe(true);
    expect(result.end).toBe(9999);
  });

  it('should detect hls mime types', () => {
    expect(getMimeType('playlist.m3u8')).toBe('application/vnd.apple.mpegurl');
    expect(getMimeType('segment.ts')).toBe('video/mp2t');
  });

  it('creates a read stream for direct responses', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'direct-stream-'));
    const file = path.join(dir, 'video.mp4');
    await fs.writeFile(file, 'abcdef');
    const stream = createFileReadStream(file, { start: 1, end: 3 });
    expect(stream).toBeInstanceOf(ReadStream);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('bcd');
    await fs.rm(dir, { recursive: true, force: true });
  });
});
