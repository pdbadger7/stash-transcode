import { createReadStream, promises as fs, type ReadStream } from 'fs';

export interface RangeParseResult {
  success: boolean;
  start?: number;
  end?: number;
  error?: string;
  statusCode?: 400 | 416;
}

export interface FileRange {
  start: number;
  end: number;
  size: number;
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
    return { success: false, error: 'Invalid range format', statusCode: 400 };
  }

  const ranges = rangeHeader.slice(6).split(',')[0].trim();
  if (!ranges || ranges.split('-').length !== 2) {
    return { success: false, error: 'Invalid range format', statusCode: 400 };
  }

  if (ranges.startsWith('-')) {
    // Suffix range: -500 means last 500 bytes
    const length = parseInt(ranges.slice(1), 10);
    if (!Number.isFinite(length) || length <= 0) {
      return { success: false, error: 'Invalid range length', statusCode: 400 };
    }
    return {
      success: true,
      start: Math.max(0, fileSize - length),
      end: fileSize - 1,
    };
  }

  const [startStr, endStr] = ranges.split('-');
  const start = parseInt(startStr, 10);

  if (!/^\d+$/.test(startStr) || !Number.isFinite(start)) {
    return { success: false, error: 'Invalid range start', statusCode: 400 };
  }

  let end = fileSize - 1;
  if (endStr !== '') {
    end = parseInt(endStr, 10);
    if (!/^\d+$/.test(endStr) || !Number.isFinite(end)) {
      return { success: false, error: 'Invalid range end', statusCode: 400 };
    }
  }

  // Validate range
  if (start > end || start >= fileSize) {
    return {
      success: false,
      error: 'Range not satisfiable',
      statusCode: 416,
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

export function createFileReadStream(
  filePath: string,
  range?: { start?: number; end?: number }
): ReadStream {
  return createReadStream(filePath, range);
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
    m4s: 'video/iso.segment',
    ts: 'video/mp2t',
    m3u8: 'application/vnd.apple.mpegurl',
  };

  return mimeTypes[ext] || 'application/octet-stream';
}
