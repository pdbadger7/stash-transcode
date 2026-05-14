import { spawn as nodeSpawn, type ChildProcess } from 'child_process';

export type SpawnFn = (cmd: string, args: string[], opts?: object) => ChildProcess;

export interface ProduceSegmentInput {
  ffmpegPath: string;
  args: string[];
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
