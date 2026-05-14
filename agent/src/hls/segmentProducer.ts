import { spawn as nodeSpawn, type ChildProcess } from 'child_process';
import { createWriteStream, promises as fs } from 'fs';

export type SpawnFn = (cmd: string, args: string[], opts?: object) => ChildProcess;

export interface ProduceSegmentInput {
  ffmpegPath: string;
  args: string[];
  spawn?: SpawnFn;
  signal?: AbortSignal;
  maxBytes?: number;
}

export interface ProduceSegmentToFileInput {
  ffmpegPath: string;
  args: string[];
  outputPath: string;
  spawn?: SpawnFn;
  signal?: AbortSignal;
  maxBytes?: number;
}

export async function produceSegment(input: ProduceSegmentInput): Promise<Buffer> {
  const spawn = input.spawn ?? (nodeSpawn as unknown as SpawnFn);
  const maxBytes = input.maxBytes ?? 256 * 1024 * 1024;
  const proc = spawn(input.ffmpegPath, input.args, { stdio: ['ignore', 'pipe', 'pipe'] });

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onAbort = () => {
      settle(() => reject(new Error('aborted')));
      try {
        proc.kill('SIGTERM');
      } catch {}
    };

    const cleanup = () => {
      if (input.signal) input.signal.removeEventListener('abort', onAbort);
    };

    if (input.signal) {
      if (input.signal.aborted) {
        onAbort();
        return;
      }
      input.signal.addEventListener('abort', onAbort, { once: true });
    }

    proc.stdout?.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        try { proc.kill('SIGTERM'); } catch {}
        settle(() => reject(new Error(`segment exceeded maxBytes=${maxBytes}`)));
        return;
      }
      chunks.push(chunk);
    });
    proc.stderr?.on('data', (chunk: Buffer) => errChunks.push(chunk));
    proc.on('error', (err) => settle(() => reject(err)));
    proc.on('exit', (code, sig) => {
      if (code === 0) {
        settle(() => resolve(Buffer.concat(chunks, total)));
      } else {
        const stderr = Buffer.concat(errChunks).toString('utf-8').slice(0, 4_000);
        settle(() =>
          reject(new Error(`ffmpeg exit code ${code} signal ${sig}: ${stderr}`))
        );
      }
    });
  });
}

export async function produceSegmentToFile(input: ProduceSegmentToFileInput): Promise<void> {
  const spawn = input.spawn ?? (nodeSpawn as unknown as SpawnFn);
  const maxBytes = input.maxBytes ?? 256 * 1024 * 1024;
  const proc = spawn(input.ffmpegPath, input.args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const out = createWriteStream(input.outputPath, { flags: 'wx' });

  return new Promise<void>((resolve, reject) => {
    const errChunks: Buffer[] = [];
    let total = 0;
    let procDone = false;
    let streamDone = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let settled = false;
    let stderrBytes = 0;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        proc.kill('SIGTERM');
      } catch {}
      out.destroy();
      fs.rm(input.outputPath, { force: true }).finally(() => reject(err));
    };

    const maybeResolve = () => {
      if (settled || !procDone || !streamDone) return;
      if (exitCode === 0) {
        settled = true;
        cleanup();
        resolve();
        return;
      }
      const stderr = Buffer.concat(errChunks).toString('utf-8').slice(0, 4_000);
      fail(new Error(`ffmpeg exit code ${exitCode} signal ${exitSignal}: ${stderr}`));
    };

    const onAbort = () => fail(new Error('aborted'));
    const cleanup = () => {
      if (input.signal) input.signal.removeEventListener('abort', onAbort);
    };

    if (input.signal) {
      if (input.signal.aborted) {
        onAbort();
        return;
      }
      input.signal.addEventListener('abort', onAbort, { once: true });
    }

    proc.stdout?.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        fail(new Error(`segment exceeded maxBytes=${maxBytes}`));
        return;
      }
      if (!out.write(chunk)) {
        proc.stdout?.pause();
      }
    });
    out.on('drain', () => proc.stdout?.resume());
    proc.stdout?.on('end', () => out.end());
    proc.stderr?.on('data', (chunk: Buffer) => {
      errChunks.push(chunk);
      stderrBytes += chunk.length;
      while (stderrBytes > 4_000 && errChunks.length > 1) {
        const removed = errChunks.shift();
        stderrBytes -= removed?.length ?? 0;
      }
    });
    out.on('error', (err) => fail(err));
    out.on('close', () => {
      streamDone = true;
      maybeResolve();
    });
    proc.on('error', (err) => fail(err));
    proc.on('exit', (code, sig) => {
      procDone = true;
      exitCode = code;
      exitSignal = sig;
      if (code !== 0) out.end();
      maybeResolve();
    });
  });
}
