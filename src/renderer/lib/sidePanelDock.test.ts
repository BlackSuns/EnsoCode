import { describe, expect, it } from 'vitest';
import { resolveSidePanelDockConversationId } from './sidePanelDockId';

describe('resolveSidePanelDockConversationId', () => {
  it('普通会话用自身 id', () => {
    expect(resolveSidePanelDockConversationId({ parent: {} }, 'parent')).toBe('parent');
  });

  it('btw 会话落到父会话 dock，用户才能看见浏览器', () => {
    expect(
      resolveSidePanelDockConversationId(
        {
          parent: {},
          btw: { btwParentId: 'parent' },
        },
        'btw'
      )
    ).toBe('parent');
  });

  it('未知会话保持原 id', () => {
    expect(resolveSidePanelDockConversationId({}, 'missing')).toBe('missing');
  });
});
