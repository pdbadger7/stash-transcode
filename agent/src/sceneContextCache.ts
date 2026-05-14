import { constants as fsConstants, promises as fs } from 'fs';
import type { SourceVideoMetadata } from './hlsStream.js';

export interface SceneInputContext {
  sceneId: string;
  inputPath: string;
  sourceMetadata: SourceVideoMetadata;
}

export interface CachedSceneContext extends SceneInputContext {
  expiresAt: number;
}

interface CacheEntry {
  value: SceneInputContext | null;
  expiresAt: number;
  lastValidatedAt: number;
}

export class SceneContextCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly missTtlMs = 5_000,
    private readonly revalidateMs = 30_000
  ) {}

  async getOrResolve(
    sceneId: string,
    resolver: () => Promise<SceneInputContext | null>
  ): Promise<SceneInputContext | null> {
    const now = Date.now();
    const cached = this.entries.get(sceneId);
    if (cached && cached.expiresAt > now) {
      if (!cached.value) return null;
      if (now - cached.lastValidatedAt <= this.revalidateMs) return cached.value;
      try {
        await fs.access(cached.value.inputPath, fsConstants.R_OK);
        cached.lastValidatedAt = now;
        return cached.value;
      } catch {
        this.entries.delete(sceneId);
      }
    }

    const resolved = await resolver();
    this.entries.set(sceneId, {
      value: resolved,
      expiresAt: now + (resolved ? this.ttlMs : this.missTtlMs),
      lastValidatedAt: now,
    });
    return resolved;
  }

  delete(sceneId: string): void {
    this.entries.delete(sceneId);
  }

  clear(): void {
    this.entries.clear();
  }
}
