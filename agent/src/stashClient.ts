import axios, { AxiosError } from 'axios';
import https from 'https';
import type { StashScene } from './types.js';

const STASH_SCENE_QUERY_WITH_SOURCE_METADATA = `
  query FindScene($id: ID!) {
    findScene(id: $id) {
      id
      files {
        id
        path
        duration
        width
        height
        frame_rate
      }
    }
  }
`;

const STASH_SCENE_QUERY_MINIMAL = `
  query FindScene($id: ID!) {
    findScene(id: $id) {
      id
      files {
        id
        path
      }
    }
  }
`;

type GraphQLError = {
  message?: string;
};

type FindSceneResponse = {
  data?: {
    findScene?: StashScene;
  };
  errors?: GraphQLError[];
};

function buildSceneIdCandidates(id: string): string[] {
  const normalizedId = id.trim();
  const candidates = new Set<string>();

  if (normalizedId.length > 0) {
    candidates.add(normalizedId);
    candidates.add(Buffer.from(`Scene:${normalizedId}`).toString('base64'));
    candidates.add(Buffer.from(`scene:${normalizedId}`).toString('base64'));
  }

  return [...candidates];
}

export class StashClient {
  private baseUrl: string;
  private apiKey: string;
  private httpsAgent?: https.Agent;

  constructor(baseUrl: string, apiKey: string, insecureTls = false) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    if (insecureTls) {
      this.httpsAgent = new https.Agent({ rejectUnauthorized: false });
    }
  }

  async getScene(id: string): Promise<StashScene | null> {
    try {
      const idCandidates = buildSceneIdCandidates(id);
      for (const candidateId of idCandidates) {
        const queryFallbacks = [
          STASH_SCENE_QUERY_WITH_SOURCE_METADATA,
          STASH_SCENE_QUERY_MINIMAL,
        ];

        for (let queryIndex = 0; queryIndex < queryFallbacks.length; queryIndex += 1) {
          const query = queryFallbacks[queryIndex];
          const response = await this.fetchScene(candidateId, query);
          const unsupportedFieldError = response.data?.errors?.some((error) =>
            (error.message ?? '').startsWith('Cannot query field')
          );

          if (response.data?.errors?.length && (!unsupportedFieldError || queryIndex === queryFallbacks.length - 1)) {
            console.error(
              `GraphQL errors while fetching scene ${id} (candidate ${candidateId}):`,
              response.data.errors.map((error) => error.message).filter(Boolean)
            );
          }

          const scene = response.data?.data?.findScene;
          if (scene) {
            return scene;
          }

          if (!unsupportedFieldError) {
            break;
          }
        }
      }

      return null;
    } catch (error) {
      if (error instanceof AxiosError) {
        console.error(
          `Failed to fetch scene ${id}: ${error.message}`,
          error.response?.data
        );
      } else {
        console.error(`Failed to fetch scene ${id}:`, error);
      }
      return null;
    }
  }

  private fetchScene(candidateId: string, query: string) {
    return axios.post<FindSceneResponse>(
      this.baseUrl,
      {
        query,
        variables: { id: candidateId },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'ApiKey': this.apiKey,
        },
        httpsAgent: this.httpsAgent,
      }
    );
  }
}
