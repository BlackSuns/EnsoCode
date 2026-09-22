/** 托盘切换是全局快捷键：窗口销毁后渲染进程收不到按键。 */
export const TRAY_TOGGLE_ACTION = 'toggle-minimize-to-tray';
export const DEFAULT_TRAY_TOGGLE_BINDING = 'mod+shift+m';

const MODIFIERS = new Set(['mod', 'ctrl', 'alt', 'shift']);

const NAMED_KEYS: Record<string, string> = {
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  escape: 'Escape',
  esc: 'Escape',
  space: 'Space',
  ' ': 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  ',': 'Comma',
  '.': 'Period',
  ';': 'Semicolon',
  '/': 'Slash',
  '\\': 'Backslash',
  '`': 'Backquote',
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  "'": 'Quote',
};

export function resolveTrayToggleBinding(keybindings: unknown): string {
  if (!keybindings || typeof keybindings !== 'object' || Array.isArray(keybindings)) {
    return DEFAULT_TRAY_TOGGLE_BINDING;
  }
  const value = (keybindings as Record<string, unknown>)[TRAY_TOGGLE_ACTION];
  if (typeof value !== 'string') return DEFAULT_TRAY_TOGGLE_BINDING;
  return value.trim();
}

function acceleratorKey(key: string): string | null {
  const named = NAMED_KEYS[key];
  if (named) return named;
  if (/^f(?:[1-9]|1\d|2[0-4])$/.test(key)) return key.toUpperCase();
  if (/^[a-z0-9]$/.test(key)) return key.toUpperCase();
  return null;
}

/** 绑定串 → Electron accelerator。无修饰或仅 Shift 的组合返回 null。 */
export function bindingToAccelerator(binding: string): string | null {
  const parts = binding
    .trim()
    .toLowerCase()
    .split('+')
    .filter((part) => part.length > 0);
  const key = parts.at(-1);
  if (!key || parts.length < 2) return null;
  const mods = parts.slice(0, -1);
  if (mods.some((mod) => !MODIFIERS.has(mod))) return null;
  if (!mods.some((mod) => mod === 'mod' || mod === 'ctrl' || mod === 'alt')) return null;
  const keyName = acceleratorKey(key);
  if (!keyName) return null;
  const accelerator: string[] = [];
  if (mods.includes('mod')) accelerator.push('CommandOrControl');
  if (mods.includes('ctrl')) accelerator.push('Control');
  if (mods.includes('alt')) accelerator.push('Alt');
  if (mods.includes('shift')) accelerator.push('Shift');
  accelerator.push(keyName);
  return accelerator.join('+');
}
