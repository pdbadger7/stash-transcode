import axios, { AxiosError } from 'axios';
import type { StashScene } from './types.js';

const STASH_SCENE_QUERY = `
  query FindScene($id: ID!) {
    findScene(id: $id) {
      id
      title
      duration
      width
      height
      files {
        id
        path
        duration
        videoCodec
        audioCodec
        width
        height
      }
    }
  }
`;

export class StashClient {
  private baseUrl: string;
  private apiKey: string;
  private insecureTls: boolean;

  constructor(baseUrl: string, apiKey: string, insecureTls = false) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.insecureTls = insecureTls;
  }

  async getScene(id: string): Promise<StashScene | null> {
    try {
      const response = await axios.post<{ data?: { findScene?: StashScene } }>(
        this.baseUrl,
        {
          query: STASH_SCENE_QUERY,
          variables: { id },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'ApiKey': this.apiKey,
          },
          httpsAgent: this.insecureTls
            ? { rejectUnauthorized: false }
            : undefined,
        }
      );

      const scene = response.data?.data?.findScene;
      return scene || null;
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
