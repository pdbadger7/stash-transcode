import { normalize } from 'path';
import type { PathMapping } from './types.js';

export class PathMapper {
  private mappings: PathMapping[];
  private mediaRoot: string;

  constructor(mappings: PathMapping[], mediaRoot: string) {
    this.mappings = mappings;
    this.mediaRoot = this.normalizePathForComparison(mediaRoot);
  }

  /**
   * Normalize path for consistent comparisons
   * Removes trailing slashes and resolves . and ..
   */
  private normalizePathForComparison(path: string): string {
    let normalized = normalize(path);
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  }

  /**
   * Map a Stash container path to the agent/NAS path
   * Prevents path traversal attacks
   */
  map(containerPath: string): { success: boolean; path?: string; error?: string } {
    const normalizedContainer = this.normalizePathForComparison(containerPath);

    // Try each mapping in order
    for (const mapping of this.mappings) {
      const normalizedFrom = this.normalizePathForComparison(mapping.from);
      const normalizedTo = this.normalizePathForComparison(mapping.to);

      if (normalizedContainer.startsWith(normalizedFrom)) {
        // Replace the prefix
        const relative = normalizedContainer.slice(normalizedFrom.length);
        let result = normalizedTo + relative;

        // Normalize to resolve any .. or .
        result = normalize(result);

        // Verify the result is within media root
        if (!this.isPathInRoot(result)) {
          return {
            success: false,
            error: `Mapped path would escape media root: ${result}`,
          };
        }

        return { success: true, path: result };
      }
    }

    return {
      success: false,
      error: `No mapping found for path: ${containerPath}`,
    };
  }

  /**
   * Check if a path is within the allowed media root
   * Prevents directory traversal attacks
   */
  private isPathInRoot(path: string): boolean {
    const normalized = this.normalizePathForComparison(path);
    const mediaRootNorm = this.mediaRoot;

    // Path must be inside media root
    if (normalized === mediaRootNorm) return true;
    if (normalized.startsWith(mediaRootNorm + '/')) return true;

    return false;
  }
}
