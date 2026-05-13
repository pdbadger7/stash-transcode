import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { StashClient } from '../src/stashClient.js';

describe('StashClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses a minimal scene query compatible across stash schemas', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({
      data: {
        data: {
          findScene: {
            id: '5691',
            files: [{ id: 'f1', path: '/data/video.mp4' }],
          },
        },
      },
    });

    const client = new StashClient('https://stash.example/graphql', 'api-key');
    await client.getScene('5691');

    const [, payload] = postSpy.mock.calls[0] ?? [];
    const query = (payload as { query: string }).query;

    expect(query).toContain('findScene(id: $id)');
    expect(query).toContain('files');
    expect(query).toContain('path');
    expect(query).not.toContain('videoCodec');
    expect(query).not.toContain('audioCodec');
    expect(query).not.toContain('width');
    expect(query).not.toContain('height');
    expect(query).not.toContain('duration');
  });

  it('returns null when GraphQL responds with errors and no scene', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue({
      data: {
        errors: [{ message: 'Cannot query field "videoCodec" on type "File"' }],
      },
    });

    const client = new StashClient('https://stash.example/graphql', 'api-key');
    const scene = await client.getScene('5691');

    expect(scene).toBeNull();
  });

  it('retries scene lookup with relay-style encoded IDs', async () => {
    const postSpy = vi
      .spyOn(axios, 'post')
      .mockResolvedValueOnce({
        data: {
          data: {
            findScene: null,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            findScene: {
              id: '5691',
              files: [{ id: 'f1', path: '/data/video.mp4' }],
            },
          },
        },
      });

    const client = new StashClient('https://stash.example/graphql', 'api-key');
    const scene = await client.getScene('5691');

    expect(scene?.id).toBe('5691');
    expect(postSpy).toHaveBeenCalledTimes(2);
    const firstPayload = postSpy.mock.calls[0]?.[1] as { variables: { id: string } };
    const secondPayload = postSpy.mock.calls[1]?.[1] as { variables: { id: string } };
    expect(firstPayload.variables.id).toBe('5691');
    expect(secondPayload.variables.id).toBe(Buffer.from('Scene:5691').toString('base64'));
  });
});
