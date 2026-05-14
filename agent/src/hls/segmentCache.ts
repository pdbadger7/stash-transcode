import { existsSync, promises as fs } from 'fs';
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
    return existsSync(this.pathFor(sceneId, profileId, index));
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
