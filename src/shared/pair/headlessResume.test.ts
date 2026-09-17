import { describe, expect, it } from 'vitest';
import { planPairResume } from './headlessResume';

const conversation = {
  sessionId: 's1',
  projectId: 'p1',
  sessionFile: '/tmp/s1.jsonl',
  lastProviderId: 'prov',
  lastModelId: 'model',
};

describe('planPairResume', () => {
  it('snapshots a session already alive in the worker', () => {
    expect(
      planPairResume({
        alive: true,
        conversation,
        projectPath: '/proj',
        loadLocalSkills: true,
      })
    ).toEqual({ type: 'snapshot' });
  });

  it('spawns from persisted metadata when the worker has no projection', () => {
    expect(
      planPairResume({
        alive: false,
        conversation: { ...conversation, reasoningEnabled: true, thinkingLevel: 'high' },
        projectPath: '/proj',
        worktreePath: '/proj/.enso/s1',
        loadLocalSkills: false,
      })
    ).toEqual({
      type: 'spawn',
      request: {
        sessionId: 's1',
        providerId: 'prov',
        modelId: 'model',
        cwd: '/proj/.enso/s1',
        resumeFile: '/tmp/s1.jsonl',
        loadLocalSkills: false,
        reasoningEnabled: true,
        thinkingLevel: 'high',
      },
    });
  });

  it('skips when the worktree is gone or the model/file is missing', () => {
    expect(
      planPairResume({
        alive: false,
        conversation,
        projectPath: '/proj',
        worktreeMissing: true,
        loadLocalSkills: true,
      }).type
    ).toBe('skip');
    expect(
      planPairResume({
        alive: false,
        conversation: { sessionId: 's1', projectId: 'p1' },
        projectPath: '/proj',
        loadLocalSkills: true,
      }).type
    ).toBe('skip');
    expect(
      planPairResume({
        alive: false,
        conversation: null,
        projectPath: '/proj',
        loadLocalSkills: true,
      }).type
    ).toBe('skip');
  });
});
