import axios, { AxiosError } from 'axios';
import https from 'https';
import type { StashScene } from './types.js';

const STASH_SCENE_QUERY = `
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
        const response = await axios.post<FindSceneResponse>(
          this.baseUrl,
          {
            query: STASH_SCENE_QUERY,
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

        if (response.data?.errors?.length) {
          console.error(
            `GraphQL errors while fetching scene ${id} (candidate ${candidateId}):`,
            response.data.errors.map((error) => error.message).filter(Boolean)
          );
        }

        const scene = response.data?.data?.findScene;
        if (scene) {
          return scene;
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
}
