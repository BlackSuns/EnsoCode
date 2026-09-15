import { describe, expect, it } from 'vitest';
import { cssColorToHex, stampThemeColorMetas } from './themeColor';
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

describe('cssColorToHex', () => {
  it('hex / rgb 规约成 #rrggbb', () => {
    expect(cssColorToHex('#fff')).toBe('#ffffff');
    expect(cssColorToHex('#252529')).toBe('#252529');
    expect(cssColorToHex('rgb(255, 255, 255)')).toBe('#ffffff');
    expect(cssColorToHex('rgba(37, 37, 41, 1)')).toBe('#252529');
    expect(cssColorToHex('rgb(37 37 41)')).toBe('#252529');
  });

  it('全透明不算有效底色', () => {
    expect(cssColorToHex('rgba(0, 0, 0, 0)')).toBeNull();
    expect(cssColorToHex('rgb(0 0 0 / 0)')).toBeNull();
  });
});

describe('stampThemeColorMetas', () => {
  it('改已有节点，去掉 media，不删重插', () => {
    const ops: string[][] = [];
    stampThemeColorMetas(
      [
        {
          removeAttribute: (name) => ops.push(['remove', name]),
          setAttribute: (name, value) => ops.push(['set', name, value]),
        },
      ],
      '#252529'
    );
    expect(ops).toEqual([
      ['remove', 'media'],
      ['set', 'content', '#252529'],
    ]);
  });
});
