import type { Theme } from '@/stores/settings/types';

export type ColorScheme = 'dark' | 'light';

/** 应用实际明暗：dark/light 看偏好，system 看 OS，sync-terminal 看终端底色 */
export function resolveColorScheme(
  theme: Theme,
  {
    prefersDark,
    terminalIsDark,
  }: {
    prefersDark: boolean;
    terminalIsDark: boolean;
  }
): ColorScheme {
  switch (theme) {
    case 'light':
      return 'light';
    case 'dark':
      return 'dark';
    case 'system':
      return prefersDark ? 'dark' : 'light';
    case 'sync-terminal':
      return terminalIsDark ? 'dark' : 'light';
  }
}
