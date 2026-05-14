import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'stream';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { produceSegment, produceSegmentToFile } from '../../src/hls/segmentProducer.js';

function fakeSpawn(stdoutChunks: Buffer[], exitCode = 0, stderrChunks: Buffer[] = []) {
  const proc: any = new EventEmitter();
  proc.stdout = Readable.from(stdoutChunks);
  proc.stderr = Readable.from(stderrChunks);
  proc.kill = vi.fn();
  setImmediate(() => proc.emit('exit', exitCode, null));
  return proc;
}

describe('produceSegment', () => {
  it('returns concatenated stdout bytes on success', async () => {
    const spawn = vi.fn(() => fakeSpawn([Buffer.from('AB'), Buffer.from('CD')]));
    const out = await produceSegment({
      ffmpegPath: 'ffmpeg',
      args: ['-version'],
      spawn,
    });
    expect(out.toString()).toBe('ABCD');
  });

  it('rejects when ffmpeg exits non-zero', async () => {
    const spawn = vi.fn(() => fakeSpawn([], 1, [Buffer.from('boom')]));
    await expect(
      produceSegment({ ffmpegPath: 'ffmpeg', args: [], spawn })
    ).rejects.toThrow(/exit code 1/);
  });

  it('kills the process when the abort signal fires and rejects', async () => {
    const proc: any = new EventEmitter();
    proc.stdout = new Readable({ read() {} });
    proc.stderr = new Readable({ read() {} });
    proc.kill = vi.fn(() => proc.emit('exit', null, 'SIGTERM'));
    const spawn = vi.fn(() => proc);
    const ac = new AbortController();
    const promise = produceSegment({
      ffmpegPath: 'ffmpeg',
      args: [],
      spawn,
      signal: ac.signal,
    });
    ac.abort();
    await expect(promise).rejects.toThrow(/aborted/i);
    expect(proc.kill).toHaveBeenCalled();
  });
});

describe('produceSegmentToFile', () => {
  it('writes stdout to a file without returning a Buffer', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'produce-file-'));
    const outputPath = path.join(dir, 'segment.tmp');
    const spawn = vi.fn(() => fakeSpawn([Buffer.from('AB'), Buffer.from('CD')]));

    await produceSegmentToFile({
      ffmpegPath: 'ffmpeg',
      args: ['-version'],
      outputPath,
      spawn,
    });

    expect((await fs.readFile(outputPath)).toString()).toBe('ABCD');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('removes the output file on failure', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'produce-file-'));
    const outputPath = path.join(dir, 'segment.tmp');
    const spawn = vi.fn(() => fakeSpawn([Buffer.from('partial')], 1, [Buffer.from('boom')]));

    await expect(
      produceSegmentToFile({ ffmpegPath: 'ffmpeg', args: [], outputPath, spawn })
    ).rejects.toThrow(/exit code 1/);
    await expect(fs.access(outputPath)).rejects.toThrow();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
