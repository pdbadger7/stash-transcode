import { describe, it, expect } from 'vitest';
import { parseRangeHeader } from '../src/directStream.js';

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
  });

  it('should clamp end to file size', () => {
    const result = parseRangeHeader('bytes=5000-999999', fileSize);
    expect(result.success).toBe(true);
    expect(result.end).toBe(9999);
  });
});
