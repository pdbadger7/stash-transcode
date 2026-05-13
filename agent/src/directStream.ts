import { promises as fs } from 'fs';
import type { RangeRequest } from './types.js';

const CHUNK_SIZE = 1024 * 1024; // 1MB chunks for Range requests

export interface RangeParseResult {
  success: boolean;
  start?: number;
  end?: number;
  error?: string;
}

/**
 * Parse HTTP Range header
 * Supports: bytes=0-1023, bytes=1024-, bytes=-1024
 */
export function parseRangeHeader(
  rangeHeader: string,
  fileSize: number
): RangeParseResult {
  if (!rangeHeader.startsWith('bytes=')) {
    return { success: false, error: 'Invalid range format' };
  }

  const ranges = rangeHeader.slice(6).split(',')[0].trim();

  if (ranges.startsWith('-')) {
    // Suffix range: -500 means last 500 bytes
    const length = parseInt(ranges.slice(1), 10);
    if (isNaN(length)) {
      return { success: false, error: 'Invalid range length' };
    }
    return {
      success: true,
      start: Math.max(0, fileSize - length),
      end: fileSize - 1,
    };
  }

  const [startStr, endStr] = ranges.split('-');
  const start = parseInt(startStr, 10);

  if (isNaN(start)) {
    return { success: false, error: 'Invalid range start' };
  }

  let end = fileSize - 1;
  if (endStr) {
    end = parseInt(endStr, 10);
    if (isNaN(end)) {
      return { success: false, error: 'Invalid range end' };
    }
  }

  // Validate range
  if (start > end || start >= fileSize) {
    return {
      success: false,
      error: 'Range out of bounds',
    };
  }

  return {
    success: true,
    start,
    end: Math.min(end, fileSize - 1),
  };
}

/**
 * Get file size
 */
export async function getFileSize(filePath: string): Promise<number> {
  const stat = await fs.stat(filePath);
  return stat.size;
}

/**
 * Read file chunk for Range request
 */
export async function readFileRange(
  filePath: string,
  start: number,
  end: number
): Promise<Buffer> {
  const fd = await fs.open(filePath, 'r');
  try {
    const length = end - start + 1;
    const buffer = Buffer.alloc(length);
    await fd.read(buffer, 0, length, start);
    return buffer;
  } finally {
    await fd.close();
  }
}

/**
 * Create Range response headers
 */
export function createRangeHeaders(
  start: number,
  end: number,
  fileSize: number,
  mimeType: string
): Record<string, string> {
  return {
    'Content-Type': mimeType,
    'Content-Length': String(end - start + 1),
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
  };
}

/**
 * Infer MIME type from file extension
 */
export function getMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop() || '';

  const mimeTypes: Record<string, string> = {
    mkv: 'video/x-matroska',
    mp4: 'video/mp4',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
    flv: 'video/x-flv',
    wmv: 'video/x-ms-wmv',
    m4v: 'video/x-m4v',
    ts: 'video/mp2t',
    m3u8: 'application/vnd.apple.mpegurl',
  };

  return mimeTypes[ext] || 'application/octet-stream';
}
