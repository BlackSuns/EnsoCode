import { describe, expect, it } from 'vitest';
import { resolveColorScheme } from './colorScheme';

describe('resolveColorScheme', () => {
  it('light / dark 跟随应用偏好，不看系统', () => {
    expect(resolveColorScheme('light', { prefersDark: true, terminalIsDark: true })).toBe('light');
    expect(resolveColorScheme('dark', { prefersDark: false, terminalIsDark: false })).toBe('dark');
  });

  it('system 跟随 prefers-color-scheme', () => {
    expect(resolveColorScheme('system', { prefersDark: true, terminalIsDark: false })).toBe('dark');
    expect(resolveColorScheme('system', { prefersDark: false, terminalIsDark: true })).toBe(
      'light'
    );
  });

  it('sync-terminal 跟随终端底色深浅', () => {
    expect(resolveColorScheme('sync-terminal', { prefersDark: false, terminalIsDark: true })).toBe(
      'dark'
    );
    expect(resolveColorScheme('sync-terminal', { prefersDark: true, terminalIsDark: false })).toBe(
      'light'
    );
  });
});
