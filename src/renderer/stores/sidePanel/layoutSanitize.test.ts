import { describe, expect, it } from 'vitest';
import { sanitizeSidePanelLayout } from './layoutSanitize';

const known = new Set(['terminal', 'browser', 'changes', 'files']);

describe('sanitizeSidePanelLayout', () => {
  it('returns undefined for dirty layouts', () => {
    expect(sanitizeSidePanelLayout(undefined, known)).toBeUndefined();
    expect(sanitizeSidePanelLayout(null, known)).toBeUndefined();
    expect(sanitizeSidePanelLayout('wide', known)).toBeUndefined();
    expect(sanitizeSidePanelLayout({ panels: [] }, known)).toBeUndefined();
  });

  it('drops unknown panels and their grid views', () => {
    const sanitized = sanitizeSidePanelLayout(
      {
        grid: {
          root: {
            type: 'branch',
            data: [
              {
                type: 'leaf',
                data: {
                  views: ['t1', 'btw:1', 'browser:1'],
                  activeView: 'btw:1',
                  id: 'g1',
                },
                size: 100,
              },
            ],
            size: 100,
          },
          width: 100,
          height: 100,
          orientation: 'HORIZONTAL',
        },
        panels: {
          t1: { id: 't1', contentComponent: 'terminal' },
          'btw:1': { id: 'btw:1', contentComponent: 'btw' },
          'browser:1': { id: 'browser:1', contentComponent: 'browser' },
        },
        activeGroup: 'g1',
      },
      known
    );
    expect(sanitized?.panels).toEqual({
      t1: { id: 't1', contentComponent: 'terminal' },
      'browser:1': { id: 'browser:1', contentComponent: 'browser' },
    });
    expect(sanitized?.grid).toEqual({
      root: {
        type: 'branch',
        data: [
          {
            type: 'leaf',
            data: {
              views: ['t1', 'browser:1'],
              activeView: 't1',
              id: 'g1',
            },
            size: 100,
          },
        ],
        size: 100,
      },
      width: 100,
      height: 100,
      orientation: 'HORIZONTAL',
    });
  });

  it('returns undefined when nothing known remains', () => {
    expect(
      sanitizeSidePanelLayout(
        {
          grid: {
            root: {
              type: 'branch',
              data: [
                {
                  type: 'leaf',
                  data: { views: ['btw:1'], activeView: 'btw:1', id: 'g1' },
                  size: 100,
                },
              ],
              size: 100,
            },
            width: 100,
            height: 100,
            orientation: 'HORIZONTAL',
          },
          panels: { 'btw:1': { id: 'btw:1', contentComponent: 'btw' } },
        },
        known
      )
    ).toBeUndefined();
  });
});
