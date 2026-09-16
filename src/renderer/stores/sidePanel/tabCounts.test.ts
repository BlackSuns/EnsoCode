import { describe, expect, it } from 'vitest';
import { countSidePanelTabs } from './tabCounts';

const layout = (panels: unknown) => ({ panels });

describe('countSidePanelTabs', () => {
  it('returns zeros for missing or dirty layouts', () => {
    expect(countSidePanelTabs(undefined)).toEqual({ browsers: 0, terminals: 0 });
    expect(countSidePanelTabs(null)).toEqual({ browsers: 0, terminals: 0 });
    expect(countSidePanelTabs('wide')).toEqual({ browsers: 0, terminals: 0 });
    expect(countSidePanelTabs({ panels: ['browser'] })).toEqual({ browsers: 0, terminals: 0 });
    expect(countSidePanelTabs({ panels: null })).toEqual({ browsers: 0, terminals: 0 });
  });

  it('counts browser and terminal panels and ignores other kinds', () => {
    expect(
      countSidePanelTabs(
        layout({
          files: { id: 'files', contentComponent: 'files' },
          changes: { id: 'changes', contentComponent: 'changes' },
          t1: { id: 't1', contentComponent: 'terminal' },
          t2: { id: 't2', contentComponent: 'terminal' },
          b1: { id: 'browser:1', contentComponent: 'browser' },
          skip: { id: 'x', contentComponent: 1 },
          nil: null,
        })
      )
    ).toEqual({ browsers: 1, terminals: 2 });
  });

  it('treats browser: ids as browsers when contentComponent is missing', () => {
    expect(
      countSidePanelTabs(
        layout({
          legacy: { id: 'browser' },
          live: { id: 'browser:abc' },
          other: { id: 'files' },
        })
      )
    ).toEqual({ browsers: 2, terminals: 0 });
  });

  it('counts browser: keys even when contentComponent is not browser', () => {
    expect(
      countSidePanelTabs(
        layout({
          'browser:1': { contentComponent: 'unknown' },
          'browser:2': { id: 'browser:2', contentComponent: 'props.defaultTabComponent' },
          files: { id: 'files', contentComponent: 'files' },
        })
      )
    ).toEqual({ browsers: 2, terminals: 0 });
  });

  it('treats component as a contentComponent fallback', () => {
    expect(
      countSidePanelTabs(
        layout({
          b: { id: 'b', component: 'browser' },
          t: { id: 't', component: 'terminal' },
        })
      )
    ).toEqual({ browsers: 1, terminals: 1 });
  });
});
