import { describe, expect, it } from 'vitest';
import {
  bindingToAccelerator,
  DEFAULT_TRAY_TOGGLE_BINDING,
  resolveTrayToggleBinding,
} from './keybindingAccelerator';

describe('resolveTrayToggleBinding', () => {
  it('缺省和脏值都回到默认绑定', () => {
    expect(resolveTrayToggleBinding(undefined)).toBe(DEFAULT_TRAY_TOGGLE_BINDING);
    expect(resolveTrayToggleBinding(null)).toBe(DEFAULT_TRAY_TOGGLE_BINDING);
    expect(resolveTrayToggleBinding({ 'toggle-minimize-to-tray': 1 })).toBe(
      DEFAULT_TRAY_TOGGLE_BINDING
    );
  });

  it('空字符串表示用户删掉了快捷键', () => {
    expect(resolveTrayToggleBinding({ 'toggle-minimize-to-tray': '' })).toBe('');
    expect(resolveTrayToggleBinding({ 'toggle-minimize-to-tray': '   ' })).toBe('');
  });

  it('采用用户覆盖', () => {
    expect(resolveTrayToggleBinding({ 'toggle-minimize-to-tray': 'mod+shift+h' })).toBe(
      'mod+shift+h'
    );
  });
});

describe('bindingToAccelerator', () => {
  it('把 mod 绑定转成跨平台全局快捷键', () => {
    expect(bindingToAccelerator('mod+shift+m')).toBe('CommandOrControl+Shift+M');
    expect(bindingToAccelerator('mod+,')).toBe('CommandOrControl+Comma');
    expect(bindingToAccelerator('ctrl+tab')).toBe('Control+Tab');
    expect(bindingToAccelerator('mod+alt+arrowup')).toBe('CommandOrControl+Alt+Up');
  });

  it('没有非 Shift 修饰键时拒绝，避免劫持输入', () => {
    expect(bindingToAccelerator('enter')).toBeNull();
    expect(bindingToAccelerator('shift+m')).toBeNull();
    expect(bindingToAccelerator('mod+')).toBeNull();
    expect(bindingToAccelerator('not-a-binding')).toBeNull();
  });
});
