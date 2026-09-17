import { describe, expect, it } from 'vitest';
import {
  catalogEntryFromPairSession,
  catalogQueued,
  patchCatalogEntry,
  upsertCatalogEntry,
} from './headlessCatalog';

const base = {
  id: 's1',
  title: 'One',
  projectName: 'proj',
  projectId: 'p1',
  status: 'idle',
};

describe('headless catalog', () => {
  it('patches a known entry and prepends unknown ones', () => {
    expect(patchCatalogEntry([base], 's1', { status: 'running' })[0]?.status).toBe('running');
    const created = upsertCatalogEntry([base], { ...base, id: 's2', title: 'Two' });
    expect(created.map((entry) => entry.id)).toEqual(['s2', 's1']);
  });

  it('builds a phone catalog row from a pair spawn', () => {
    const entry = catalogEntryFromPairSession(
      {
        sessionId: 's9',
        projectId: 'p1',
        providerId: 'prov',
        modelId: 'm',
        reasoningEnabled: false,
      },
      'proj'
    );
    expect(entry).toMatchObject({
      id: 's9',
      projectId: 'p1',
      status: 'idle',
      providerId: 'prov',
      modelId: 'm',
    });
  });

  it('marks queued images without sending bytes', () => {
    expect(
      catalogQueued([{ id: 'q1', text: 'hi', images: [{ data: 'x', mimeType: 'image/png' }] }])
    ).toEqual([{ id: 'q1', text: 'hi', hasImages: true }]);
  });
});
