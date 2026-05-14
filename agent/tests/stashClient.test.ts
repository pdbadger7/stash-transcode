import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { StashClient } from '../src/stashClient.js';

describe('StashClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses a scene query that includes duration and source metadata when available', async () => {
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
    expect(query).toContain('duration');
    expect(query).toContain('width');
    expect(query).toContain('height');
    expect(query).toContain('fps');
    expect(query).not.toContain('videoCodec');
    expect(query).not.toContain('audioCodec');
  });

  it('falls back to progressively smaller scene queries when metadata fields are unsupported', async () => {
    const postSpy = vi
      .spyOn(axios, 'post')
      .mockResolvedValueOnce({
        data: {
          errors: [{ message: 'Cannot query field "fps" on type "Scene"' }],
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            findScene: {
              id: '5691',
              duration: 123,
              width: 1280,
              height: 720,
              files: [{ id: 'f1', path: '/data/video.mp4' }],
            },
          },
        },
      });

    const client = new StashClient('https://stash.example/graphql', 'api-key');
    const scene = await client.getScene('5691');

    expect(scene?.id).toBe('5691');
    expect(postSpy).toHaveBeenCalledTimes(2);
    const firstQuery = (postSpy.mock.calls[0]?.[1] as { query: string }).query;
    const secondQuery = (postSpy.mock.calls[1]?.[1] as { query: string }).query;
    expect(firstQuery).toContain('fps');
    expect(secondQuery).not.toContain('fps');
    expect(secondQuery).toContain('width');
    expect(secondQuery).toContain('height');
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
