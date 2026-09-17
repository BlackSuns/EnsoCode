import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  eventToBinding,
  formatBinding,
  IS_MAC,
  KEYBINDING_ACTIONS,
} from './keybindings';

function keyEvent(partial: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): KeyboardEvent {
  return {
    key: partial.key,
    metaKey: partial.metaKey ?? false,
    ctrlKey: partial.ctrlKey ?? false,
    altKey: partial.altKey ?? false,
    shiftKey: partial.shiftKey ?? false,
  } as KeyboardEvent;
}

describe('send-message binding', () => {
  it('defaults to Enter', () => {
    expect(KEYBINDING_ACTIONS).toContain('send-message');
    expect(DEFAULT_KEYBINDINGS['send-message']).toBe('enter');
  });

  it('allowBare 只放行 Enter 家族，字母仍要修饰键', () => {
    expect(eventToBinding(keyEvent({ key: 'Enter' }))).toBeNull();
    expect(eventToBinding(keyEvent({ key: 'Enter' }), { allowBare: true })).toBe('enter');
    expect(eventToBinding(keyEvent({ key: 'Enter', shiftKey: true }), { allowBare: true })).toBe(
      'shift+enter'
    );
    expect(eventToBinding(keyEvent({ key: 'a' }), { allowBare: true })).toBeNull();
  });

  it('mod+Enter 与平台无关地编码为 mod+enter', () => {
    const event = keyEvent({
      key: 'Enter',
      metaKey: IS_MAC,
      ctrlKey: !IS_MAC,
    });
    expect(eventToBinding(event)).toBe('mod+enter');
    expect(eventToBinding(event, { allowBare: true })).toBe('mod+enter');
  });

  it('formatBinding 显示 Enter', () => {
    expect(formatBinding('enter')).toBe('Enter');
    expect(formatBinding('shift+enter')).toMatch(/Enter/);
  });
});
