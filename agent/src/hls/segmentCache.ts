import { createReadStream, existsSync, promises as fs, type ReadStream, type Stats } from 'fs';
import path from 'path';

const SAFE_ID = /^[A-Za-z0-9_.-]+$/;

export class SegmentCache {
  constructor(private readonly rootDir: string) {}

  pathFor(sceneId: string, profileId: string, index: number): string {
    if (!SAFE_ID.test(sceneId) || !SAFE_ID.test(profileId)) {
      throw new Error(`Invalid id: ${sceneId}/${profileId}`);
    }
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`Invalid segment index: ${index}`);
    }
    const name = `segment_${String(index).padStart(3, '0')}.ts`;
    return path.join(this.rootDir, sceneId, profileId, name);
  }

  async has(sceneId: string, profileId: string, index: number): Promise<boolean> {
    return (await this.stat(sceneId, profileId, index)) !== null;
  }

  async stat(sceneId: string, profileId: string, index: number): Promise<Stats | null> {
    try {
      const stat = await fs.stat(this.pathFor(sceneId, profileId, index));
      return stat.isFile() ? stat : null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  createReadStream(sceneId: string, profileId: string, index: number): ReadStream {
    return createReadStream(this.pathFor(sceneId, profileId, index));
  }

  async openAsset(
    sceneId: string,
    profileId: string,
    index: number
  ): Promise<{ stream: ReadStream; size: number } | null> {
    const stat = await this.stat(sceneId, profileId, index);
    if (!stat) return null;
    if (stat.size <= 0) {
      await fs.rm(this.pathFor(sceneId, profileId, index), { force: true });
      return null;
    }
    return {
      stream: this.createReadStream(sceneId, profileId, index),
      size: stat.size,
    };
  }

  async waitForAsset(
    sceneId: string,
    profileId: string,
    index: number,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<{ stream: ReadStream; size: number } | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (signal?.aborted) return null;
      const asset = await this.openAsset(sceneId, profileId, index);
      if (asset) return asset;
      await sleep(60, signal);
    }
    return null;
  }

  async read(sceneId: string, profileId: string, index: number): Promise<Buffer> {
    return fs.readFile(this.pathFor(sceneId, profileId, index));
  }

  async write(sceneId: string, profileId: string, index: number, data: Buffer): Promise<void> {
    const target = this.pathFor(sceneId, profileId, index);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, target);
  }

  async produceAtomic(
    sceneId: string,
    profileId: string,
    index: number,
    producer: (tmpPath: string) => Promise<void>
  ): Promise<void> {
    const target = this.pathFor(sceneId, profileId, index);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await producer(tmp);
      const stat = await fs.stat(tmp);
      if (stat.size <= 0) {
        throw new Error(`Refusing to cache empty segment ${sceneId}/${profileId}/${index}`);
      }
      await fs.rename(tmp, target);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  profileDir(sceneId: string, profileId: string): string {
    if (!SAFE_ID.test(sceneId) || !SAFE_ID.test(profileId)) {
      throw new Error(`Invalid id: ${sceneId}/${profileId}`);
    }
    return path.join(this.rootDir, sceneId, profileId);
  }

  async cleanup(
    maxAgeMs: number,
    isInUse: (sceneId: string, profileId: string) => boolean
  ): Promise<void> {
    if (!existsSync(this.rootDir)) return;
    const scenes = await fs.readdir(this.rootDir, { withFileTypes: true });
    for (const scene of scenes) {
      if (!scene.isDirectory()) continue;
      const sceneDir = path.join(this.rootDir, scene.name);
      const profiles = await fs.readdir(sceneDir, { withFileTypes: true });
      for (const profile of profiles) {
        if (!profile.isDirectory()) continue;
        if (isInUse(scene.name, profile.name)) continue;
        const profileDir = path.join(sceneDir, profile.name);
        const stat = await fs.stat(profileDir);
        if (Date.now() - stat.mtimeMs > maxAgeMs) {
          await fs.rm(profileDir, { recursive: true, force: true });
        }
      }
    }
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}
