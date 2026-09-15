import type { HostAppearance } from '@enso/pair';
import type { Theme } from '../../../src/renderer/stores/settings/types';

export type ThemePreference = 'auto' | 'light' | 'dark';

/** 给复用的桌面 diff 组件：themeType 跟 html.dark 同一套判定，不能永远停在 system。 */
export function settingsThemeFromPhone(
  nextOverride: ThemePreference,
  nextHost: HostAppearance
): { theme: Theme; syncTerminalTheme: boolean } {
  if (nextOverride !== 'auto') return { theme: nextOverride, syncTerminalTheme: false };
  return { theme: nextHost, syncTerminalTheme: nextHost === 'sync-terminal' };
}
