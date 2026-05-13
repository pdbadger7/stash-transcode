import axios, { AxiosError } from 'axios';
import https from 'https';
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
          httpsAgent: this.httpsAgent,
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
