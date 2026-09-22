import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ reveal: vi.fn(), addToast: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ addToast: mocks.addToast }));

import { openDirectoryFromMenu, openDirectoryLabel } from './openDirectoryAction';

describe('open directory menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reveal.mockResolvedValue({ ok: true });
    vi.stubGlobal('window', { electronAPI: { projects: { reveal: mocks.reveal } } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['darwin', 'Open in Finder'],
    ['win32', 'Open in File Explorer'],
    ['linux', 'Open in File Manager'],
  ])('uses the native file manager label for %s', (platform, label) => {
    expect(openDirectoryLabel(platform)).toBe(label);
  });

  it('sends only project and conversation identifiers, leaving path resolution to Main', async () => {
    await openDirectoryFromMenu(
      { projectId: 'project', conversationId: 'worktree-chat' },
      (s) => s
    );
    expect(mocks.reveal).toHaveBeenCalledWith({
      projectId: 'project',
      conversationId: 'worktree-chat',
    });
    expect(mocks.addToast).not.toHaveBeenCalled();
  });

  it('keeps project-only requests supported', async () => {
    await openDirectoryFromMenu({ projectId: 'project' }, (s) => s);
    expect(mocks.reveal).toHaveBeenCalledWith({ projectId: 'project' });
  });

  it.each([false, true])('shows a failure when opening fails (rejection=%s)', async (reject) => {
    if (reject) mocks.reveal.mockRejectedValue(new Error('Cannot open directory'));
    else mocks.reveal.mockResolvedValue({ ok: false, error: 'Cannot open directory' });
    await openDirectoryFromMenu({ projectId: 'project' }, (s) => s);
    expect(mocks.addToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        description: expect.stringContaining('Cannot open directory'),
      })
    );
  });
});
