import { describe, expect, it } from 'vitest';
import { settingsThemeFromPhone } from './themePreference';

describe('settingsThemeFromPhone', () => {
  it('本地覆盖优先，不跟桌面或系统', () => {
    expect(settingsThemeFromPhone('dark', 'light')).toEqual({
      theme: 'dark',
      syncTerminalTheme: false,
    });
    expect(settingsThemeFromPhone('light', 'sync-terminal')).toEqual({
      theme: 'light',
      syncTerminalTheme: false,
    });
  });

  it('无覆盖时把桌面 appearance 原样交给 pierre themeType', () => {
    expect(settingsThemeFromPhone('auto', 'dark')).toEqual({
      theme: 'dark',
      syncTerminalTheme: false,
    });
    expect(settingsThemeFromPhone('auto', 'system')).toEqual({
      theme: 'system',
      syncTerminalTheme: false,
    });
    expect(settingsThemeFromPhone('auto', 'sync-terminal')).toEqual({
      theme: 'sync-terminal',
      syncTerminalTheme: true,
    });
  });
});
