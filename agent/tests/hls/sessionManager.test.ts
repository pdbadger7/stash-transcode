import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { SessionManager } from '../../src/hls/sessionManager.js';

function makeProc() {
  const p: any = new EventEmitter();
  p.kill = vi.fn(() => p.emit('exit', null, 'SIGTERM'));
  p.stdout = new EventEmitter();
  p.stderr = new EventEmitter();
  return p;
}

describe('SessionManager', () => {
  it('starts a session on first noteRequest', () => {
    const spawn = vi.fn(() => makeProc());
    const buildArgs = vi.fn(() => ['ARGS']);
    const m = new SessionManager({
      ffmpegPath: 'ffmpeg',
      segmentDuration: 4,
      lookaheadSegments: 10,
      maxSessions: 4,
      spawn,
      buildArgs,
    });
    m.noteRequest({ sceneId: 'sc', profileId: '720p', index: 0, inputPath: '/x.mp4', mode: 'none', profile: anyProfile() });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(buildArgs.mock.calls[0][0].segmentCount).toBe(10);
    expect(m.activeSessions()).toEqual([{ sceneId: 'sc', profileId: '720p', head: 1 }]);
  });

  it('does not restart a session if the requested index is within lookahead', () => {
    const spawn = vi.fn(() => makeProc());
    const m = new SessionManager({
      ffmpegPath: 'ffmpeg',
      segmentDuration: 4,
      lookaheadSegments: 10,
      maxSessions: 4,
      spawn,
      buildArgs: () => ['ARGS'],
    });
    const req = { sceneId: 'sc', profileId: '720p', inputPath: '/x.mp4', mode: 'none' as const, profile: anyProfile() };
    m.noteRequest({ ...req, index: 0 });
    m.noteRequest({ ...req, index: 5 });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing session and starts another window when seeking past the lookahead horizon', () => {
    const spawn = vi.fn(() => makeProc());
    const m = new SessionManager({
      ffmpegPath: 'ffmpeg',
      segmentDuration: 4,
      lookaheadSegments: 10,
      maxSessions: 4,
      spawn,
      buildArgs: () => ['ARGS'],
    });
    const req = { sceneId: 'sc', profileId: '720p', inputPath: '/x.mp4', mode: 'none' as const, profile: anyProfile() };
    m.noteRequest({ ...req, index: 0 });
    m.noteRequest({ ...req, index: 100 });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(m.activeSessions().map((s) => s.head).sort((a, b) => a - b)).toEqual([1, 101]);
  });

  it('reports whether an active session can produce a specific segment', () => {
    const spawn = vi.fn(() => makeProc());
    const m = new SessionManager({
      ffmpegPath: 'ffmpeg',
      segmentDuration: 4,
      lookaheadSegments: 10,
      maxSessions: 4,
      spawn,
      buildArgs: () => ['ARGS'],
    });
    m.noteRequest({ sceneId: 'sc', profileId: '720p', index: 100, inputPath: '/x.mp4', mode: 'none', profile: anyProfile() });
    expect(m.canProduce('sc', '720p', 105)).toBe(true);
    expect(m.canProduce('sc', '720p', 0)).toBe(false);
  });

  it('shutdown() kills all sessions', () => {
    const procs: any[] = [];
    const spawn = vi.fn(() => {
      const p = makeProc();
      procs.push(p);
      return p;
    });
    const m = new SessionManager({
      ffmpegPath: 'ffmpeg',
      segmentDuration: 4,
      lookaheadSegments: 10,
      maxSessions: 4,
      spawn,
      buildArgs: () => ['ARGS'],
    });
    m.noteRequest({ sceneId: 'a', profileId: '720p', index: 0, inputPath: '/x.mp4', mode: 'none', profile: anyProfile() });
    m.noteRequest({ sceneId: 'b', profileId: '720p', index: 0, inputPath: '/y.mp4', mode: 'none', profile: anyProfile() });
    m.shutdown();
    expect(procs.every((p) => p.kill.mock.calls.length > 0)).toBe(true);
    expect(m.activeSessions()).toHaveLength(0);
  });

  it('evicts the oldest session when maxSessions is exceeded', () => {
    const procs: any[] = [];
    const spawn = vi.fn(() => {
      const p = makeProc();
      procs.push(p);
      return p;
    });
    const m = new SessionManager({
      ffmpegPath: 'ffmpeg',
      segmentDuration: 4,
      lookaheadSegments: 10,
      maxSessions: 2,
      spawn,
      buildArgs: () => ['ARGS'],
    });
    const r = (sceneId: string) => ({
      sceneId, profileId: '720p', index: 0, inputPath: '/x.mp4', mode: 'none' as const, profile: anyProfile(),
    });
    m.noteRequest(r('a'));
    m.noteRequest(r('b'));
    m.noteRequest(r('c'));
    expect(procs[0].kill).toHaveBeenCalled();
    expect(m.activeSessions().map((s) => s.sceneId).sort()).toEqual(['b', 'c']);
  });
});

function anyProfile() {
  return { id: '720p', label: '720p', width: 1280, height: 720, videoBitrateKbps: 3500, bandwidthKbps: 4200 };
}
